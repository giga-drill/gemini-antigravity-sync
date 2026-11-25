#!/usr/bin/env python3
"""Antigravity Sidecar watcher that imports exported Gemini Markdown chats into Antigravity."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import shutil
import signal
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

DEFAULT_WATCH_DIR = Path.home() / "Downloads" / "gemini-chats"
DEFAULT_IMPORTS_DIR = Path(__file__).resolve().parent.parent / "imports"
DEFAULT_PROJECT_ID = ""
DEFAULT_MODEL = "flash"
DEFAULT_POLL_INTERVAL = 1.0
DEFAULT_STABLE_SECONDS = 1.5
DEFAULT_MAX_INLINE_CHARS = 180_000
DEFAULT_FAILURE_COOLDOWN_SECONDS = 15.0
IGNORED_SUFFIXES = (".crdownload", ".tmp", ".part")

LOGGER = logging.getLogger("gemini-chat-sync")


@dataclass(frozen=True)
class WatcherConfig:
    watch_dir: Path
    imports_dir: Path
    project_id: str
    model: str
    state_file: Path
    poll_interval: float = DEFAULT_POLL_INTERVAL
    stable_seconds: float = DEFAULT_STABLE_SECONDS
    max_inline_chars: int = DEFAULT_MAX_INLINE_CHARS
    failure_cooldown_seconds: float = DEFAULT_FAILURE_COOLDOWN_SECONDS


def default_state_file() -> Path:
    data_dir = os.environ.get("ANTIGRAVITY_EXECUTABLE_DATA_DIR", "").strip()
    if data_dir:
        return Path(data_dir) / "state.json"
    return Path(__file__).resolve().parent / "state.json"


def load_config_from_env() -> WatcherConfig:
    watch_dir = Path(os.environ.get("GEMINI_SYNC_WATCH_DIR", str(DEFAULT_WATCH_DIR))).expanduser()
    imports_dir = Path(os.environ.get("GEMINI_SYNC_IMPORTS_DIR", str(DEFAULT_IMPORTS_DIR))).expanduser()
    project_id = os.environ.get("GEMINI_SYNC_PROJECT_ID", DEFAULT_PROJECT_ID).strip() or DEFAULT_PROJECT_ID
    model = os.environ.get("GEMINI_SYNC_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    state_file_env = os.environ.get("GEMINI_SYNC_STATE_FILE", "").strip()
    state_file = Path(state_file_env).expanduser() if state_file_env else default_state_file()
    poll_interval = float(os.environ.get("GEMINI_SYNC_POLL_INTERVAL", DEFAULT_POLL_INTERVAL))
    stable_seconds = float(os.environ.get("GEMINI_SYNC_STABLE_SECONDS", DEFAULT_STABLE_SECONDS))
    max_inline_chars = int(os.environ.get("GEMINI_SYNC_MAX_INLINE_CHARS", DEFAULT_MAX_INLINE_CHARS))
    return WatcherConfig(
        watch_dir=watch_dir,
        imports_dir=imports_dir,
        project_id=project_id,
        model=model,
        state_file=state_file,
        poll_interval=poll_interval,
        stable_seconds=stable_seconds,
        max_inline_chars=max_inline_chars,
    )


def _clean_title(raw: str) -> str:
    collapsed = re.sub(r"\s+", " ", raw).strip()
    collapsed = re.sub(r"\s*[-–—|]\s*(?:Google\s+)?Gemini\s*$", "", collapsed, flags=re.IGNORECASE).strip()
    if len(collapsed) > 120:
        return collapsed[:120].rstrip()
    return collapsed


def _parse_frontmatter_title(content: str) -> str:
    normalized = content.replace("\r\n", "\n")
    if not normalized.startswith("---\n"):
        return ""
    end_idx = normalized.find("\n---\n", 4)
    if end_idx == -1:
        if normalized.endswith("\n---"):
            end_idx = len(normalized) - 4
        else:
            return ""
    frontmatter = normalized[4:end_idx]
    for line in frontmatter.splitlines():
        match = re.match(r"^\s*title\s*:\s*(.+?)\s*$", line)
        if not match:
            continue
        val = match.group(1).strip()
        if len(val) >= 2 and val[0] == '"' and val[-1] == '"':
            inner = val[1:-1]
            inner = inner.replace('\\"', '"').replace("\\\\", "\\")
            return _clean_title(inner)
        if len(val) >= 2 and val[0] == "'" and val[-1] == "'":
            return _clean_title(val[1:-1].replace("''", "'"))
        return _clean_title(val)
    return ""


def _parse_h1_title(content: str) -> str:
    normalized = content.replace("\r\n", "\n")
    body = normalized
    if normalized.startswith("---\n"):
        end_idx = normalized.find("\n---\n", 4)
        if end_idx != -1:
            body = normalized[end_idx + 5 :]
    for line in body.splitlines():
        match = re.match(r"^\s*#\s+(.+?)\s*#*$", line)
        if match:
            text = re.sub(r"[`*_]", "", match.group(1)).strip()
            if text:
                return _clean_title(text)
    return ""


def extract_title(content: str, file_path: Path) -> str:
    """Extract conversation title from frontmatter, H1 heading, or filename."""
    for candidate in (_parse_frontmatter_title(content), _parse_h1_title(content)):
        if candidate:
            return candidate
    stem = re.sub(r"\s*\(\d+\)$", "", file_path.stem)
    cleaned = _clean_title(stem)
    return cleaned or "Gemini Chat"


def is_eligible_markdown_file(path: Path) -> bool:
    """Return True if path is a visible, non-temporary Markdown file."""
    name = path.name
    if not name or name.startswith("."):
        return False
    lower = name.lower()
    if any(lower.endswith(suffix) for suffix in IGNORED_SUFFIXES):
        return False
    if not lower.endswith(".md"):
        return False
    return path.is_file()


def compute_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


def load_state(state_file: Path) -> dict[str, Any]:
    if not state_file.exists():
        return {"processed_hashes": {}}
    try:
        data = json.loads(state_file.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("processed_hashes"), dict):
            return data
    except (OSError, json.JSONDecodeError) as exc:
        LOGGER.warning("Failed to load state file %s (%s); starting fresh", state_file, exc)
    return {"processed_hashes": {}}


def save_state(state_file: Path, state: dict[str, Any]) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = state_file.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp_path, state_file)


def copy_to_workspace_imports(src_path: Path, imports_dir: Path, sha256_hex: str) -> Path:
    imports_dir.mkdir(parents=True, exist_ok=True)
    dest = imports_dir / src_path.name
    if dest.exists():
        if compute_sha256(dest) == sha256_hex:
            return dest
        dest = imports_dir / f"{src_path.stem}_{sha256_hex[:8]}{src_path.suffix}"
    shutil.copy2(src_path, dest)
    return dest


def build_initial_prompt(
    title: str,
    source_path: Path,
    workspace_copy_path: Path,
    content: str,
    max_inline_chars: int = DEFAULT_MAX_INLINE_CHARS,
) -> str:
    header = (
        f"这是一个从 Gemini 网页端同步过来的对话历史记录，请接管上下文以便我继续往下聊。\n\n"
        f"- 原 Gemini 对话标题：{title}\n"
        f"- 原始导出文件：{source_path}\n"
        f"- 工作区备份路径：{workspace_copy_path}\n\n"
        f"要求：\n"
        f"1. 不要重复执行历史记录中已经完成的工作。\n"
        f"2. 用 3-5 条要点简要总结之前讨论了什么、目前进展到哪里、以及接下来待继续的部分。\n"
        f"3. 总结最后回复「已接管上下文，请继续」，然后等待我的下一条消息。\n\n"
    )
    if len(content) <= max_inline_chars:
        return (
            f"{header}"
            f"--- 完整对话历史开始 ---\n"
            f"{content}\n"
            f"--- 完整对话历史结束 ---"
        )

    preview_chars = max(2000, max_inline_chars // 2)
    head = content[:preview_chars]
    tail = content[-preview_chars:]
    return (
        f"{header}"
        f"注意：完整对话共 {len(content)} 字符，已超出单次内联上限（{max_inline_chars} 字符）。"
        f"下方提供开头与结尾片段，如需核对中间完整细节，请使用 read_file 读取工作区备份文件：{workspace_copy_path}\n\n"
        f"--- 对话开头片段 ---\n"
        f"{head}\n"
        f"--- 中间省略 {len(content) - 2 * preview_chars} 字符 ---\n"
        f"{tail}\n"
        f"--- 对话结尾片段 ---"
    )


class ConversationServiceClient:
    """Client for Antigravity local Connect HTTP+JSON ConversationService."""

    def __init__(
        self,
        ls_address: str,
        csrf_token: str,
        timeout_seconds: float = 15.0,
        urlopen_fn: Callable[..., Any] = urllib.request.urlopen,
    ) -> None:
        self.ls_address = ls_address.strip()
        self.csrf_token = csrf_token.strip()
        self.timeout_seconds = timeout_seconds
        self.urlopen_fn = urlopen_fn

    @classmethod
    def from_env(cls) -> "ConversationServiceClient":
        ls_address = os.environ.get("ANTIGRAVITY_LS_ADDRESS", "").strip()
        csrf_token = os.environ.get("ANTIGRAVITY_CSRF_TOKEN", "").strip()
        if not ls_address or not csrf_token:
            raise RuntimeError(
                "Missing ANTIGRAVITY_LS_ADDRESS or ANTIGRAVITY_CSRF_TOKEN in environment."
            )
        return cls(ls_address=ls_address, csrf_token=csrf_token)

    def _post(self, method: str, payload: dict[str, Any], max_attempts: int = 3) -> dict[str, Any]:
        url = f"http://{self.ls_address}/product.v1.ConversationService/{method}"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Connect-Protocol-Version": "1",
            "x-antigravity-csrf-token": self.csrf_token,
        }
        last_error: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            req = urllib.request.Request(url=url, data=body, headers=headers, method="POST")
            try:
                with self.urlopen_fn(req, timeout=self.timeout_seconds) as resp:
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as exc:
                err_body = ""
                try:
                    err_body = exc.read().decode("utf-8", errors="replace")[:300]
                except Exception:
                    pass
                last_error = RuntimeError(f"{method} HTTP {exc.code}: {err_body}")
                if exc.code < 500 or attempt == max_attempts:
                    raise last_error from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last_error = RuntimeError(f"{method} network error: {exc}")
                if attempt == max_attempts:
                    raise last_error from exc
            time.sleep(attempt)
        raise last_error or RuntimeError(f"{method} failed")

    def create_and_ensure_title(
        self,
        *,
        project_id: str,
        title: str,
        model: str,
        prompt_text: str,
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        create_payload: dict[str, Any] = {
            "title": title,
            "model": model,
            "tags": tags or ["gemini-web-sync"],
            "prompt": [{"text": prompt_text}],
        }
        if project_id:
            create_payload["projectId"] = project_id
        res = self._post("CreateConversation", create_payload)
        conv = res.get("conversation", {})
        conv_id = conv.get("id", "")
        if not conv_id:
            raise RuntimeError(f"CreateConversation response missing conversation.id: {res}")

        current_title = (conv.get("annotations") or {}).get("title", "")
        if current_title != title:
            update_res = self._post(
                "UpdateConversation",
                {
                    "conversationId": conv_id,
                    "annotations": {"title": title},
                },
            )
            conv = update_res.get("conversation") or conv
        return conv


def process_markdown_file(
    file_path: Path,
    config: WatcherConfig,
    state: dict[str, Any],
    client: ConversationServiceClient | None,
    *,
    dry_run: bool = False,
) -> dict[str, Any] | None:
    """Process one Markdown file; return record dict on import, or None if skipped."""
    if not is_eligible_markdown_file(file_path):
        raise ValueError(f"Not an eligible Markdown file: {file_path}")

    sha256_hex = compute_sha256(file_path)
    processed = state.setdefault("processed_hashes", {})
    if sha256_hex in processed:
        LOGGER.info("Skipping already imported file %s (sha256=%s)", file_path.name, sha256_hex[:12])
        return None

    content = file_path.read_text(encoding="utf-8", errors="replace")
    if not content.strip():
        LOGGER.info("Skipping empty file %s", file_path.name)
        return None

    title = extract_title(content, file_path)
    if dry_run:
        backup_path = config.imports_dir / file_path.name
        prompt_text = build_initial_prompt(
            title=title,
            source_path=file_path,
            workspace_copy_path=backup_path,
            content=content,
            max_inline_chars=config.max_inline_chars,
        )
        summary = {
            "dryRun": True,
            "projectId": config.project_id,
            "model": config.model,
            "title": title,
            "sha256": sha256_hex,
            "sourcePath": str(file_path),
            "workspaceCopy": str(backup_path),
            "promptChars": len(prompt_text),
            "inlineFullContent": len(content) <= config.max_inline_chars,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return summary

    if client is None:
        client = ConversationServiceClient.from_env()

    backup_path = copy_to_workspace_imports(file_path, config.imports_dir, sha256_hex)
    prompt_text = build_initial_prompt(
        title=title,
        source_path=file_path,
        workspace_copy_path=backup_path,
        content=content,
        max_inline_chars=config.max_inline_chars,
    )
    conv = client.create_and_ensure_title(
        project_id=config.project_id,
        title=title,
        model=config.model,
        prompt_text=prompt_text,
        tags=["gemini-web-sync"],
    )
    conv_id = conv.get("id", "")
    record = {
        "conversationId": conv_id,
        "title": title,
        "filename": file_path.name,
        "sourcePath": str(file_path),
        "workspaceCopy": str(backup_path),
        "importedAt": datetime.now(timezone.utc).isoformat(),
    }
    processed[sha256_hex] = record
    save_state(config.state_file, state)
    LOGGER.info("Imported '%s' -> conversationId=%s", title, conv_id)
    return record


class SyncWatcher:
    """Polling watcher with file write-stability guard and failure backoff."""

    def __init__(
        self,
        config: WatcherConfig,
        client_factory: Callable[[], ConversationServiceClient] = ConversationServiceClient.from_env,
        time_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config
        self.client_factory = client_factory
        self.time_fn = time_fn
        self.candidates: dict[Path, tuple[int, int, float]] = {}
        self.failed_until: dict[tuple[Path, int, int], float] = {}

    def scan_once(self) -> list[dict[str, Any]]:
        self.config.watch_dir.mkdir(parents=True, exist_ok=True)
        now = self.time_fn()
        state = load_state(self.config.state_file)
        processed = state.get("processed_hashes", {})

        seen_paths: set[Path] = set()
        imported: list[dict[str, Any]] = []

        for entry in sorted(self.config.watch_dir.iterdir()):
            if not is_eligible_markdown_file(entry):
                continue
            try:
                stat = entry.stat()
            except OSError:
                continue
            if stat.st_size <= 0:
                continue

            seen_paths.add(entry)
            sig = (stat.st_size, stat.st_mtime_ns)
            prev = self.candidates.get(entry)
            if prev is None or (prev[0], prev[1]) != sig:
                self.candidates[entry] = (stat.st_size, stat.st_mtime_ns, now)
                continue

            if now - prev[2] < self.config.stable_seconds:
                continue

            fail_key = (entry, stat.st_size, stat.st_mtime_ns)
            cooldown_until = self.failed_until.get(fail_key, 0.0)
            if now < cooldown_until:
                continue

            sha256_hex = compute_sha256(entry)
            if sha256_hex in processed:
                continue

            try:
                client = self.client_factory()
                record = process_markdown_file(entry, self.config, state, client, dry_run=False)
                if record:
                    imported.append(record)
                    self.failed_until.pop(fail_key, None)
            except Exception as exc:
                LOGGER.error("Failed to import %s: %s", entry.name, exc)
                self.failed_until[fail_key] = now + self.config.failure_cooldown_seconds

        for tracked in list(self.candidates):
            if tracked not in seen_paths:
                self.candidates.pop(tracked, None)

        return imported


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    parser = argparse.ArgumentParser(description="Gemini Web -> Antigravity Markdown sync watcher")
    parser.add_argument("--file", type=Path, help="Process a single Markdown file and exit")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="With --file, inspect extracted title and payload without creating a conversation",
    )
    args = parser.parse_args(argv)

    config = load_config_from_env()
    ls_present = bool(os.environ.get("ANTIGRAVITY_LS_ADDRESS", "").strip())
    csrf_present = bool(os.environ.get("ANTIGRAVITY_CSRF_TOKEN", "").strip())
    LOGGER.info(
        "Starting watcher: watch_dir=%s project_id=%s model=%s ls_env=%s csrf_env=%s",
        config.watch_dir,
        config.project_id,
        config.model,
        ls_present,
        csrf_present,
    )

    if args.file:
        target = args.file.expanduser().resolve()
        state = load_state(config.state_file)
        client = None if args.dry_run else ConversationServiceClient.from_env()
        process_markdown_file(target, config, state, client, dry_run=args.dry_run)
        return 0

    config.watch_dir.mkdir(parents=True, exist_ok=True)
    existing_count = sum(1 for p in config.watch_dir.iterdir() if is_eligible_markdown_file(p))
    LOGGER.info("Initial watch_dir scan: %d eligible .md files present", existing_count)

    running = True

    def _stop(_signum: int, _frame: Any) -> None:
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    watcher = SyncWatcher(config)
    while running:
        watcher.scan_once()
        time.sleep(config.poll_interval)
    return 0


if __name__ == "__main__":
    sys.exit(main())

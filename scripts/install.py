#!/usr/bin/env python3
"""Installer for gemini-antigravity-sync: builds the Chrome extension and registers the Antigravity Sidecar."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

SIDECAR_ID = "gemini-chat-sync"
GEMINI_CONFIG_DIR = Path.home() / ".gemini" / "config"


def resolve_project_id(project_id: str, project_name: str) -> str:
    if project_id:
        return project_id.strip()
    if not project_name:
        return ""

    projects_dir = GEMINI_CONFIG_DIR / "projects"
    available: list[tuple[str, str]] = []
    if projects_dir.is_dir():
        for path in sorted(projects_dir.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            name = str(data.get("name", "")).strip()
            pid = str(data.get("id", "")).strip()
            if name and pid:
                available.append((name, pid))
                if name == project_name:
                    return pid

    for name, pid in available:
        if name.lower() == project_name.lower():
            return pid

    known = ", ".join(f"{n} ({p})" for n, p in available) or "none"
    raise SystemExit(
        f"Project '{project_name}' not found under {projects_dir}. Available projects: {known}"
    )


def build_extension(repo_root: Path) -> Path:
    ext_dir = repo_root / "extension"
    env = os.environ.copy()
    env["BUILD_VARIANT"] = "production"
    env["BROWSER_TARGET"] = "chrome"
    env["ENABLE_USER_INPUT_IMAGE_EXPORT"] = "true"

    print(f"[install] Installing npm dependencies in {ext_dir}...")
    subprocess.run(["npm", "install"], cwd=ext_dir, check=True)
    print(f"[install] Building Chrome production bundle in {ext_dir}...")
    subprocess.run(["npm", "run", "build:bundle"], cwd=ext_dir, env=env, check=True)
    dist_dir = ext_dir / "dist" / "chrome"
    if not (dist_dir / "manifest.json").is_file():
        raise SystemExit(f"Build succeeded but {dist_dir / 'manifest.json'} is missing")
    return dist_dir


def write_sidecar_config(repo_root: Path, watch_dir: Path, project_id: str, model: str) -> Path:
    sidecar_dir = GEMINI_CONFIG_DIR / "sidecars" / SIDECAR_ID
    sidecar_dir.mkdir(parents=True, exist_ok=True)
    sidecar_json = sidecar_dir / "sidecar.json"

    env_map = {
        "GEMINI_SYNC_WATCH_DIR": str(watch_dir),
        "GEMINI_SYNC_MODEL": model,
    }
    if project_id:
        env_map["GEMINI_SYNC_PROJECT_ID"] = project_id

    payload = {
        "display_name": "Gemini Chat Sync",
        "description": "Watches exported Gemini Markdown files and creates titled conversations in Antigravity.",
        "command": sys.executable,
        "args": [
            "-u",
            str(repo_root / "service" / "watcher.py"),
        ],
        "restart_policy": "always",
        "env": env_map,
    }
    sidecar_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return sidecar_json


def enable_sidecar_in_config(project_id: str) -> Path:
    cfg_path = GEMINI_CONFIG_DIR / "config.json"
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    else:
        cfg = {}

    sidecars = cfg.setdefault("sidecars", {})
    entry: dict[str, object] = {"enabled": True}
    if project_id:
        entry["projectId"] = project_id
    sidecars[SIDECAR_ID] = entry

    tmp_path = cfg_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp_path, 0o600)
    os.replace(tmp_path, cfg_path)
    return cfg_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Install gemini-antigravity-sync extension and Sidecar")
    parser.add_argument("--project-id", default="", help="Target Antigravity project UUID (optional)")
    parser.add_argument("--project-name", default="", help="Target Antigravity project name under ~/.gemini/config/projects/")
    parser.add_argument("--model", default="flash", help="Default model tier or ID for synced conversations (default: flash)")
    parser.add_argument(
        "--watch-dir",
        default=str(Path.home() / "Downloads" / "gemini-chats"),
        help="Directory watched for exported Markdown files (default: ~/Downloads/gemini-chats)",
    )
    parser.add_argument("--skip-build", action="store_true", help="Skip npm install and Vite build")
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parent.parent
    watch_dir = Path(args.watch_dir).expanduser().resolve()
    imports_dir = repo_root / "imports"
    watch_dir.mkdir(parents=True, exist_ok=True)
    imports_dir.mkdir(parents=True, exist_ok=True)

    project_id = resolve_project_id(args.project_id, args.project_name)
    dist_dir = repo_root / "extension" / "dist" / "chrome"
    if not args.skip_build:
        dist_dir = build_extension(repo_root)

    sidecar_json = write_sidecar_config(repo_root, watch_dir, project_id, args.model)
    cfg_path = enable_sidecar_in_config(project_id)

    print("\n[install] Done!")
    print(f"  - Watch dir   : {watch_dir}")
    print(f"  - Project ID  : {project_id or '(default / unset)'}")
    print(f"  - Model       : {args.model}")
    print(f"  - Sidecar cfg : {sidecar_json}")
    print(f"  - Global cfg  : {cfg_path}")
    print("\nNext step in Google Chrome:")
    print("  1. Open chrome://extensions/")
    print("  2. Enable 'Developer mode'")
    print(f"  3. Click 'Load unpacked' and select: {dist_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

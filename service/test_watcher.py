import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

import watcher


SAMPLE_EXPORTER_MD = """---
title: "设计 \"Gemini\" 同步工具 & 计划"
author: "You"
date: 2026-11-25T03:00:00.000Z
url: https://gemini.google.com/app/abc123
model: "Gemini 3 Pro"
---

### 🧑 **You**

你好，帮我看一下同步方案。

---

### 🤖 **Gemini**

好的，我们可以用 Sidecar 监听目录。

---
"""


class WatcherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.watch_dir = self.root / "watch"
        self.imports_dir = self.root / "imports"
        self.state_file = self.root / "state.json"
        self.watch_dir.mkdir()
        self.config = watcher.WatcherConfig(
            watch_dir=self.watch_dir,
            imports_dir=self.imports_dir,
            project_id="proj-123",
            model="flash",
            state_file=self.state_file,
            poll_interval=0.1,
            stable_seconds=1.5,
            max_inline_chars=5000,
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_extract_title_from_frontmatter_h1_and_filename(self) -> None:
        self.assertEqual(
            watcher.extract_title(SAMPLE_EXPORTER_MD, Path("ignored.md")),
            '设计 "Gemini" 同步工具 & 计划',
        )
        self.assertEqual(
            watcher.extract_title('---\ntitle: "Reddit 推广文案创作 - Google Gemini"\n---\n', Path("ignored.md")),
            "Reddit 推广文案创作",
        )
        self.assertEqual(
            watcher.extract_title("# **标题测试** `v2` - Gemini\n\n正文", Path("ignored.md")),
            "标题测试 v2",
        )
        self.assertEqual(
            watcher.extract_title("没有标题的正文", Path("我的对话 (2).md")),
            "我的对话",
        )

    def test_ignores_temp_and_non_markdown_files(self) -> None:
        cr = self.watch_dir / "chat.md.crdownload"
        tmp = self.watch_dir / "chat.tmp"
        pdf = self.watch_dir / "chat.pdf"
        dot = self.watch_dir / ".hidden.md"
        md = self.watch_dir / "chat.md"
        for p in (cr, tmp, pdf, dot, md):
            p.write_text("hello", encoding="utf-8")

        self.assertFalse(watcher.is_eligible_markdown_file(cr))
        self.assertFalse(watcher.is_eligible_markdown_file(tmp))
        self.assertFalse(watcher.is_eligible_markdown_file(pdf))
        self.assertFalse(watcher.is_eligible_markdown_file(dot))
        self.assertTrue(watcher.is_eligible_markdown_file(md))

    def test_stability_guard_and_deduplication(self) -> None:
        md_file = self.watch_dir / "sync_test.md"
        md_file.write_text(SAMPLE_EXPORTER_MD, encoding="utf-8")

        fake_now = [100.0]
        mock_client = MagicMock(spec=watcher.ConversationServiceClient)
        mock_client.create_and_ensure_title.return_value = {
            "id": "conv-1",
            "annotations": {"title": '设计 "Gemini" 同步工具 & 计划'},
        }
        sw = watcher.SyncWatcher(
            self.config,
            client_factory=lambda: mock_client,
            time_fn=lambda: fake_now[0],
        )

        # First scan: records candidate, does not import yet
        self.assertEqual(sw.scan_once(), [])
        mock_client.create_and_ensure_title.assert_not_called()

        # Before stable_seconds elapsed: still waits
        fake_now[0] = 101.0
        self.assertEqual(sw.scan_once(), [])

        # After stable_seconds elapsed: imports once
        fake_now[0] = 102.0
        imported = sw.scan_once()
        self.assertEqual(len(imported), 1)
        self.assertEqual(imported[0]["conversationId"], "conv-1")
        self.assertTrue((self.imports_dir / "sync_test.md").exists())

        # Identical re-scan is skipped (deduped)
        fake_now[0] = 105.0
        self.assertEqual(sw.scan_once(), [])
        self.assertEqual(mock_client.create_and_ensure_title.call_count, 1)

        # Modified file content creates a new conversation after stabilizing
        md_file.write_text(SAMPLE_EXPORTER_MD + "\n追加一轮对话\n", encoding="utf-8")
        mock_client.create_and_ensure_title.return_value = {
            "id": "conv-2",
            "annotations": {"title": '设计 "Gemini" 同步工具 & 计划'},
        }
        self.assertEqual(sw.scan_once(), [])  # size/mtime changed, reset stability timer
        fake_now[0] = 107.0
        imported2 = sw.scan_once()
        self.assertEqual(len(imported2), 1)
        self.assertEqual(imported2[0]["conversationId"], "conv-2")

    def test_create_and_ensure_title_calls_update_when_missing(self) -> None:
        calls: list[tuple[str, dict]] = []

        class FakeResponse:
            def __init__(self, payload: dict) -> None:
                self._payload = payload

            def read(self) -> bytes:
                return json.dumps(self._payload).encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        def fake_urlopen(req, timeout=15.0):
            method = req.full_url.rsplit("/", 1)[-1]
            data = json.loads(req.data.decode("utf-8"))
            calls.append((method, data))
            self.assertEqual(req.get_header("X-antigravity-csrf-token"), "secret-token")
            if method == "CreateConversation":
                return FakeResponse({"conversation": {"id": "conv-99", "annotations": {}}})
            if method == "UpdateConversation":
                return FakeResponse({"conversation": {"id": "conv-99", "annotations": {"title": data["annotations"]["title"]}}})
            raise AssertionError(f"Unexpected method {method}")

        client = watcher.ConversationServiceClient(
            ls_address="127.0.0.1:12345",
            csrf_token="secret-token",
            urlopen_fn=fake_urlopen,
        )
        conv = client.create_and_ensure_title(
            project_id="proj-123",
            title="我的精准标题",
            model="flash",
            prompt_text="历史内容",
        )
        self.assertEqual(conv["id"], "conv-99")
        self.assertEqual(conv["annotations"]["title"], "我的精准标题")
        self.assertEqual([c[0] for c in calls], ["CreateConversation", "UpdateConversation"])
        self.assertEqual(calls[0][1].get("projectId"), "proj-123")

        calls.clear()
        client.create_and_ensure_title(
            project_id="",
            title="无项目标题",
            model="flash",
            prompt_text="历史内容",
        )
        self.assertNotIn("projectId", calls[0][1])


if __name__ == "__main__":
    unittest.main()

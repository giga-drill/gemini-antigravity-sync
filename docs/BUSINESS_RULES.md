# Business Rules: Gemini Web -> Antigravity Auto-Sync

## Scope
Rules governing the local sync workflow from `gemini.google.com` exported conversations into the Antigravity Desktop app (`v2.35.0+`).

## Confirmed Rules

1. **Upstream Extension & License**
   - Uses `iplaysoft/gemini_chat_exporter` under the MIT License (`extension/LICENSE` preserved).
   - Minimal Chrome MV3 adjustments:
     - Markdown (`.md`) downloads route to `gemini-chats/<title>.md` with `saveAs: false`; PDF/HTML/TXT export behavior remains unchanged.
     - Fallback to base64 `data:` URL in MV3 Service Workers where `URL.createObjectURL` is unavailable.
     - `content.js` compiles as a self-contained classic IIFE for Chrome MV3 `content_scripts`, avoids `innerHTML` on Trusted-Types-protected pages, and uses `webextension-polyfill` uniformly.

2. **Drop Directory & File Filtering**
   - Chrome extension exports Markdown files into `~/Downloads/gemini-chats/` (or the configured `GEMINI_SYNC_WATCH_DIR`).
   - Temporary/incomplete files (`.crdownload`, `.tmp`, `.part`, hidden dotfiles) and non-`.md` files are ignored.

3. **Sidecar Trigger & Stability**
   - Antigravity Sidecar `gemini-chat-sync` monitors the drop directory.
   - A file is processed only when `size > 0` and `(size, mtime_ns)` remain unchanged for at least `GEMINI_SYNC_STABLE_SECONDS` (default `1.5s`).

4. **Title Extraction & Target Conversation Creation**
   - Title is extracted from YAML frontmatter `title:`, falling back to the first H1 heading or sanitized filename stem, and trailing ` - Google Gemini` / ` - Gemini` suffixes are stripped.
   - Calls `product.v1.ConversationService/CreateConversation` with:
     - `projectId`: optional (`GEMINI_SYNC_PROJECT_ID`, omitted if unset).
     - `title`: extracted conversation title.
     - `tags`: `["gemini-web-sync"]`.
     - `model`: configurable via `GEMINI_SYNC_MODEL` (default `"flash"`).
     - `prompt`: embeds full Markdown content when `<= GEMINI_SYNC_MAX_INLINE_CHARS` (default `180000`), or a truncated preview + reference to the workspace backup copy in `imports/` when larger; instructs the agent not to redo completed work, briefly summarize progress, reply `"已接管上下文，请继续"`, and wait for the user.
   - Verifies returned `annotations.title == title`; if mismatched or empty, calls `UpdateConversation` to set the exact title.

5. **Deduplication & Workspace Backup**
   - Processed files are tracked by SHA-256 hash in `state.json` (`processed_hashes`).
   - Identical re-exports (same SHA-256) are skipped to prevent duplicate Antigravity conversations across restarts or accidental re-downloads.
   - Updated re-exports (different SHA-256) create a new Antigravity conversation.
   - Every processed Markdown file is backed up into `imports/` before creating the conversation.

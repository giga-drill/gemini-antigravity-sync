# gemini-antigravity-sync

Automatically sync Google Gemini web (`gemini.google.com`) conversations into local **Antigravity** (`v2.35.0+`) as titled, resumable conversations with full chat history.

## How It Works

```text
gemini.google.com
   │  (click "Export Markdown" in Chrome extension)
   ▼
~/Downloads/gemini-chats/<title>.md
   │  (watched by Antigravity Sidecar service/watcher.py)
   ▼
Antigravity ConversationService (CreateConversation + UpdateConversation)
   └─► New titled conversation in Antigravity with full transcript ready to continue
```

1. **Chrome MV3 Extension (`extension/`)**: Built on top of [`iplaysoft/gemini_chat_exporter`](https://github.com/iplaysoft/gemini_chat_exporter) (MIT License) with Chrome MV3 compatibility fixes (self-contained classic IIFE content script, Trusted Types compatibility, Service Worker `data:` URL download fallback, and silent `.md` download into `~/Downloads/gemini-chats/`).
2. **Antigravity Sidecar (`service/watcher.py`)**: Uses Python 3 standard library only. Watches `~/Downloads/gemini-chats/`, waits for download completion, deduplicates by SHA-256, backs up each transcript to `imports/`, strips trailing ` - Google Gemini` from titles, and creates a titled conversation in Antigravity via `ConversationService`.

## Prerequisites

- **Google Antigravity** v2.35.0 or newer (with `ConversationService` and Sidecars)
- **Node.js** `>= 20.18.1` and **npm** `>= 10`
- **Python** `>= 3.10`
- **Google Chrome** (or Chromium-based browser)

## Quick Start

1. Clone this repository:
   ```bash
   git clone https://github.com/giga-drill/gemini-antigravity-sync.git
   cd gemini-antigravity-sync
   ```

2. Run the one-command installer (optionally bind to an Antigravity project by name or UUID):
   ```bash
   python3 scripts/install.py
   # Or target a specific Antigravity project:
   python3 scripts/install.py --project-name my-project
   # Or pass --project-id <uuid> / --model pro
   ```
   This builds `extension/dist/chrome`, creates `~/Downloads/gemini-chats/`, registers `~/.gemini/config/sidecars/gemini-chat-sync/sidecar.json`, and enables it in `~/.gemini/config/config.json`.

3. Load the unpacked extension in Chrome:
   - Open `chrome://extensions/`
   - Enable **Developer mode**
   - Click **Load unpacked** and select `<repo>/extension/dist/chrome`

4. Restart Antigravity if the Sidecar does not start automatically, then open any chat on `https://gemini.google.com/` and export as **Markdown** (`Download`). Within 1–2 seconds a matching titled conversation appears in Antigravity ready for follow-up messages.

## Configuration

Edit `~/.gemini/config/sidecars/gemini-chat-sync/sidecar.json` (or re-run `scripts/install.py`):

| Env Var | Default | Description |
| --- | --- | --- |
| `GEMINI_SYNC_WATCH_DIR` | `~/Downloads/gemini-chats` | Folder watched for exported `.md` files |
| `GEMINI_SYNC_PROJECT_ID` | `""` | Optional target Antigravity project UUID |
| `GEMINI_SYNC_MODEL` | `flash` | Model tier (`flash_lite`, `flash`, `pro`) or model ID |
| `GEMINI_SYNC_STABLE_SECONDS` | `1.5` | Seconds file size/mtime must remain stable before import |
| `GEMINI_SYNC_MAX_INLINE_CHARS` | `180000` | Max transcript characters inlined into the initial prompt |

Logs are stored by Antigravity at `~/.gemini/antigravity/sidecar_data/gemini-chat-sync/logs/`.

## Verification & Testing

- **Python unit tests**:
  ```bash
  PYTHONPATH=service python3 -m unittest service/test_watcher.py -v
  ```
- **Extension type-check & production build**:
  ```bash
  cd extension
  npm run type-check
  BUILD_VARIANT=production BROWSER_TARGET=chrome ENABLE_USER_INPUT_IMAGE_EXPORT=true npm run build:bundle
  ```
- **Dry-run a single exported file**:
  ```bash
  python3 service/watcher.py --file /path/to/chat.md --dry-run
  ```
- **Automated Chromium MV3 + Live Sidecar E2E test** (requires `playwright-core`, `ANTIGRAVITY_LS_ADDRESS`, and `ANTIGRAVITY_CSRF_TOKEN`):
  ```bash
  node service/e2e_chrome_extension.mjs
  ```

## License

MIT — see [LICENSE](LICENSE) and [extension/LICENSE](extension/LICENSE).

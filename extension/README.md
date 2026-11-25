# 🧊 Gemini Chat Exporter

Export Gemini conversations into clean, reusable documents — and manage your saved chat history without wrestling with Gemini’s dynamic DOM.

## ✨ What it does

Gemini Chat Exporter is a privacy-first browser extension for exporting and managing Gemini conversations locally.

It focuses on reliability over gimmicks:

- capture long or virtualized conversations more completely
- export in multiple formats
- copy clean text for NotebookLM
- batch-manage cached chats from a full options page
- keep everything local to the browser

## 🚀 Current feature set

### Popup workflow

- Export the current chat as:
   - `Markdown`
   - `PDF`
   - `HTML`
   - `TXT`
- Output to:
   - downloaded file
   - clipboard
- One-click send/copy flow for **NotebookLM**
- Theme selection for PDF / rendered output:
   - Notion
   - Academic
   - Script

### Options page

- Browse cached sessions
- Search sessions by title / content
- Batch export selected sessions
- Batch delete local sessions
- Optionally sync-delete matching chats from Gemini Web
- Silent background sync from Gemini Web into local cache

### Extraction & rendering

- auto-expands content before extraction
- handles lazy loading / virtual scroll more aggressively
- reduces payload size when runtime message pressure gets too high
- PDF pipeline supports Ghost page pre-rendering with fallback to jsPDF

### Feedback UX

- low-profile open-source footer in popup / options
- review funnel on options page
- popup success Toast with anti-spam logic
   - only appears on success counts `8 / 15 / 30`
   - permanently silenced after the user clicks the review link

## 🤔 Why not just use “Print to PDF”?

Gemini’s UI is highly dynamic. Native browser print often misses content, breaks layout, or fails on long threads.

This extension extracts the conversation data first, then renders it into cleaner export targets with browser-extension-specific handling for:

- long chats
- virtualized content
- image-heavy threads
- sidebar lazy loading

## 📦 Installation

### Build setup

#### ⚠️ IMPORTANT: Requirements

- **Node.js**: `v20.18.1` or higher is strictly required due to native bindings in dependencies such as Tailwind v4.
- **npm**: `v10` or higher.

#### Build steps

1. Unzip this source code archive and open a terminal in the root directory.
2. Run `npm install` to install all necessary dependencies.
3. Run one of the following production build commands:

```bash
BROWSER_TARGET=firefox npm run build:production
BROWSER_TARGET=chrome npm run build:production
```

4. The final compiled extension files will be generated in the `/dist` directory.

Notes:

- this is the only documented release build flow
- the script prompts whether to enable the **user-input image export** feature
- output is written to `dist/chrome` or `dist/firefox`

### Load in Chrome / Chromium

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `dist/chrome`

### Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `dist/firefox/manifest.json`

> Always use the built manifest in `dist/firefox/manifest.json`, not the root `manifest.json`.

## 🧭 How to use

### Export the current chat

1. Open a Gemini conversation on `https://gemini.google.com/`
2. Click the extension icon to open the popup
3. Choose an export format
4. Choose output mode:
    - **Download as file**
    - **Copy to clipboard**
5. Choose export scope:
    - **Current chat**
    - **Selected content**
    - **All history** (file export only)
6. Start export

### Send to NotebookLM

1. Open the popup on a Gemini conversation
2. Click **Send to NotebookLM**
3. The extension will copy normalized chat text and open NotebookLM

### Manage cached chats

1. Open the extension **Options** page
2. Review cached sessions
3. Search/filter as needed
4. Select chats for batch export or deletion
5. Optionally enable web-side deletion when removing sessions

## ⚙️ Configuration

In the Options page you can configure:

- UI language
- default export format
- default output mode
- user label mode
- image compression quality
- max image width

## 🔐 Privacy and permissions

This extension is designed to work locally in the browser.

- it does not send Gemini chat data to developer-controlled servers
- it only reads Gemini pages when the user runs an export or chat-management action
- exported content is written to local downloads, the clipboard, or browser storage depending on the action the user chooses
- NotebookLM flow is user-triggered and opens NotebookLM after copying content locally

Permissions used:

- `activeTab` / `scripting` / `tabs`: run the extractor on the active Gemini tab and coordinate export flows
- `storage`: save settings and cached chat metadata in the browser
- `downloads`: save exported files locally
- `clipboardWrite`: support copy-to-clipboard and NotebookLM flows
- host access to `https://gemini.google.com/*` and `https://*.googleusercontent.com/*`: read Gemini chat content and preserve referenced image assets during export

For Firefox submission:

- build with `BROWSER_TARGET=firefox npm run build:production`
- submit the package built from `dist/firefox`
- use the generated [manifest.json](./dist/firefox/manifest.json), not the root source manifest

## 🧪 Debugging quick reference

The full debugging guide lives in [`DEBUG_GUIDE.md`](./DEBUG_GUIDE.md). The short version:

### Enable extraction debug logs

Use either:

```text
?gce_debug=1
```

or in the Gemini page console:

```javascript
localStorage.setItem('gce_debug', '1');
location.reload();
```

### Most important log prefixes

- `[GCE][extract]` — content extraction / scroll collection
- `[GCE]` — sidebar selection and lazy-load scrolling
- `[GCE][background]` — background export orchestration
- `[PDF]` — PDF render / fallback issues
- `[DELETE]` — Gemini Web deletion flow
- `[Popup]` — review Toast storage issues

### Common checks

- current-chat export failing → inspect `extract-start`, `collect-start`, `collect-finish`, `extract-success`
- all-history / selection incomplete → inspect `scroll start`, `scroll loaded more chats`, `scroll stable`, `scroll complete`
- options sync failing → inspect `Auto sync failed:` and content-script injection errors
- PDF issues → inspect Ghost-tab logs and `[PDF] ... fallback to jsPDF`

## 🛠️ Development

### Scripts

```bash
npm run dev
BROWSER_TARGET=chrome npm run build:production
BROWSER_TARGET=firefox npm run build:production
npm test
npm run lint
npm run type-check
```

### Project structure

```text
src/
├── background/     # service worker, routing, export orchestration
├── content/        # DOM extraction, lazy-load handling, sidebar crawling
├── exporters/      # Markdown / HTML / TXT / PDF exporters
├── i18n/           # translation bootstrap and locale files
├── options/        # full-page management UI
├── popup/          # quick export popup UI
├── shared/         # shared helpers and browser API wrappers
├── storage/        # IndexedDB and download helpers
├── styles/         # global styles
└── types/          # shared models and runtime message types
```

## 📚 Extra docs

- [`DEBUG_GUIDE.md`](./DEBUG_GUIDE.md) — debugging, logs, manual troubleshooting
- [`docs/chat-management.md`](./docs/chat-management.md) — options page / cached session workflow

## 📄 License

MIT License © 2026 IPlaySoft <weplaysoft@gmail.com>

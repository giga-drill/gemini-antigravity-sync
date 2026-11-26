#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function loadPlaywrightChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE_PATH,
    'playwright-core',
    path.join(os.homedir(), '.hermes/hermes-agent/node_modules/playwright-core'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate).chromium;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    'Unable to resolve playwright-core. Install playwright-core or set PLAYWRIGHT_CORE_PATH.',
  );
}

const chromium = loadPlaywrightChromium();
const EXT_DIR = path.join(REPO_ROOT, 'extension', 'dist', 'chrome');
const WATCH_DIR = process.env.GEMINI_SYNC_WATCH_DIR
  ? path.resolve(process.env.GEMINI_SYNC_WATCH_DIR)
  : path.join(os.homedir(), 'Downloads', 'gemini-chats');
const DOWNLOADS_ROOT = path.dirname(WATCH_DIR);
const IMPORTS_DIR = path.join(REPO_ROOT, 'imports');
const SIDECAR_STATE_FILE = path.join(
  os.homedir(),
  '.gemini/antigravity/sidecar_data/gemini-chat-sync/data/state.json',
);
const PROJECT_ID = (process.env.GEMINI_SYNC_PROJECT_ID || process.env.ANTIGRAVITY_PROJECT_ID || '').trim();
const EXPECTED_TITLE = 'E2E 真实浏览器扩展验证';
const EXPECTED_MD_PATH = path.join(WATCH_DIR, `${EXPECTED_TITLE}.md`);

const TURN1_TRUNCATED_H2 =
  '第一轮：这是一段超过两百字的用户长输入，用来复现并验证 Gemini 网页端隐藏 h2 截断和折叠按钮的问题，测试真实内容是否被完整抓下来…';
const TURN1_SENTINEL = '【完整结尾标记-TURN1】';
const TURN3_TRUNCATED_H2 =
  '第三轮：另一段超过一百字的多段落用户消息，用来验证没有折叠按钮时也不会被 cdk-visually-hidden 截断…';
const TURN3_SENTINEL = '【完整结尾标记-TURN3】';

const MOCK_GEMINI_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${EXPECTED_TITLE} - Gemini</title>
</head>
<body>
  <header>
    <div data-test-id="conversation-title">${EXPECTED_TITLE}</div>
  </header>
  <main>
    <div class="conversation-turn">
      <user-query>
        <h2 class="cdk-visually-hidden"><span>你说</span><span>${TURN1_TRUNCATED_H2}</span></h2>
        <user-query-content>
          <div class="query-text" id="turn1-query-text">
            <p class="query-text-line">第一轮：这是一段超过两百字的用户长输入，用来复现并验证 Gemini 网页端隐藏 h2 截断和折叠按钮的问题。</p>
          </div>
          <button id="turn1-expand-btn" type="button" aria-label="展开文本" aria-expanded="false">
            <mat-icon>keyboard_arrow_down</mat-icon>
          </button>
        </user-query-content>
      </user-query>
    </div>
    <div class="conversation-turn">
      <model-response>
        <message-content><p>第二轮：这是模拟的 Gemini 回复，请仅做简短确认。</p></message-content>
      </model-response>
    </div>
    <div class="conversation-turn">
      <user-query>
        <h2 class="cdk-visually-hidden"><span>你说</span><span>${TURN3_TRUNCATED_H2}</span></h2>
        <user-query-content>
          <div class="query-text">
            <p class="query-text-line">第三轮第一段内容：当用户一次性输入很多背景资料、多行思路和具体细节时，Gemini 页面只会在视觉隐藏的 h2 里保留前一百个字加省略号。</p>
            <p class="query-text-line">第三轮第二段内容：真正的全文在 .query-text 的多个 query-text-line 段落里，必须把前后所有段落都完整同步到本地 ${TURN3_SENTINEL}</p>
          </div>
        </user-query-content>
      </user-query>
    </div>
  </main>
  <script nonce="e2etestnonce">
    document.getElementById('turn1-expand-btn').addEventListener('click', function () {
      this.setAttribute('aria-expanded', 'true');
      var qt = document.getElementById('turn1-query-text');
      var p2 = document.createElement('p');
      p2.className = 'query-text-line';
      p2.textContent = '第一轮展开后的第二段完整正文：这里包含了前面折叠起来的后半段需求说明、产品亮点细节与最终补充要求，确保扩展会自动点击仅图标的折叠按钮并抓到全文 ${TURN1_SENTINEL}';
      qt.appendChild(p2);
    });
  </script>
</body>
</html>`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callConversationService(method, payload) {
  const addr = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!addr || !csrf) {
    throw new Error('Missing ANTIGRAVITY_LS_ADDRESS or ANTIGRAVITY_CSRF_TOKEN');
  }
  const resp = await fetch(`http://${addr}/product.v1.ConversationService/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
      'x-antigravity-csrf-token': csrf,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`${method} HTTP ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

async function main() {
  fs.mkdirSync(WATCH_DIR, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gce-e2e-'));
  const defaultProfileDir = path.join(userDataDir, 'Default');
  fs.mkdirSync(defaultProfileDir, { recursive: true });
  fs.writeFileSync(
    path.join(defaultProfileDir, 'Preferences'),
    JSON.stringify({
      download: {
        default_directory: DOWNLOADS_ROOT,
        prompt_for_download: false,
      },
    }),
  );

  let context = null;
  let createdConvId = null;
  const errors = [];

  try {
    console.log('[E2E] Launching Chromium with unpacked MV3 extension...');
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    }
    const extensionId = new URL(sw.url()).host;
    console.log('[E2E] Extension Service Worker loaded:', extensionId);

    sw.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`[sw console.error] ${msg.text()}`);
      }
    });

    await context.route('https://gemini.google.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: {
          'content-security-policy':
            "require-trusted-types-for 'script'; script-src 'nonce-e2etestnonce' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:; object-src 'none'; base-uri 'self'",
        },
        body: MOCK_GEMINI_HTML,
      });
    });

    const geminiPage = context.pages()[0] || (await context.newPage());
    const cdp = await context.newCDPSession(geminiPage);
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'default',
    });
    let contentLoaded = false;
    geminiPage.on('console', (msg) => {
      if (msg.text().includes('[Gemini Chat Exporter] Content script loaded')) {
        contentLoaded = true;
      }
      if (msg.type() === 'error') {
        errors.push(`[gemini console.error] ${msg.text()}`);
      }
    });
    geminiPage.on('pageerror', (err) => {
      errors.push(`[gemini pageerror] ${err.message}`);
    });

    await geminiPage.goto('https://gemini.google.com/app/e2e-verify-001', { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 40 && !contentLoaded; i += 1) {
      await sleep(100);
    }
    if (!contentLoaded) {
      throw new Error('Content script did not log loaded message on Gemini page');
    }
    console.log('[E2E] Content script injected cleanly on gemini.google.com');

    // Open extension popup as a separate unfocused window so Gemini remains the active tab
    // in the primary browser window (`currentWindow: true` in background SW).
    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    const popupPromise = context.waitForEvent('page', {
      predicate: (p) => p.url() === popupUrl,
      timeout: 10_000,
    });
    const { geminiWinId } = await sw.evaluate(async (url) => {
      const wins = await chrome.windows.getAll({ populate: true });
      const mainWin = wins.find((w) => w.tabs?.some((t) => t.url?.startsWith('https://gemini.google.com/')));
      await chrome.windows.create({ url, type: 'popup', width: 420, height: 640, focused: false });
      if (mainWin?.id) {
        await chrome.windows.update(mainWin.id, { focused: true });
      }
      return { geminiWinId: mainWin?.id ?? null };
    }, popupUrl);

    const popupPage = await popupPromise;
    popupPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`[popup console.error] ${msg.text()}`);
      }
    });
    popupPage.on('pageerror', (err) => {
      errors.push(`[popup pageerror] ${err.message}`);
    });

    await popupPage.waitForSelector('#btn-export-file:not([disabled])', { timeout: 10_000 });
    await sw.evaluate(async (winId) => {
      if (winId) await chrome.windows.update(winId, { focused: true });
    }, geminiWinId);

    console.log('[E2E] Clicking #btn-export-file inside extension popup...');
    await popupPage.evaluate(() => {
      const btn = document.getElementById('btn-export-file');
      if (!btn) throw new Error('#btn-export-file not found');
      btn.click();
    });

    let exportedFound = false;
    for (let i = 0; i < 60; i += 1) {
      if (fs.existsSync(EXPECTED_MD_PATH) && fs.statSync(EXPECTED_MD_PATH).size > 0) {
        exportedFound = true;
        break;
      }
      const statusText = await popupPage.evaluate(() => document.body.innerText);
      if (statusText.includes('导出失败') || statusText.includes('Export failed') || statusText.includes('not available')) {
        throw new Error(`Popup reported error: ${statusText}`);
      }
      await sleep(250);
    }

    if (!exportedFound) {
      const statusText = await popupPage.evaluate(() => document.body.innerText);
      const downloads = await sw.evaluate(() => chrome.downloads.search({}));
      throw new Error(
        `Exported file not found at ${EXPECTED_MD_PATH}. Downloads=${JSON.stringify(downloads)}. Popup text: ${statusText}`,
      );
    }

    const mdContent = fs.readFileSync(EXPECTED_MD_PATH, 'utf-8');
    if (
      !mdContent.includes(`title: "${EXPECTED_TITLE}"`) ||
      !mdContent.includes(TURN1_SENTINEL) ||
      !mdContent.includes(TURN3_SENTINEL)
    ) {
      throw new Error(`Missing full multi-paragraph/collapsed user message content:\n${mdContent}`);
    }
    if (
      mdContent.includes('你说') ||
      mdContent.includes('keyboard_arrow_down') ||
      mdContent.includes(TURN1_TRUNCATED_H2) ||
      mdContent.includes(TURN3_TRUNCATED_H2)
    ) {
      throw new Error(`Leaked cdk-visually-hidden heading or icon text into Markdown:\n${mdContent}`);
    }
    console.log('[E2E] Real Chrome download verified:', EXPECTED_MD_PATH);

    let syncedRecord = null;
    for (let i = 0; i < 32; i += 1) {
      if (fs.existsSync(SIDECAR_STATE_FILE)) {
        try {
          const state = JSON.parse(fs.readFileSync(SIDECAR_STATE_FILE, 'utf-8'));
          const entries = Object.entries(state.processed_hashes || {});
          const match = entries.find(([, rec]) => rec.title === EXPECTED_TITLE);
          if (match) {
            syncedRecord = { hash: match[0], ...match[1] };
            break;
          }
        } catch {
          // Ignore transient read during atomic replace
        }
      }
      await sleep(250);
    }

    if (!syncedRecord?.conversationId) {
      throw new Error('Live Sidecar did not import the downloaded Markdown within 8 seconds');
    }
    createdConvId = syncedRecord.conversationId;
    console.log('[E2E] Live Sidecar created conversation:', createdConvId);

    const conv = await callConversationService('GetConversation', { conversationId: createdConvId });
    if (PROJECT_ID && conv?.metadata?.projectId !== PROJECT_ID) {
      throw new Error(`projectId mismatch: ${conv?.metadata?.projectId}`);
    }
    if (conv?.annotations?.title !== EXPECTED_TITLE) {
      throw new Error(`title mismatch: ${conv?.annotations?.title}`);
    }
    if (!Array.isArray(conv?.metadata?.tags) || !conv.metadata.tags.includes('gemini-web-sync')) {
      throw new Error(`tags mismatch: ${JSON.stringify(conv?.metadata?.tags)}`);
    }

    if (errors.length > 0) {
      throw new Error(`Browser/SW console errors observed:\n${errors.join('\n')}`);
    }

    console.log('[E2E] PASS: Full Chrome MV3 extension -> Download -> Live Sidecar -> Antigravity ConversationService verified!');
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });

    if (createdConvId) {
      await callConversationService('DeleteConversation', { conversationId: createdConvId }).catch((e) => {
        console.warn('[E2E] Cleanup DeleteConversation warning:', e.message);
      });
    }
    if (fs.existsSync(EXPECTED_MD_PATH)) {
      fs.rmSync(EXPECTED_MD_PATH, { force: true });
    }
    const backupPath = path.join(IMPORTS_DIR, `${EXPECTED_TITLE}.md`);
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { force: true });
    }
    if (fs.existsSync(SIDECAR_STATE_FILE)) {
      try {
        const state = JSON.parse(fs.readFileSync(SIDECAR_STATE_FILE, 'utf-8'));
        for (const [k, v] of Object.entries(state.processed_hashes || {})) {
          if (v?.title === EXPECTED_TITLE || v?.conversationId === createdConvId) {
            delete state.processed_hashes[k];
          }
        }
        fs.writeFileSync(SIDECAR_STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf-8');
      } catch {
        // ignore
      }
    }
  }
}

main().catch((err) => {
  console.error('[E2E] FAIL:', err);
  process.exit(1);
});

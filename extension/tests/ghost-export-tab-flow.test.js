const fs = require('fs');
const path = require('path');

const ghostScriptPath = path.join(__dirname, '..', 'public', 'ghost.js');
const ghostScriptSource = fs.readFileSync(ghostScriptPath, 'utf8');

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ghost PDF export tab flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <div id="ghost-status-banner" role="status" aria-live="polite">
        <span id="ghost-status-text">Preparing PDF export…</span>
      </div>
      <div id="content-container"></div>
    `;
    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      configurable: true,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  test('activates ghost tab for saveAsPDF, then restores previous tab and closes itself', async () => {
    const { browserMock, storageLocal } = globalThis.__EXTENSION_TEST_UTILS__;

    storageLocal.__setStore({
      gemini_ghost_export_payload_export123: {
        html: '<article class="chat-document">Custom PDF Layout</article>',
        title: 'Chat title',
        filename: 'Chat.pdf',
        theme: 'theme-notion',
        language: 'en-US',
        previousActiveTabId: 42,
        previousWindowId: 3,
      },
    });

    browserMock.tabs.getCurrent.mockResolvedValue({
      id: 7,
      active: false,
      windowId: 3,
    });
    browserMock.tabs.update.mockImplementation(async (tabId, props) => ({ id: tabId, ...props }));

    window.history.replaceState({}, '', '/ghost.html?exportId=export123&theme=theme-notion&lang=en-US');

    window.eval(ghostScriptSource);
    await flushMicrotasks();

    await jest.advanceTimersByTimeAsync(32);
    await flushMicrotasks();
    await jest.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    expect(document.getElementById('content-container').innerHTML).toContain('Custom PDF Layout');
    expect(document.getElementById('ghost-status-text').textContent).toContain('The PDF has been generated and saving has started');
    expect(browserMock.tabs.update).toHaveBeenNthCalledWith(1, 7, { active: true });
    expect(browserMock.tabs.saveAsPDF).toHaveBeenCalledTimes(1);
    expect(browserMock.tabs.update).toHaveBeenNthCalledWith(2, 42, { active: true });

    expect(browserMock.tabs.remove).toHaveBeenCalledWith(7);
    expect(storageLocal.remove).toHaveBeenCalledWith('gemini_ghost_export_payload_export123');
  });

  test('waits for attachment images to load before calling saveAsPDF', async () => {
    const { browserMock, storageLocal } = globalThis.__EXTENSION_TEST_UTILS__;

    storageLocal.__setStore({
      gemini_ghost_export_payload_export456: {
        html: '<article class="chat-document"><img class="message-attachment__image" src="https://lh3.googleusercontent.com/example" alt="chat attachment 1" /></article>',
        title: 'Chat title',
        filename: 'Chat.pdf',
        theme: 'theme-notion',
        language: 'zh-CN',
        previousActiveTabId: 42,
        previousWindowId: 3,
      },
    });

    browserMock.tabs.getCurrent.mockResolvedValue({
      id: 7,
      active: false,
      windowId: 3,
    });
    browserMock.tabs.update.mockImplementation(async (tabId, props) => ({ id: tabId, ...props }));

    window.history.replaceState({}, '', '/ghost.html?exportId=export456&theme=theme-notion&lang=zh-CN&debug=1');

    window.eval(ghostScriptSource);
    await flushMicrotasks();
    expect(document.getElementById('ghost-status-text').textContent).toContain('正在生成并保存 PDF');
    await jest.advanceTimersByTimeAsync(32);
    await flushMicrotasks();

    const img = document.querySelector('.message-attachment__image');
    expect(img).toBeTruthy();
    Object.defineProperty(img, 'complete', { value: false, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 0, configurable: true });

    expect(browserMock.tabs.saveAsPDF).not.toHaveBeenCalled();

    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 640, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 480, configurable: true });
    img.dispatchEvent(new Event('load'));

    await flushMicrotasks();
    await jest.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    expect(browserMock.tabs.saveAsPDF).toHaveBeenCalledTimes(1);
  });
});
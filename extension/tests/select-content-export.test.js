const React = require('react');

const getMessageNodesMock = jest.fn();

jest.mock('@/content/dom-parser', () => {
  const getNodes = () => {
    const mocked = getMessageNodesMock();
    if (mocked) return mocked;
    return Array.from(document.querySelectorAll('[data-test-message]'));
  };

  return {
    parseMessages: jest.fn(async (onlySelected) => {
      const nodes = getNodes().filter((node) => !onlySelected || node.classList.contains('gce-message-selected'));
      return nodes.map((node, index) => ({
        role: index % 2 === 0 ? 'user' : 'model',
        content: node.textContent || '',
        contentHtml: `<p>${node.textContent || ''}</p>`,
        images: [],
        timestamp: 1,
      }));
    }),
    parseTitle: jest.fn(() => 'Selected Chat'),
    parseChatId: jest.fn(() => 'chat-selected'),
    parseChatList: jest.fn(() => []),
    getMessageNodes: jest.fn(() => getNodes()),
  };
});

jest.mock('@/content/metadata-fetcher', () => ({
  fetchAuthorName: jest.fn(() => 'Tester'),
  fetchModelVersion: jest.fn(() => 'Gemini 2.0'),
}));

jest.mock('@/shared/constants', () => ({
  buildFilename: jest.fn(() => 'Selected Chat.md'),
}));

jest.mock('@/shared/standard-chat-html', () => ({
  buildStandardChatHtml: jest.fn(() => '<div>selected html</div>'),
}));

describe('select content export flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    getMessageNodesMock.mockReset();
    getMessageNodesMock.mockImplementation(() => Array.from(document.querySelectorAll('[data-test-message]')));
    document.body.innerHTML = `
      <button id="expand-btn">Show more</button>
      <div data-test-message="1">First message</div>
      <div data-test-message="2">Second message</div>
      <div data-test-message="3">Third message</div>
    `;

    document.getElementById('expand-btn').addEventListener('click', () => {
      document.body.setAttribute('data-expanded', '1');
    });

    globalThis.scrollTo = jest.fn();
    Object.defineProperty(navigator, 'language', {
      value: 'en-US',
      configurable: true,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('waits for confirmation and triggers selected export through background messaging', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    browserMock.runtime.sendMessage.mockImplementation(async (message) => {
      if (message.action === 'EXPORT_SESSION') {
        return { success: true, taskId: 'task-selected' };
      }
      return { success: true };
    });

    require('@/content/index');
    const listener = browserMock.runtime.onMessage.addListener.mock.calls.at(-1)[0];

    const resultPromise = listener({
      action: 'SELECT_MESSAGES_FOR_EXPORT',
      format: 'markdown',
      settings: {
        language: 'en-US',
        defaultExportFormat: 'markdown',
        defaultOutputMode: 'download',
        userLabelMode: 'you',
        includeImages: false,
        imageQuality: 0.8,
        maxImageWidth: 1200,
      },
    });

    await jest.runAllTimersAsync();

    expect(globalThis.scrollTo).toHaveBeenCalled();
    expect(document.body.getAttribute('data-expanded')).toBe('1');
    expect(document.getElementById('gce-selection-panel')).toBeTruthy();

    const confirmBtn = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Export Selection');
    expect(confirmBtn).toBeTruthy();
    confirmBtn.click();

    const result = await resultPromise;
    expect(result).toEqual({ success: true });
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXPORT_SESSION',
      format: 'markdown',
    }));
  });

  test('keeps loading overlay visible while earlier messages are being prepared and selects the fully loaded set by default', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    browserMock.runtime.sendMessage.mockResolvedValue({ success: true, taskId: 'task-selected' });
    Object.defineProperty(navigator, 'language', {
      value: 'zh-CN',
      configurable: true,
    });

    document.body.insertAdjacentHTML('beforeend', '<div data-test-message="0">Earliest message</div>');

    let getNodesCallCount = 0;
    getMessageNodesMock.mockImplementation(() => {
      const nodes = Array.from(document.querySelectorAll('[data-test-message]'));
      getNodesCallCount += 1;
      return getNodesCallCount < 2 ? nodes.slice(1) : nodes;
    });

    require('@/content/index');
    const listener = browserMock.runtime.onMessage.addListener.mock.calls.at(-1)[0];

    const resultPromise = listener({
      action: 'SELECT_MESSAGES_FOR_EXPORT',
      format: 'markdown',
      settings: {
        language: 'en-US',
        defaultExportFormat: 'markdown',
        defaultOutputMode: 'download',
        userLabelMode: 'you',
        includeImages: false,
        imageQuality: 0.8,
        maxImageWidth: 1200,
      },
    });

    expect(document.getElementById('gce-selection-loading-overlay')).toBeTruthy();
  expect(document.getElementById('gce-selection-loading-overlay').textContent).toMatch(/Preparing selection export|Expanding conversation content|Loading the earliest messages\. Please wait/);

    await jest.runAllTimersAsync();

    expect(document.getElementById('gce-selection-loading-overlay')).toBeFalsy();
    expect(document.getElementById('gce-selection-panel')).toBeTruthy();
    expect(document.querySelectorAll('.gce-message-selected')).toHaveLength(4);
    expect(document.getElementById('gce-selection-panel').textContent).toContain('Selected 4');

    Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Cancel').click();
    await expect(resultPromise).resolves.toEqual({ success: false, cancelled: true });
  });

  test('supports select-all toggle and keeps confirm disabled when nothing is selected', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    browserMock.runtime.sendMessage.mockResolvedValue({ success: true, taskId: 'task-selected' });

    require('@/content/index');
    const listener = browserMock.runtime.onMessage.addListener.mock.calls.at(-1)[0];

    const resultPromise = listener({
      action: 'SELECT_MESSAGES_FOR_EXPORT',
      format: 'markdown',
      settings: {
        language: 'en-US',
        defaultExportFormat: 'markdown',
        defaultOutputMode: 'download',
        userLabelMode: 'you',
        includeImages: false,
        imageQuality: 0.8,
        maxImageWidth: 1200,
      },
    });

    await jest.runAllTimersAsync();

    const buttons = Array.from(document.querySelectorAll('button'));
    const toggleAllBtn = buttons.find((button) => button.textContent === 'Deselect All');
    const confirmBtn = buttons.find((button) => button.textContent === 'Export Selection');
    const cancelBtn = buttons.find((button) => button.textContent === 'Cancel');

    expect(toggleAllBtn).toBeTruthy();
    expect(confirmBtn).toBeTruthy();

    toggleAllBtn.click();
    expect(confirmBtn.disabled).toBe(true);
    expect(toggleAllBtn.textContent).toBe('Select All');

    toggleAllBtn.click();
    expect(confirmBtn.disabled).toBe(false);
    expect(toggleAllBtn.textContent).toBe('Deselect All');

    cancelBtn.click();
    const result = await resultPromise;
    expect(result).toEqual({ success: false, cancelled: true });
  });
});
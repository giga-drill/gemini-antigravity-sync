const parseMessagesMock = jest.fn();

jest.mock('@/content/dom-parser', () => ({
  parseMessages: parseMessagesMock,
  parseTitle: jest.fn(() => 'Chat With Images'),
  parseChatId: jest.fn(() => 'chat-with-images'),
  parseChatList: jest.fn(() => []),
  getMessageNodes: jest.fn(() => []),
}));

parseMessagesMock.mockImplementation(async () => ([
    {
      role: 'user',
      content: 'Please export my images',
      contentHtml: '<p>Please export my images</p>',
      images: ['data:image/png;base64,USER-UPLOAD'],
      timestamp: 1,
    },
    {
      role: 'model',
      content: 'Here are generated images',
      contentHtml: '<p>Here are generated images</p>',
      images: [
        'data:image/jpeg;base64,GENERATED-ONE',
        'https://lh3.googleusercontent.com/generated-image=s1024-rj',
      ],
      timestamp: 2,
    },
  ]));

jest.mock('@/content/metadata-fetcher', () => ({
  fetchAuthorName: jest.fn(() => 'Tester'),
  fetchModelVersion: jest.fn(() => 'Gemini 2.0'),
}));

jest.mock('@/shared/constants', () => ({
  buildFilename: jest.fn(() => 'Chat With Images.pdf'),
}));

describe('current chat PDF export with images', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    parseMessagesMock.mockReset();
    parseMessagesMock.mockImplementation(async () => ([
      {
        role: 'user',
        content: 'Please export my images',
        contentHtml: '<p>Please export my images</p>',
        images: ['data:image/png;base64,USER-UPLOAD'],
        timestamp: 1,
      },
      {
        role: 'model',
        content: 'Here are generated images',
        contentHtml: '<p>Here are generated images</p>',
        images: [
          'data:image/jpeg;base64,GENERATED-ONE',
          'https://lh3.googleusercontent.com/generated-image=s1024-rj',
        ],
        timestamp: 2,
      },
    ]));
    document.body.innerHTML = '<main><div data-turn-id="1">turn</div></main>';
    globalThis.scrollTo = jest.fn();
    globalThis.scrollBy = jest.fn();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('builds ghost PDF html from parsed messages so images are included', async () => {
    const { browserMock, storageLocal } = globalThis.__EXTENSION_TEST_UTILS__;

    require('@/content/index');
    const listener = browserMock.runtime.onMessage.addListener.mock.calls.at(-1)[0];

    const resultPromise = listener({
      action: 'EXTRACT_GEMINI_CHAT_HTML',
      theme: 'theme-notion',
      settings: {
        language: 'en-US',
        defaultExportFormat: 'pdf',
        defaultOutputMode: 'download',
        userLabelMode: 'you',
        includeImages: true,
      },
    });

    expect(document.getElementById('gce-selection-loading-overlay')).toBeTruthy();
    expect(document.getElementById('gce-selection-loading-overlay').textContent).toMatch(/Preparing current conversation|Expanding conversation content|Loading the earliest messages\. Please wait/);

    await jest.runAllTimersAsync();

    const result = await resultPromise;
    expect(result).toEqual(expect.objectContaining({
      success: true,
      title: 'Chat With Images',
      filename: 'Chat With Images.pdf',
      html: expect.stringContaining('data:image/png;base64,USER-UPLOAD'),
    }));
    expect(result.html).not.toContain('data:image/jpeg;base64,GENERATED-ONE');
    expect(result.html).not.toContain('https://lh3.googleusercontent.com/generated-image=s1024-rj');
    expect(result.html).toContain('message-attachment__image');
    expect(result.html).toContain('loading="eager"');
    expect(result.html).toContain('referrerpolicy="no-referrer"');
    expect(result.theme).toBe('theme-notion');

    const storedPayload = storageLocal.__getStore();
    expect(storedPayload.gemini_clean_html).toContain('data:image/png;base64,USER-UPLOAD');
    expect(storedPayload.gemini_clean_html).not.toContain('data:image/jpeg;base64,GENERATED-ONE');
    expect(document.getElementById('gce-selection-loading-overlay')).toBeFalsy();
  });

  test('does not wait for the legacy clean-html cache write before returning the PDF payload', async () => {
    const { browserMock, storageLocal } = globalThis.__EXTENSION_TEST_UTILS__;

    require('@/content/index');
    const listener = browserMock.runtime.onMessage.addListener.mock.calls.at(-1)[0];

    let resolveStorageWrite;
    storageLocal.set.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStorageWrite = resolve;
    }));

    const resultPromise = listener({
      action: 'EXTRACT_GEMINI_CHAT_HTML',
      theme: 'theme-notion',
      settings: {
        language: 'en-US',
        defaultExportFormat: 'pdf',
        defaultOutputMode: 'download',
        userLabelMode: 'you',
        includeImages: true,
      },
    });

    await jest.runAllTimersAsync();

    let settled = false;
    let resolvedResult;
    resultPromise.then((value) => {
      settled = true;
      resolvedResult = value;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(storageLocal.set).toHaveBeenCalled();
    expect(settled).toBe(true);
    expect(resolvedResult).toEqual(expect.objectContaining({
      success: true,
      title: 'Chat With Images',
      filename: 'Chat With Images.pdf',
    }));

    resolveStorageWrite();
    await expect(resultPromise).resolves.toEqual(expect.objectContaining({ success: true }));
  });

  test('shows a Chinese loading hint while fetching the earliest messages for current chat extraction', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;

    require('@/content/index');
    const listener = browserMock.runtime.onMessage.addListener.mock.calls.at(-1)[0];

    const resultPromise = listener({
      action: 'EXTRACT_CURRENT_CHAT',
      settings: {
        language: 'zh-CN',
        defaultExportFormat: 'markdown',
        defaultOutputMode: 'download',
        userLabelMode: 'you',
        includeImages: false,
      },
    });

    expect(document.getElementById('gce-selection-loading-overlay')).toBeTruthy();
    expect(document.getElementById('gce-selection-loading-overlay').textContent).toMatch(/正在准备当前会话内容|正在展开会话内容|正在拉取最早的对话内容，请稍候/);

    await jest.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({ success: true }));
    expect(document.getElementById('gce-selection-loading-overlay')).toBeFalsy();
  });

  test('current chat extraction preserves the newest turns that were only visible before scrolling to the top', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;

    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 2400,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      configurable: true,
    });

    parseMessagesMock.mockImplementation(async () => {
      if (document.documentElement.scrollTop > 0) {
        return [
          {
            role: 'user',
            content: 'Newest user message',
            contentHtml: '<p>Newest user message</p>',
            images: [],
            timestamp: 3,
          },
          {
            role: 'model',
            content: 'Newest model reply',
            contentHtml: '<p>Newest model reply</p>',
            images: [],
            timestamp: 4,
          },
        ];
      }

      return [
        {
          role: 'user',
          content: 'Earliest user message',
          contentHtml: '<p>Earliest user message</p>',
          images: [],
          timestamp: 1,
        },
        {
          role: 'model',
          content: 'Earliest model reply',
          contentHtml: '<p>Earliest model reply</p>',
          images: [],
          timestamp: 2,
        },
      ];
    });

    require('@/content/index');
    const listener = browserMock.runtime.onMessage.addListener.mock.calls.at(-1)[0];

    const resultPromise = listener({
      action: 'EXTRACT_CURRENT_CHAT',
      format: 'html',
      settings: {
        language: 'en-US',
        defaultExportFormat: 'html',
        defaultOutputMode: 'download',
        userLabelMode: 'you',
        includeImages: false,
      },
    });

    await jest.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        messages: [
          expect.objectContaining({ content: 'Earliest user message' }),
          expect.objectContaining({ content: 'Earliest model reply' }),
          expect.objectContaining({ content: 'Newest user message' }),
          expect.objectContaining({ content: 'Newest model reply' }),
        ],
      }),
    }));
  });
});

jest.mock('@/storage/db', () => ({
  upsertSession: jest.fn(),
  upsertWebSummaries: jest.fn(),
  getSession: jest.fn(),
  deleteSession: jest.fn(),
  getAllSessionSummaries: jest.fn(),
  searchSessions: jest.fn(),
  getSettings: jest.fn(),
  getStoredSettings: jest.fn(),
  saveSettings: jest.fn(),
}));

jest.mock('@/background/task-manager', () => ({
  executeExportTask: jest.fn(),
  startExportTask: jest.fn(),
  getActiveTasks: jest.fn(() => []),
}));

jest.mock('@/exporters/html-exporter', () => ({
  HtmlExporter: jest.fn().mockImplementation(() => ({
    export: jest.fn(),
  })),
}));

jest.mock('@/shared/constants', () => ({
  buildFilename: jest.fn(() => 'Gemini Chat Export.pdf'),
}));

jest.mock('@/shared/standard-chat-html', () => ({
  buildStandardChatHtml: jest.fn(() => '<div></div>'),
}));

const storageDb = require('@/storage/db');
const taskManager = require('@/background/task-manager');
const language = require('@/shared/language');
const { handleMessage } = require('@/background/message-handler');

describe('language resolution helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('resolvePreferredLanguage prefers explicit user_lang over settings and browser language', async () => {
    const { storageLocal, browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    storageLocal.__setStore({
      user_lang: 'en-US',
      user_settings: { language: 'zh-CN' },
    });
    browserMock.i18n.getUILanguage.mockReturnValue('zh-HK');

    const result = await language.resolvePreferredLanguage();

    expect(result).toBe('en-US');
  });

  test('resolvePreferredLanguage migrates stored settings language when explicit user_lang is missing', async () => {
    const { storageLocal } = globalThis.__EXTENSION_TEST_UTILS__;
    storageLocal.__setStore({
      user_settings: { language: 'zh-CN' },
    });

    const result = await language.resolvePreferredLanguage();

    expect(result).toBe('zh-CN');
    expect(storageLocal.set).toHaveBeenCalledWith({ user_lang: 'zh-CN' });
  });

  test('resolvePreferredLanguage falls back to browser sniffing and maps zh variants to zh-CN', async () => {
    const { storageLocal, browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    storageLocal.__setStore({});
    browserMock.i18n.getUILanguage.mockReturnValue('zh-HK');

    const result = await language.resolvePreferredLanguage({ migrateLegacyLanguage: false });

    expect(result).toBe('zh-CN');
  });

  test('persistPreferredLanguage writes both browser.storage.local and localStorage', async () => {
    const { storageLocal } = globalThis.__EXTENSION_TEST_UTILS__;

    const result = await language.persistPreferredLanguage('en-US');

    expect(result).toBe('en-US');
    expect(storageLocal.set).toHaveBeenCalledWith({ user_lang: 'en-US' });
    expect(localStorage.getItem('gce_language')).toBe('en-US');
  });
});

describe('message handler settings routes', () => {
  beforeEach(() => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    const tabUpdateListeners = new Set();

    browserMock.tabs.onUpdated.addListener.mockImplementation((listener) => {
      tabUpdateListeners.add(listener);
    });
    browserMock.tabs.onUpdated.removeListener.mockImplementation((listener) => {
      tabUpdateListeners.delete(listener);
    });
    browserMock.tabs.update.mockImplementation(async (tabId, updateInfo) => {
      if (updateInfo?.url) {
        setTimeout(() => {
          for (const listener of Array.from(tabUpdateListeners)) {
            listener(tabId, { status: 'complete' });
          }
        }, 0);
      }
      return { id: tabId, ...updateInfo };
    });
  });

  test('PING responds successfully for background availability checks', async () => {
    const result = await handleMessage({ action: 'PING' }, {});

    expect(result).toEqual({ success: true });
  });

  test('FETCH_IMAGE_AS_DATA_URL retrieves allowed googleusercontent images in the background', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['background-image'], { type: 'image/jpeg' }),
    }));

    const result = await handleMessage({
      action: 'FETCH_IMAGE_AS_DATA_URL',
      src: 'https://lh3.googleusercontent.com/generated-image=s1024-rj',
      pageUrl: 'https://gemini.google.com/app/test-chat',
    }, {});

    expect(global.fetch).toHaveBeenCalledWith(
      'https://lh3.googleusercontent.com/generated-image=s1024-rj',
      expect.objectContaining({
        credentials: 'include',
        cache: 'force-cache',
        referrer: 'https://gemini.google.com/app/test-chat',
        referrerPolicy: 'strict-origin-when-cross-origin',
      }),
    );
    expect(result).toEqual({
      success: true,
      dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });

    global.fetch = originalFetch;
  });

  test('FETCH_IMAGE_AS_DATA_URL retries with weaker strategies after a background fetch failure', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('NetworkError when attempting to fetch resource.'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => new Blob(['retry-success'], { type: 'image/jpeg' }),
      });

    const result = await handleMessage({
      action: 'FETCH_IMAGE_AS_DATA_URL',
      src: 'https://lh3.googleusercontent.com/generated-image=s1024-rj',
      pageUrl: 'https://gemini.google.com/app/test-chat',
    }, {});

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://lh3.googleusercontent.com/generated-image=s1024-rj',
      expect.objectContaining({
        credentials: 'include',
        referrer: 'https://gemini.google.com/app/test-chat',
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://lh3.googleusercontent.com/generated-image=s1024-rj',
      expect.objectContaining({
        credentials: 'include',
        referrer: 'https://gemini.google.com/',
        referrerPolicy: 'origin',
      }),
    );
    expect(result).toEqual({
      success: true,
      dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });

    global.fetch = originalFetch;
  });

  test('FETCH_IMAGE_AS_DATA_URL falls back to a temporary navigation tab when fetch stays blocked', async () => {
    const originalFetch = global.fetch;
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;

    global.fetch = jest.fn(async () => {
      throw new Error('NetworkError when attempting to fetch resource.');
    });

    browserMock.tabs.query.mockResolvedValue([
      { id: 42, active: true, windowId: 7, url: 'https://gemini.google.com/app/test-chat' },
    ]);
    browserMock.tabs.create.mockResolvedValue({
      id: 99,
      active: false,
      status: 'complete',
      windowId: 7,
      url: 'https://lh3.googleusercontent.com/generated-image=s1024-rj',
    });
    browserMock.scripting.executeScript.mockResolvedValue([
      { result: 'data:image/png;base64,NAVIGATION_FALLBACK' },
    ]);

    const result = await handleMessage({
      action: 'FETCH_IMAGE_AS_DATA_URL',
      src: 'https://lh3.googleusercontent.com/generated-image=s1024-rj',
      pageUrl: 'https://gemini.google.com/app/test-chat',
    }, {});

    expect(browserMock.tabs.create).toHaveBeenCalledWith(expect.objectContaining({
      active: false,
      windowId: 7,
      url: 'https://lh3.googleusercontent.com/generated-image=s1024-rj',
    }));
    expect(browserMock.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 99 },
      args: ['https://lh3.googleusercontent.com/generated-image=s1024-rj'],
      func: expect.any(Function),
    }));
    expect(browserMock.tabs.remove).toHaveBeenCalledWith(99);
    expect(result).toEqual({
      success: true,
      dataUrl: 'data:image/png;base64,NAVIGATION_FALLBACK',
    });

    global.fetch = originalFetch;
  });

  test('FETCH_IMAGE_AS_DATA_URL rejects non-whitelisted hosts', async () => {
    const result = await handleMessage({
      action: 'FETCH_IMAGE_AS_DATA_URL',
      src: 'https://example.com/not-allowed.jpg',
    }, {});

    expect(result).toEqual({
      success: false,
      error: 'URL is not allowed for background image fetch',
    });
  });

  test('GET_SETTINGS merges persisted settings with resolved preferred language', async () => {
    storageDb.getSettings.mockResolvedValue({
      language: 'en-US',
      defaultExportFormat: 'html',
      defaultOutputMode: 'download',
      userLabelMode: 'you',
      includeImages: false,
    });
    storageDb.getStoredSettings.mockResolvedValue({ language: 'zh-CN' });

    const resolveSpy = jest.spyOn(language, 'resolvePreferredLanguage').mockResolvedValue('zh-CN');

    const result = await handleMessage({ action: 'GET_SETTINGS' }, {});

    expect(resolveSpy).toHaveBeenCalledWith({
      fallbackLanguage: 'zh-CN',
      migrateLegacyLanguage: false,
    });
    expect(result).toEqual({
      success: true,
      data: {
        language: 'zh-CN',
        defaultExportFormat: 'html',
        defaultOutputMode: 'download',
        userLabelMode: 'you',
        includeImages: false,
      },
    });

    resolveSpy.mockRestore();
  });

  test('unknown actions return a failure payload instead of throwing', async () => {
    const result = await handleMessage({ action: 'DOES_NOT_EXIST' }, {});

    expect(result).toEqual({
      success: false,
      error: 'Unknown action: DOES_NOT_EXIST',
    });
  });

  test('SAVE_SETTINGS persists the provided settings payload', async () => {
    const settings = {
      language: 'en-US',
      defaultExportFormat: 'txt',
      defaultOutputMode: 'download',
      userLabelMode: 'account-name',
      includeImages: false,
    };

    const result = await handleMessage({ action: 'SAVE_SETTINGS', settings }, {});

    expect(storageDb.saveSettings).toHaveBeenCalledWith(settings);
    expect(result).toEqual({ success: true });
  });

  test('GET_EXPORT_TASKS proxies active task snapshots from the task manager', async () => {
    const tasks = [
      { id: 'task-1', sessionId: 'session-1', sessionTitle: 'Chat', format: 'html', status: 'done', progress: 100 },
    ];
    taskManager.getActiveTasks.mockReturnValue(tasks);

    const result = await handleMessage({ action: 'GET_EXPORT_TASKS' }, {});

    expect(result).toEqual({ success: true, data: tasks });
  });

  test('EXPORT_SESSION starts a background task and returns immediately with task id', async () => {
    const session = {
      id: 'session-1',
      title: 'Chat',
      author: 'Ada',
      url: 'https://gemini.google.com/app',
      exportDate: Date.now(),
      messages: [],
    };
    const settings = {
      language: 'en-US',
      defaultExportFormat: 'markdown',
      defaultOutputMode: 'download',
      userLabelMode: 'you',
      includeImages: false,
    };

    taskManager.startExportTask.mockReturnValue({
      id: 'task-123',
      sessionId: 'session-1',
      sessionTitle: 'Chat',
      format: 'markdown',
      status: 'pending',
      progress: 0,
    });

    const result = await handleMessage({ action: 'EXPORT_SESSION', session, format: 'markdown', settings }, {});

    expect(storageDb.upsertSession).toHaveBeenCalledWith(session);
    expect(taskManager.startExportTask).toHaveBeenCalledWith(session, 'markdown', settings);
    expect(result).toEqual({ success: true, taskId: 'task-123' });
  });

  test('EXTRACT_CURRENT_CHAT returns a friendly error when there is no active tab', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    browserMock.tabs.query.mockResolvedValue([]);

    const result = await handleMessage({ action: 'EXTRACT_CURRENT_CHAT' }, {});

    expect(browserMock.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(result).toEqual({
      success: false,
      error: 'No active tab',
    });
  });

  test('EXTRACT_CURRENT_CHAT rejects non-Gemini tabs before messaging the content script', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    browserMock.tabs.query.mockResolvedValue([
      { id: 42, url: 'https://example.com/not-gemini' },
    ]);

    const result = await handleMessage({ action: 'EXTRACT_CURRENT_CHAT' }, {});

    expect(browserMock.tabs.sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'Please open a Gemini chat page on https://gemini.google.com/ and try again.',
    });
  });

  test('EXTRACT_CURRENT_CHAT recovers when the content receiver becomes available right after injection', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    browserMock.tabs.query.mockResolvedValue([
      { id: 42, url: 'https://gemini.google.com/app' },
    ]);
    browserMock.scripting = {
      executeScript: jest.fn(async () => undefined),
    };

    browserMock.tabs.sendMessage
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce({ success: true, source: 'content' })
      .mockResolvedValueOnce({ success: true, data: { id: 'session-1' } });

    const result = await handleMessage({ action: 'EXTRACT_CURRENT_CHAT' }, {});

    expect(browserMock.scripting.executeScript).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: { id: 'session-1' } });
  });

  test('EXTRACT_CURRENT_CHAT retries the real message after a transient missing receiver error', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    browserMock.tabs.query.mockResolvedValue([
      { id: 42, url: 'https://gemini.google.com/app' },
    ]);
    browserMock.scripting = {
      executeScript: jest.fn(async () => undefined),
    };

    browserMock.tabs.sendMessage
      .mockResolvedValueOnce({ success: true, source: 'content' })
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce({ success: true, source: 'content' })
      .mockResolvedValueOnce({ success: true, data: { id: 'session-2' } });

    const result = await handleMessage({ action: 'EXTRACT_CURRENT_CHAT' }, {});

    expect(browserMock.scripting.executeScript).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: { id: 'session-2' } });
  });

  test('EXTRACT_GEMINI_CHAT_HTML opens ghost export from the content payload without requiring a nested runtime message', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    browserMock.tabs.query.mockResolvedValue([
      { id: 42, url: 'https://gemini.google.com/app/chat-1', windowId: 1, active: true },
    ]);

    browserMock.tabs.sendMessage
      .mockResolvedValueOnce({ success: true, source: 'content' })
      .mockResolvedValueOnce({
        success: true,
        title: 'Chat With Images',
        filename: 'Chat With Images.pdf',
        theme: 'theme-script',
        html: '<div class="message-attachment__image">img</div>',
      });

    browserMock.tabs.create.mockResolvedValue({
      id: 17,
      url: 'moz-extension://test/ghost.html?theme=theme-script&lang=en-US',
      active: false,
      windowId: 1,
    });

    const result = await handleMessage({
      action: 'EXTRACT_GEMINI_CHAT_HTML',
      theme: 'theme-script',
    }, {});

    expect(result).toEqual({ success: true });
    expect(browserMock.tabs.create).toHaveBeenCalledWith(expect.objectContaining({
      active: false,
      url: expect.stringContaining('ghost.html'),
    }));
    const storedPayload = browserMock.storage.local.set.mock.calls[0][0];
    const ghostPayloadEntry = Object.entries(storedPayload).find(([key]) => key.startsWith('gemini_ghost_export_payload_'));
    expect(ghostPayloadEntry).toBeTruthy();
    expect(ghostPayloadEntry[1]).toEqual(expect.objectContaining({
      html: '<div class="message-attachment__image">img</div>',
      title: 'Chat With Images',
      filename: 'Chat With Images.pdf',
      theme: 'theme-script',
      language: 'en-US',
    }));
    expect(browserMock.tabs.create.mock.calls[0][0].url).toContain('lang=en-US');
  });

  test('exportPdf opens ghost page without preview flag by default', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;

    browserMock.tabs.query.mockResolvedValue([
      { id: 42, url: 'https://gemini.google.com/app', windowId: 1, active: true },
    ]);

    browserMock.tabs.create.mockResolvedValue({
      id: 7,
      url: 'moz-extension://test/ghost.html',
      active: false,
      windowId: 1,
    });

    const result = await handleMessage({
      action: 'exportPdf',
      html: '<div>hi</div>',
      title: 'Chat',
      filename: 'Chat.pdf',
    }, {});

    expect(result).toEqual({ success: true });
    expect(browserMock.tabs.create).toHaveBeenCalledTimes(1);

    const createdUrl = browserMock.tabs.create.mock.calls[0][0].url;
    expect(createdUrl).toContain('ghost.html');
    expect(createdUrl).toContain('lang=en-US');
    expect(createdUrl).not.toContain('keepOpen=1');
    expect(createdUrl).not.toContain('debug=1');
    expect(browserMock.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    const storedPayload = browserMock.storage.local.set.mock.calls[0][0];
    const ghostPayloadEntry = Object.entries(storedPayload).find(([key]) => key.startsWith('gemini_ghost_export_payload_'));
    expect(ghostPayloadEntry).toBeTruthy();
    expect(ghostPayloadEntry[1]).toEqual(expect.objectContaining({
      language: 'en-US',
      previousActiveTabId: 42,
      previousWindowId: 1,
    }));
  });

  test('exportPdf keeps ghost preview open when debug switch is enabled', async () => {
    const { browserMock, storageLocal } = globalThis.__EXTENSION_TEST_UTILS__;
    storageLocal.__setStore({ gce_keep_ghost_preview_open: true });

    browserMock.tabs.query.mockResolvedValue([
      { id: 42, url: 'https://gemini.google.com/app', windowId: 1, active: true },
    ]);

    browserMock.tabs.create.mockResolvedValue({
      id: 8,
      url: 'moz-extension://test/ghost.html?keepOpen=1',
      active: true,
      windowId: 1,
    });

    const result = await handleMessage({
      action: 'exportPdf',
      html: '<div>hi</div>',
      title: 'Chat',
      filename: 'Chat.pdf',
    }, {});

    expect(result).toEqual({ success: true });
    const createdUrl = browserMock.tabs.create.mock.calls[0][0].url;
    expect(createdUrl).toContain('lang=en-US');
    expect(createdUrl).toContain('keepOpen=1');
    expect(createdUrl).toContain('debug=1');
    expect(browserMock.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  test('exportPdf enables ghost debug logging without keeping the preview open when debug logging is configured', async () => {
    const { browserMock, storageLocal } = globalThis.__EXTENSION_TEST_UTILS__;
    storageLocal.__setStore({ gce_ghost_debug_logging: true });

    browserMock.tabs.query.mockResolvedValue([
      { id: 42, url: 'https://gemini.google.com/app', windowId: 1, active: true },
    ]);

    browserMock.tabs.create.mockResolvedValue({
      id: 9,
      url: 'moz-extension://test/ghost.html?debug=1',
      active: false,
      windowId: 1,
    });

    const result = await handleMessage({
      action: 'exportPdf',
      html: '<div>hi</div>',
      title: 'Chat',
      filename: 'Chat.pdf',
    }, {});

    expect(result).toEqual({ success: true });
    const createdUrl = browserMock.tabs.create.mock.calls[0][0].url;
    expect(createdUrl).toContain('lang=en-US');
    expect(createdUrl).toContain('debug=1');
    expect(createdUrl).not.toContain('keepOpen=1');
    expect(browserMock.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  test('EXPORT_ALL broadcasts per-chat progress with current index and phase updates', async () => {
    jest.useFakeTimers();
    try {
      const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;

      browserMock.tabs.query.mockResolvedValue([
        { id: 42, url: 'https://gemini.google.com/app', active: true, currentWindow: true },
      ]);

      browserMock.tabs.sendMessage
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({
          success: true,
          data: [{ id: 'chat-1', title: 'Chat One', url: 'https://gemini.google.com/app/chat-1' }],
        })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({
          success: true,
          data: {
            id: 'chat-1',
            title: 'Chat One',
            author: 'Ada',
            exportDate: Date.now(),
            url: 'https://gemini.google.com/app/chat-1',
            messages: [{ role: 'user', content: 'Hello' }],
          },
        });

      taskManager.executeExportTask.mockResolvedValue({
        id: 'task-1',
        sessionId: 'chat-1',
        sessionTitle: 'Chat One',
        format: 'markdown',
        status: 'done',
        progress: 100,
      });

      const exportPromise = handleMessage({
        action: 'EXPORT_ALL',
        format: 'markdown',
        settings: {
          language: 'en-US',
          defaultExportFormat: 'markdown',
          defaultOutputMode: 'download',
          userLabelMode: 'you',
          includeImages: false,
        },
        theme: 'theme-notion',
      }, {});

      await jest.runAllTimersAsync();
      const result = await exportPromise;

      expect(result).toEqual({ success: true, total: 1, exported: 1 });
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'EXPORT_ALL_PROGRESS',
        total: 1,
        exported: 0,
        currentIndex: 0,
        currentProgress: 0,
        phase: 'preparing',
        status: 'in-progress',
      }));
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'EXPORT_ALL_PROGRESS',
        total: 1,
        currentIndex: 1,
        currentProgress: 15,
        phase: 'loading-chat',
        status: 'in-progress',
      }));
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'EXPORT_ALL_PROGRESS',
        total: 1,
        currentIndex: 1,
        currentProgress: 50,
        phase: 'extracting-chat',
        status: 'in-progress',
      }));
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'EXPORT_ALL_PROGRESS',
        total: 1,
        currentIndex: 1,
        currentProgress: 80,
        phase: 'exporting-chat',
        status: 'in-progress',
      }));
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'EXPORT_ALL_PROGRESS',
        total: 1,
        exported: 1,
        processed: 1,
        currentIndex: 1,
        currentProgress: 100,
        phase: 'completed-chat',
        status: 'in-progress',
      }));
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'EXPORT_ALL_PROGRESS',
        total: 1,
        exported: 1,
        processed: 1,
        currentIndex: 1,
        currentProgress: 100,
        phase: 'done',
        status: 'done',
      }));
    } finally {
      jest.useRealTimers();
    }
  });
});
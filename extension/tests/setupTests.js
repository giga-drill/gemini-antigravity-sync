require('@testing-library/jest-dom');

const translations = {
  'popup.title': 'Gemini Chat Exporter',
  'popup.openOptions': 'Open Settings',
  'popup.format': 'Format',
  'popup.markdown': 'Markdown',
  'popup.pdf': 'PDF',
  'popup.html': 'HTML',
  'popup.txt': 'TXT',
  'popup.outputMode': 'Output Mode',
  'popup.download': 'Download as File',
  'popup.clipboard': 'Copy to Clipboard',
  'popup.theme': 'Theme',
  'popup.themeNotion': 'Notion style',
  'popup.themeAcademic': 'Academic paper style',
  'popup.themeScript': 'Dialogue script style',
  'popup.scope': 'Export Scope',
  'popup.scopeCurrent': 'Current Chat',
  'popup.scopeSelected': 'Selected Content',
  'popup.scopeAll': 'All History',
  'popup.scopeHint': 'Choose a scope first, then use the primary action button below.',
  'popup.scopeAllClipboardDisabled': '剪贴板容量有限，批量导出历史记录请切换为「下载为文件」',
  'popup.notebookClipboardOnlyHint': 'Switch Output Mode to Copy to Clipboard to use NotebookLM.',
  'popup.exportAndSave': '🚀 Export and Save',
  'popup.exporting': 'Exporting...',
  'popup.exportingAll': 'Exporting chat {{current}}/{{total}}...',
  'popup.refreshingListBtn': 'Refreshing list...',
  'popup.sendNotebook': '🧠 Send to NotebookLM',
  'popup.sendingNotebookShort': '⏳ Sending...',
  'popup.copiedToClipboard': '✅ Copied to Clipboard!',
  'popup.backgroundUnavailable': 'Background service is not available. Reload the extension and try again.',
  'popup.noChat': 'No chat detected on this page',
  'popup.error': 'Export Failed',
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.defaultFormat': 'Default Format',
  'settings.defaultOutputMode': 'Default Output Mode',
  'settings.userLabelMode': 'User label in exports',
  'settings.userLabelYou': 'Always use "You"',
  'settings.userLabelAccountName': 'Use account name',
  'settings.exportImages': 'Export images',
  'settings.exportImagesHint': 'Only user-uploaded/input images can be exported in this build.',
  'settings.enabled': 'Enabled',
  'settings.disabled': 'Disabled',
  'settings.save': 'Save Settings',
  'settings.saved': 'Settings Saved',
  'status.pending': 'Waiting',
  'status.extracting': 'Extracting data...',
  'status.refreshingList': 'Refreshing chat list...',
  'status.exporting': 'Generating file...',
  'status.nonGeminiEyebrow': 'Quick setup',
  'status.nonGeminiTitle': 'Open a Gemini chat to start exporting',
  'status.nonGeminiDescription': 'This exporter works on Gemini conversation pages. Open any chat on gemini.google.com, then come back and try again.',
  'status.nonGeminiNoActiveTabDescription': 'No browser tab is active right now. Open a Gemini conversation page, then return here to export.',
  'status.nonGeminiTip': 'Tip: once the chat page is open, you can export the current chat, selected content, or your full history from here.',
  'status.openGemini': 'Open Gemini',
  'status.exportAllPreparing': 'Preparing {{total}} chats...',
  'status.exportAllLoading': 'Opening chat {{current}}/{{total}}...',
  'status.exportAllExtracting': 'Extracting chat {{current}}/{{total}}...',
  'status.exportAllSaving': 'Saving chat {{current}}/{{total}}...',
  'status.exportAllCompleted': 'Finished chat {{current}}/{{total}}.',
  'status.exportAllFailed': 'Failed to export chat {{current}}/{{total}}.',
  'status.exportAllSkipped': 'Skipped chat {{current}}/{{total}}.',
  'status.exportAllDetail': 'Chat {{current}}/{{total}} · Exported {{exported}}',
  'status.sendingToNotebookLM': 'Sending to NotebookLM...',
  'status.done': 'Complete',
  'status.error': 'Error',
  'feedback.reviewToast': '✅ Export successful! If it helped, a quick five-star review would mean a lot.',
  'feedback.reviewToastLink': '👉 Leave a rating',
};

function translate(key, vars) {
  const template = translations[key] ?? key;
  if (!vars) {
    return template;
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, token) => String(vars[token] ?? ''));
}

function createStorageArea() {
  let store = {};

  const api = {
    get: jest.fn(async (keys) => {
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, store[key]]));
      }

      if (typeof keys === 'string') {
        return { [keys]: store[keys] };
      }

      if (keys && typeof keys === 'object') {
        return Object.fromEntries(
          Object.entries(keys).map(([key, fallback]) => [key, store[key] ?? fallback]),
        );
      }

      return { ...store };
    }),
    set: jest.fn(async (items) => {
      store = { ...store, ...items };
    }),
    remove: jest.fn(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete store[key];
      }
    }),
    clear: jest.fn(async () => {
      store = {};
    }),
    __setStore(nextStore = {}) {
      store = { ...nextStore };
    },
    __getStore() {
      return { ...store };
    },
    __reset() {
      store = {};
      api.get.mockClear();
      api.set.mockClear();
      api.remove.mockClear();
      api.clear.mockClear();
    },
  };

  return api;
}

const storageLocal = createStorageArea();
const storageSession = createStorageArea();

const browserMock = {
  storage: {
    local: storageLocal,
    session: storageSession,
  },
  downloads: {
    download: jest.fn(async () => 1),
  },
  runtime: {
    sendMessage: jest.fn(async () => ({ success: true })),
    getURL: jest.fn((path) => `moz-extension://test/${path}`),
    openOptionsPage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  tabs: {
    create: jest.fn(async () => ({ id: 1 })),
    getCurrent: jest.fn(async () => ({ id: 1, active: true, windowId: 1 })),
    query: jest.fn(async () => []),
    remove: jest.fn(async () => undefined),
    saveAsPDF: jest.fn(async () => 'saved'),
    sendMessage: jest.fn(async () => ({ success: true })),
    update: jest.fn(async () => ({})),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  scripting: {
    executeScript: jest.fn(async () => [{ result: null }]),
  },
  windows: {
    update: jest.fn(async () => ({})),
  },
  i18n: {
    getUILanguage: jest.fn(() => 'en-US'),
  },
};

const chromeMock = {
  storage: browserMock.storage,
  downloads: browserMock.downloads,
  runtime: {
    lastError: undefined,
    sendMessage: browserMock.runtime.sendMessage,
    openOptionsPage: browserMock.runtime.openOptionsPage,
    onMessage: browserMock.runtime.onMessage,
  },
  tabs: {
    create: jest.fn((props, callback) => {
      callback?.();
    }),
  },
};

const i18nMock = {
  language: 'en-US',
  changeLanguage: jest.fn(async (language) => {
    i18nMock.language = language;
  }),
};

globalThis.__TEST_TRANSLATE__ = translate;
globalThis.__TEST_I18N__ = i18nMock;
globalThis.__ENABLE_USER_INPUT_IMAGE_EXPORT__ = true;

Object.defineProperty(globalThis, 'browser', {
  value: browserMock,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, 'chrome', {
  value: chromeMock,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis.navigator, 'clipboard', {
  value: {
    writeText: jest.fn(async () => undefined),
  },
  configurable: true,
});

Object.defineProperty(document, 'execCommand', {
  value: jest.fn(() => true),
  configurable: true,
});

Object.defineProperty(globalThis, 'open', {
  value: jest.fn(),
  configurable: true,
});

Object.defineProperty(globalThis, 'close', {
  value: jest.fn(),
  configurable: true,
});

globalThis.__EXTENSION_TEST_UTILS__ = {
  browserMock,
  chromeMock,
  storageLocal,
  storageSession,
  resetAll() {
    storageLocal.__reset();
    storageSession.__reset();
    browserMock.downloads.download.mockClear();
    browserMock.runtime.sendMessage.mockReset();
    browserMock.runtime.sendMessage.mockResolvedValue({ success: true });
    browserMock.runtime.getURL.mockClear();
    browserMock.runtime.getURL.mockImplementation((path) => `moz-extension://test/${path}`);
    browserMock.runtime.openOptionsPage.mockClear();
    browserMock.runtime.onMessage.addListener.mockClear();
    browserMock.runtime.onMessage.removeListener.mockClear();
    browserMock.tabs.create.mockClear();
    browserMock.tabs.getCurrent.mockClear();
    browserMock.tabs.getCurrent.mockResolvedValue({ id: 1, active: true, windowId: 1 });
    browserMock.tabs.query.mockClear();
    browserMock.tabs.remove.mockClear();
    browserMock.tabs.saveAsPDF.mockClear();
    browserMock.tabs.saveAsPDF.mockResolvedValue('saved');
    browserMock.tabs.sendMessage.mockClear();
    browserMock.tabs.update.mockClear();
    browserMock.tabs.onUpdated.addListener.mockClear();
    browserMock.tabs.onUpdated.removeListener.mockClear();
    browserMock.scripting.executeScript.mockClear();
    browserMock.scripting.executeScript.mockResolvedValue([{ result: null }]);
    browserMock.windows.update.mockClear();
    browserMock.i18n.getUILanguage.mockClear();
    browserMock.i18n.getUILanguage.mockReturnValue('en-US');
    chromeMock.tabs.create.mockClear();
    chromeMock.runtime.sendMessage.mockReset();
    chromeMock.runtime.sendMessage.mockResolvedValue({ success: true });
    navigator.clipboard.writeText.mockClear();
    document.execCommand.mockClear();
    globalThis.close.mockClear();
    globalThis.__ENABLE_USER_INPUT_IMAGE_EXPORT__ = true;
    i18nMock.language = 'en-US';
    i18nMock.changeLanguage.mockClear();
  },
};

beforeEach(() => {
  globalThis.__EXTENSION_TEST_UTILS__.resetAll();
  document.body.innerHTML = '';
});

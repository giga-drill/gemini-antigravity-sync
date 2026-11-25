jest.mock('idb', () => ({
  openDB: jest.fn(),
}));

function createFakeDb() {
  return {
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    getAll: jest.fn(),
    transaction: jest.fn(),
  };
}

function createStoredSession(overrides = {}) {
  return {
    id: 'session-1',
    title: 'Alpha chat',
    author: 'Ada Lovelace',
    url: 'https://gemini.google.com/share/1',
    createDate: 1700000000000,
    exportDate: 1700000001000,
    modelVersion: 'gemini-2.5-pro',
    messages: [
      { role: 'user', content: 'Hello world', images: [] },
      { role: 'model', content: 'Response', images: [] },
    ],
    ...overrides,
  };
}

describe('storage/db settings helpers', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('getSettings returns default settings when no persisted settings exist', async () => {
    const { openDB } = require('idb');
    const fakeDb = createFakeDb();
    fakeDb.get.mockResolvedValue(undefined);
    openDB.mockResolvedValue(fakeDb);

    const db = require('@/storage/db');
    const { DEFAULT_SETTINGS } = require('@/types/models');

    const settings = await db.getSettings();

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(fakeDb.get).toHaveBeenCalledWith('settings', 'user_settings');
  });

  test('getSettings merges persisted values and coerces unsupported output modes to download', async () => {
    const { openDB } = require('idb');
    const fakeDb = createFakeDb();
    fakeDb.get.mockResolvedValue({
      language: 'en-US',
      defaultExportFormat: 'txt',
      defaultOutputMode: 'legacy-mode',
      userLabelMode: 'account-name',
      includeImages: true,
    });
    openDB.mockResolvedValue(fakeDb);

    const db = require('@/storage/db');

    const settings = await db.getSettings();

    expect(settings).toEqual({
      language: 'en-US',
      defaultExportFormat: 'txt',
      defaultOutputMode: 'download',
      userLabelMode: 'account-name',
      includeImages: true,
    });
  });

  test('getSettings preserves clipboard output mode when it is explicitly persisted', async () => {
    const { openDB } = require('idb');
    const fakeDb = createFakeDb();
    fakeDb.get.mockResolvedValue({
      language: 'zh-CN',
      defaultExportFormat: 'markdown',
      defaultOutputMode: 'clipboard',
      userLabelMode: 'you',
      includeImages: false,
    });
    openDB.mockResolvedValue(fakeDb);

    const db = require('@/storage/db');

    const settings = await db.getSettings();

    expect(settings.defaultOutputMode).toBe('clipboard');
  });

  test('saveSettings writes the payload to the settings store under the fixed settings key', async () => {
    const { openDB } = require('idb');
    const fakeDb = createFakeDb();
    openDB.mockResolvedValue(fakeDb);

    const db = require('@/storage/db');
    const settings = {
      language: 'en-US',
      defaultExportFormat: 'html',
      defaultOutputMode: 'download',
      userLabelMode: 'account-name',
      includeImages: false,
    };

    await db.saveSettings(settings);

    expect(fakeDb.put).toHaveBeenCalledWith('settings', settings, 'user_settings');
  });

  test('getAllSessionSummaries maps full sessions into lightweight summary objects with message counts', async () => {
    const { openDB } = require('idb');
    const fakeDb = createFakeDb();
    fakeDb.getAll.mockResolvedValue([
      createStoredSession(),
      createStoredSession({
        id: 'session-2',
        title: 'Beta chat',
        messages: [{ role: 'user', content: 'One message only', images: [] }],
      }),
    ]);
    openDB.mockResolvedValue(fakeDb);

    const db = require('@/storage/db');

    const summaries = await db.getAllSessionSummaries();

    expect(summaries).toEqual([
      {
        id: 'session-1',
        title: 'Alpha chat',
        author: 'Ada Lovelace',
        url: 'https://gemini.google.com/share/1',
        messageCount: 2,
        createDate: 1700000000000,
        exportDate: 1700000001000,
        modelVersion: 'gemini-2.5-pro',
      },
      {
        id: 'session-2',
        title: 'Beta chat',
        author: 'Ada Lovelace',
        url: 'https://gemini.google.com/share/1',
        messageCount: 1,
        createDate: 1700000000000,
        exportDate: 1700000001000,
        modelVersion: 'gemini-2.5-pro',
      },
    ]);
  });

  test('searchSessions supports regex matches against titles and message content', async () => {
    const { openDB } = require('idb');
    const fakeDb = createFakeDb();
    fakeDb.getAll.mockResolvedValue([
      createStoredSession(),
      createStoredSession({
        id: 'session-2',
        title: 'Gamma chat',
        messages: [{ role: 'user', content: 'Contains special keyword zebra', images: [] }],
      }),
    ]);
    openDB.mockResolvedValue(fakeDb);

    const db = require('@/storage/db');

    const titleResults = await db.searchSessions('Alpha|Delta');
    const contentResults = await db.searchSessions('zebra');

    expect(titleResults.map((item) => item.id)).toEqual(['session-1']);
    expect(contentResults.map((item) => item.id)).toEqual(['session-2']);
  });

  test('searchSessions falls back to plain text search when the regex is invalid', async () => {
    const { openDB } = require('idb');
    const fakeDb = createFakeDb();
    fakeDb.getAll.mockResolvedValue([
      createStoredSession({ title: 'release [notes]' }),
      createStoredSession({ id: 'session-2', title: 'plain title' }),
    ]);
    openDB.mockResolvedValue(fakeDb);

    const db = require('@/storage/db');

    const results = await db.searchSessions('[');

    expect(results.map((item) => item.id)).toEqual(['session-1']);
  });
});
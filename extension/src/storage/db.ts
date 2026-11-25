// src/storage/db.ts — IndexedDB 数据库管理
// 使用 idb 库提供类型安全的 IndexedDB 操作

import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, STORE_SESSIONS, STORE_SETTINGS } from '@/shared/constants';
import type { ChatSession, ChatSessionSummary, UserSettings } from '@/types/models';
import { DEFAULT_SETTINGS, normalizeUserSettings } from '@/types/models';

interface ChatExporterDB {
  [STORE_SESSIONS]: {
    key: string;
    value: ChatSession;
    indexes: {
      'by-title': string;
      'by-date': number;
    };
  };
  [STORE_SETTINGS]: {
    key: string;
    value: UserSettings;
  };
}

let dbInstance: IDBPDatabase<ChatExporterDB> | null = null;

async function getDB(): Promise<IDBPDatabase<ChatExporterDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<ChatExporterDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // 会话存储
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const sessionStore = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        sessionStore.createIndex('by-title', 'title');
        sessionStore.createIndex('by-date', 'exportDate');
      }
      // 设置存储
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
    },
  });

  return dbInstance;
}

// === 会话 CRUD ===

/** Upsert: 插入或更新会话 */

/** 批量插入或更新仅仅来自网页端抓取的 Summary 摘要，保留已有内容（如果有） */
export async function upsertWebSummaries(summaries: ChatSessionSummary[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_SESSIONS, 'readwrite');
  const store = tx.objectStore(STORE_SESSIONS);
  
  for (const sum of summaries) {
    const existing = await store.get(sum.id);
    if (!existing) {
      await store.put({ ...sum, messages: [] } as ChatSession);
    } else {
      await store.put({ ...existing, ...sum } as ChatSession);
    }
  }
  await tx.done;
}

export async function upsertSession(session: ChatSession): Promise<void> {
  const db = await getDB();
  await db.put(STORE_SESSIONS, session);
}

/** 获取单个会话 */
export async function getSession(id: string): Promise<ChatSession | undefined> {
  const db = await getDB();
  return db.get(STORE_SESSIONS, id);
}

/** 删除会话 */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_SESSIONS, id);
}

/** 获取所有会话摘要 (不含完整 messages 体, 降低内存开销) */
export async function getAllSessionSummaries(): Promise<ChatSessionSummary[]> {
  const db = await getDB();
  const sessions = await db.getAll(STORE_SESSIONS);

  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    author: s.author,
    url: s.url,
    messageCount: s.messages.length,
    createDate: s.createDate,
    exportDate: s.exportDate,
    modelVersion: s.modelVersion,
  }));
}

/**
 * 全文搜索: 按标题和消息内容匹配关键字
 * 支持正则表达式和纯文本搜索
 */
export async function searchSessions(query: string): Promise<ChatSessionSummary[]> {
  if (!query.trim()) return getAllSessionSummaries();

  const db = await getDB();
  const allSessions = await db.getAll(STORE_SESSIONS);

  let matcher: (text: string) => boolean;
  try {
    const regex = new RegExp(query, 'i');
    matcher = (text: string) => regex.test(text);
  } catch {
    // 非法正则, 按纯文本搜索
    const lower = query.toLowerCase();
    matcher = (text: string) => text.toLowerCase().includes(lower);
  }

  return allSessions
    .filter((session) => {
      // 标题匹配
      if (matcher(session.title)) return true;
      // 消息内容匹配
      return session.messages.some((msg: { content: string }) => matcher(msg.content));
    })
    .map((s) => ({
      id: s.id,
      title: s.title,
      author: s.author,
      url: s.url,
      messageCount: s.messages.length,
      createDate: s.createDate,
      exportDate: s.exportDate,
      modelVersion: s.modelVersion,
    }));
}

// === 设置 CRUD ===

const SETTINGS_KEY = 'user_settings';

export async function getStoredSettings(): Promise<UserSettings | undefined> {
  const db = await getDB();
  return db.get(STORE_SETTINGS, SETTINGS_KEY);
}

/** 获取用户设置 */
export async function getSettings(): Promise<UserSettings> {
  const settings = await getStoredSettings();
  if (!settings) {
    return { ...DEFAULT_SETTINGS };
  }

  return normalizeUserSettings(settings);
}

/** 保存用户设置 */
export async function saveSettings(settings: UserSettings): Promise<void> {
  const db = await getDB();
  await db.put(STORE_SETTINGS, normalizeUserSettings(settings), SETTINGS_KEY);
}

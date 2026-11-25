// src/storage/index.ts — 存储工厂

import type { IStorage } from './types';
import { LocalStorage } from './local-storage';

export type { IStorage };

/** 创建本地下载存储实现 */
export function createStorage(): IStorage {
  return new LocalStorage();
}

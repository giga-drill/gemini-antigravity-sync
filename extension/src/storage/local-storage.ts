// src/storage/local-storage.ts — 本地文件下载

import type { IStorage } from './types';
import { triggerDownload } from '@/shared/browser-api';

export class LocalStorage implements IStorage {
  async save(fileBlob: Blob, filename: string): Promise<boolean> {
    try {
      await triggerDownload(fileBlob, filename);
      return true;
    } catch (e) {
      console.error('[LocalStorage] Download failed:', e);
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Local download failed: ${message}`);
    }
  }
}

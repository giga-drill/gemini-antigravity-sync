// src/storage/types.ts — 存储接口定义 (策略模式)

/** 文件存储统一接口 */
export interface IStorage {
  /** 将 Blob 保存到目标存储, 返回是否成功 */
  save(fileBlob: Blob, filename: string): Promise<boolean>;
}

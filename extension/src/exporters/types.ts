// src/exporters/types.ts — 导出器接口定义 (策略模式)

import type { ChatSession, UserSettings } from '@/types/models';

/** 导出器统一接口 */
export interface IExporter {
  /** 将对话会话导出为指定格式的 Blob */
  export(session: ChatSession, settings: UserSettings): Promise<Blob>;
}

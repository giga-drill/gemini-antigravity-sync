// src/types/models.ts — 核心数据字典

/** 单条对话消息 */
export interface ChatMessage {
  role: 'user' | 'model';
  content: string;           // Markdown 或纯文本
  contentHtml?: string;      // 原始 DOM innerHTML (用于 HTML/PDF 导出)
  images: string[];          // 可导出的图片源 (优先 data URL, 其次可访问 URL)
  timestamp?: number;        // 消息时间戳 (毫秒)
}

/** 完整对话会话 */
export interface ChatSession {
  id: string;                // 对话唯一标识 (来自 URL 或 DOM)
  title: string;
  author: string;            // 登录用户名
  url: string;               // 对话页面 URL
  createDate?: number;       // 对话创建时间
  exportDate: number;        // 导出时间戳
  modelVersion?: string;     // Gemini 模型版本
  messages: ChatMessage[];
  pdfBase64?: string;          // 内容脚本预渲染的 PDF (base64)
}

/** 对话摘要 (用于列表展示, 不含完整消息体) */
export interface ChatSessionSummary {
  id: string;
  title: string;
  author: string;
  url: string;
  messageCount: number;
  createDate?: number;
  exportDate: number;
  modelVersion?: string;
}

/** 用户设置 */
export interface UserSettings {
  language: 'zh-CN' | 'en-US';
  defaultExportFormat: 'markdown' | 'pdf' | 'html' | 'txt';
  defaultOutputMode: 'download' | 'clipboard';
  userLabelMode: 'you' | 'account-name';
  includeImages: boolean;      // 是否导出图片
}

export const USER_INPUT_IMAGE_EXPORT_ENABLED = typeof __ENABLE_USER_INPUT_IMAGE_EXPORT__ !== 'undefined'
  ? __ENABLE_USER_INPUT_IMAGE_EXPORT__
  : true;

/** 默认设置 */
export const DEFAULT_SETTINGS: UserSettings = {
  language: 'zh-CN',
  defaultExportFormat: 'markdown',
  defaultOutputMode: 'download',
  userLabelMode: 'you',
  includeImages: false,
};

type UserSettingsLike = Partial<UserSettings> & {
  imageQuality?: number;
  maxImageWidth?: number;
};

export function normalizeUserSettings(settings?: UserSettingsLike | null): UserSettings {
  return {
    language: settings?.language === 'en-US' ? 'en-US' : 'zh-CN',
    defaultExportFormat: settings?.defaultExportFormat === 'pdf'
      ? 'pdf'
      : settings?.defaultExportFormat === 'html'
        ? 'html'
        : settings?.defaultExportFormat === 'txt'
          ? 'txt'
          : 'markdown',
    defaultOutputMode: settings?.defaultOutputMode === 'clipboard' ? 'clipboard' : 'download',
    userLabelMode: settings?.userLabelMode === 'account-name' ? 'account-name' : 'you',
    includeImages: USER_INPUT_IMAGE_EXPORT_ENABLED && settings?.includeImages === true,
  };
}

export function shouldExportUserInputImages(settings?: Pick<UserSettings, 'includeImages'> | null): boolean {
  return USER_INPUT_IMAGE_EXPORT_ENABLED && settings?.includeImages === true;
}

export function sanitizeMessagesForImageExport(
  messages: ChatMessage[],
  includeImages: boolean,
): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    images: includeImages && message.role === 'user' ? [...(message.images || [])] : [],
  }));
}

/** 导出任务状态 */
export type ExportTaskStatus = 'pending' | 'extracting' | 'exporting' | 'done' | 'error';

/** 导出任务 */
export interface ExportTask {
  id: string;
  sessionId: string;
  sessionTitle: string;
  format: 'markdown' | 'pdf' | 'html' | 'txt';
  status: ExportTaskStatus;
  progress: number;          // 0 - 100
  error?: string;
}

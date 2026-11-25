// src/shared/constants.ts

/** Gemini 网站域名匹配 */
export const GEMINI_ORIGIN = 'https://gemini.google.com';
export const GEMINI_MATCH_PATTERN = 'https://gemini.google.com/*';

/** IndexedDB 配置 */
export const DB_NAME = 'gemini-chat-exporter';
export const DB_VERSION = 1;
export const STORE_SESSIONS = 'sessions';
export const STORE_SETTINGS = 'settings';

/** 图片默认限制 */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per image
export const MAX_TOTAL_IMAGES_BYTES = 50 * 1024 * 1024; // 50MB total

/** 导出文件名模板 */
export function buildFilename(title: string, format: 'markdown' | 'pdf' | 'html' | 'txt', _exportTime?: number): string {
  const safeTitle = (title || 'Gemini_Chat').trim();
  const sanitized = safeTitle.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, ' ').substring(0, 100);
  const extMap: Record<string, string> = { markdown: 'md', pdf: 'pdf', html: 'html', txt: 'txt' };
  const ext = extMap[format] || 'txt';
  return `${sanitized}.${ext}`;
}

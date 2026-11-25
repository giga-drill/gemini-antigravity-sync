// src/types/messages.ts — 扩展消息通信协议

import type { ChatSession, ExportTask, UserSettings, ChatSessionSummary } from './models';

/** 所有消息动作类型 */
export type MessageAction =
  | 'PING'
  | 'FETCH_IMAGE_AS_DATA_URL'
  | 'EXTRACT_GEMINI_CHAT_HTML'
  | 'exportPdf'
  | 'EXTRACT_CURRENT_CHAT'
  | 'SELECT_MESSAGES_FOR_EXPORT'
  | 'EXTRACT_CHAT_LIST'
  | 'SYNC_WEB_SESSIONS'
  | 'SELECT_CHATS_FOR_EXPORT'
  | 'RENDER_HTML_TO_PDF'
  | 'EXPORT_SESSION'
  | 'EXPORT_ALL'
  | 'BATCH_EXPORT'
  | 'GET_CACHED_SESSIONS'
  | 'SEARCH_SESSIONS'
  | 'DELETE_CACHED_SESSION'
  | 'BATCH_DELETE_SESSIONS'
  | 'DELETE_CHAT_FROM_WEB'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'GET_EXPORT_TASKS'
  | 'TASK_PROGRESS'
  | 'EXPORT_ALL_PROGRESS';

/** 请求消息基类 */
interface BaseMessage {
  action: MessageAction;
}

/** Content Script: 提取当前页面对话 */
export interface ExtractCurrentChatRequest extends BaseMessage {
  action: 'EXTRACT_CURRENT_CHAT';
}

/** Content Script: 提取 Gemini 聊天 HTML 并触发预览页 */
export interface ExtractGeminiChatHtmlRequest extends BaseMessage {
  action: 'EXTRACT_GEMINI_CHAT_HTML';
  theme?: string;
  settings?: UserSettings;
  mode?: 'export-pdf' | 'cache-only';
}

/** Content Script -> Background: 请求静默导出 PDF */
export interface ExportPdfRequest extends BaseMessage {
  action: 'exportPdf';
  theme?: string;
  html?: string;
  title?: string;
  filename?: string;
  exportId?: string;
}

export interface FetchImageAsDataUrlRequest extends BaseMessage {
  action: 'FETCH_IMAGE_AS_DATA_URL';
  src: string;
  pageUrl?: string;
}

export interface FetchImageAsDataUrlResponse {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

export interface ExtractCurrentChatResponse {
  success: boolean;
  data?: ChatSession;
  cancelled?: boolean;
  error?: string;
}

export interface ExtractGeminiChatHtmlResponse {
  success: boolean;
  html?: string;
  title?: string;
  filename?: string;
  theme?: string;
  error?: string;
}

/** Content Script: 提取聊天列表 */
export interface ExtractChatListRequest extends BaseMessage {
  action: 'EXTRACT_CHAT_LIST';
}

export interface ExtractChatListResponse {
  success: boolean;
  data?: ChatSessionSummary[];
  error?: string;
}

/** Content Script: 弹出聊天选择器, 返回用户选中的会话 */
export interface SelectChatsForExportRequest extends BaseMessage {
  action: 'SELECT_CHATS_FOR_EXPORT';
}

export interface SelectChatsForExportResponse {
  success: boolean;
  data?: ChatSessionSummary[];
  cancelled?: boolean;
  error?: string;
}

/** Background: 执行导出任务 */
export interface ExportSessionRequest extends BaseMessage {
  action: 'EXPORT_SESSION';
  session: ChatSession;
  format: 'markdown' | 'pdf' | 'html' | 'txt';
  settings: UserSettings;
}

export interface ExportSessionResponse {
  success: boolean;
  taskId?: string;
  error?: string;
}

/** Background: 导出所有对话 */
export interface ExportAllRequest extends BaseMessage {
  action: 'EXPORT_ALL';
  format: 'markdown' | 'pdf' | 'html' | 'txt';
  settings: UserSettings;
  theme?: string;
}

export interface ExportAllResponse {
  success: boolean;
  total?: number;
  exported?: number;
  cancelled?: boolean;
  error?: string;
}

/** Background: 批量导出 */
export interface BatchExportRequest extends BaseMessage {
  action: 'BATCH_EXPORT';
  sessionIds: string[];
  format: 'markdown' | 'pdf' | 'html' | 'txt';
  settings: UserSettings;
  theme?: string;
}

export interface SyncWebSessionsRequest extends BaseMessage {
  action: 'SYNC_WEB_SESSIONS';
}

export interface SyncWebSessionsResponse {
  success: boolean;
  data?: ChatSessionSummary[];
  error?: string;
}

/** Background: 查询缓存的会话列表 */
export interface GetCachedSessionsRequest extends BaseMessage {
  action: 'GET_CACHED_SESSIONS';
}

export interface GetCachedSessionsResponse {
  success: boolean;
  data?: ChatSessionSummary[];
  error?: string;
}

/** Background: 搜索会话 */
export interface SearchSessionsRequest extends BaseMessage {
  action: 'SEARCH_SESSIONS';
  query: string;
}

export interface SearchSessionsResponse {
  success: boolean;
  data?: ChatSessionSummary[];
  error?: string;
}

/** Background: 删除缓存的会话 */
export interface DeleteCachedSessionRequest extends BaseMessage {
  action: 'DELETE_CACHED_SESSION';
  sessionId: string;
}

/** Background: 批量删除缓存的会话和 web 上的聊天 */
export interface BatchDeleteSessionsRequest extends BaseMessage {
  action: 'BATCH_DELETE_SESSIONS';
  sessionIds: string[];
  deleteFromWeb?: boolean; // 是否同时删除 web 上的聊天
}

export interface BatchDeleteSessionsResponse {
  success: boolean;
  deleted?: string[];
  failed?: string[];
  error?: string;
}

/** Content Script: 删除 web 上的聊天 */
export interface DeleteChatFromWebRequest extends BaseMessage {
  action: 'DELETE_CHAT_FROM_WEB';
  chatId: string;
}

export interface DeleteChatFromWebResponse {
  success: boolean;
  error?: string;
}

/** Background: 获取/保存设置 */
export interface GetSettingsRequest extends BaseMessage {
  action: 'GET_SETTINGS';
}

export interface SaveSettingsRequest extends BaseMessage {
  action: 'SAVE_SETTINGS';
  settings: UserSettings;
}

/** Background: 获取导出任务状态 */
export interface GetExportTasksRequest extends BaseMessage {
  action: 'GET_EXPORT_TASKS';
}

export interface GetExportTasksResponse {
  success: boolean;
  data?: ExportTask[];
}

/** Background → UI: 任务进度通知 */
export interface TaskProgressMessage extends BaseMessage {
  action: 'TASK_PROGRESS';
  task: ExportTask;
}

export type ExportAllProgressPhase =
  | 'preparing'
  | 'loading-chat'
  | 'extracting-chat'
  | 'exporting-chat'
  | 'completed-chat'
  | 'failed-chat'
  | 'skipped-chat'
  | 'done';

/** Background → UI: 全量导出进度通知 */
export interface ExportAllProgressMessage extends BaseMessage {
  action: 'EXPORT_ALL_PROGRESS';
  total: number;
  exported: number;
  processed: number;
  currentIndex: number;
  currentTitle?: string;
  currentProgress: number;
  phase: ExportAllProgressPhase;
  status: 'in-progress' | 'done';
}

/** 所有请求消息的联合类型 */
export type AppMessage =
  | ExtractGeminiChatHtmlRequest
  | ExportPdfRequest
  | ExtractCurrentChatRequest
  | SelectMessagesForExportRequest
  | ExtractChatListRequest
  | SyncWebSessionsRequest
  | SelectChatsForExportRequest
  | ExportSessionRequest
  | ExportAllRequest
  | BatchExportRequest
  | GetCachedSessionsRequest
  | SearchSessionsRequest
  | DeleteCachedSessionRequest
  | BatchDeleteSessionsRequest
  | DeleteChatFromWebRequest
  | GetSettingsRequest
  | SaveSettingsRequest
  | GetExportTasksRequest
  | TaskProgressMessage
  | ExportAllProgressMessage;

/** Content Script: 启动页面内消息选择模式并返回选中的对话 */
export interface SelectMessagesForExportRequest extends BaseMessage {
  action: 'SELECT_MESSAGES_FOR_EXPORT';
  format?: "markdown" | "pdf" | "html" | "txt";
  outputMode?: 'download' | 'clipboard';
  settings?: import("./models").UserSettings;
  theme?: string;
}

export interface SelectMessagesForExportResponse {
  success: boolean;
  data?: import('./models').ChatSession;
  cancelled?: boolean;
  error?: string;
}

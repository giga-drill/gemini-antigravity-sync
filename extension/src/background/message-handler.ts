// src/background/message-handler.ts — 消息路由与处理

import { browser } from '@/shared/browser-api';
import { resolvePreferredLanguage } from '@/shared/language';
import type { ExportSessionRequest, ExportAllRequest, BatchExportRequest, SearchSessionsRequest, DeleteCachedSessionRequest, SaveSettingsRequest, ExtractCurrentChatResponse, ExtractGeminiChatHtmlResponse, SelectChatsForExportResponse, BatchDeleteSessionsRequest, ExportAllProgressMessage, FetchImageAsDataUrlRequest, FetchImageAsDataUrlResponse } from '@/types/messages';
import type { ChatSession, ChatSessionSummary, ExportTask, UserSettings } from '@/types/models';
import {
  upsertSession,
  upsertWebSummaries,
  getSession,
  deleteSession,
  getAllSessionSummaries,
  searchSessions,
  getSettings,
  getStoredSettings,
  saveSettings,
} from '@/storage/db';
import { executeExportTask, getActiveTasks, startExportTask } from './task-manager';
import { HtmlExporter } from '@/exporters/html-exporter';
import { buildFilename } from '@/shared/constants';
import { buildStandardChatHtml } from '@/shared/standard-chat-html';
import { sanitizeMessagesForImageExport, shouldExportUserInputImages } from '@/types/models';

const GEMINI_HOST = 'gemini.google.com';
const GHOST_PREVIEW_OPEN_STORAGE_KEY = 'gce_keep_ghost_preview_open';
const GHOST_DEBUG_LOGGING_STORAGE_KEY = 'gce_ghost_debug_logging';
const BACKGROUND_IMAGE_LOG_PREFIX = '[GCE][background][images]';

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'function') {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }
        reject(new Error('Failed to read blob as data URL'));
      };
      reader.onerror = () => reject(reader.error || new Error('Failed to read blob as data URL'));
      reader.readAsDataURL(blob);
    });
  }

  const mime = blob.type || 'application/octet-stream';

  if (typeof blob.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  }

  throw new Error('No supported blob-to-data-url conversion API is available');
}

function isAllowedRemoteImageUrl(src: string): boolean {
  try {
    const parsed = new URL(src);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    return parsed.hostname === GEMINI_HOST || /(^|\.)googleusercontent\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function sanitizePageUrl(pageUrl: string | undefined): string | undefined {
  if (!pageUrl) return undefined;

  try {
    const parsed = new URL(pageUrl);
    return parsed.hostname === GEMINI_HOST ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function buildBackgroundFetchStrategies(pageUrl?: string): Array<{ label: string; init: RequestInit }> {
  const safePageUrl = sanitizePageUrl(pageUrl);
  const geminiOrigin = `https://${GEMINI_HOST}/`;

  const strategies: Array<{ label: string; init: RequestInit }> = [
    {
      label: 'include-credentials-page-referrer',
      init: {
        credentials: 'include',
        cache: 'force-cache',
        referrer: safePageUrl,
        referrerPolicy: 'strict-origin-when-cross-origin',
      },
    },
    {
      label: 'include-credentials-origin-referrer',
      init: {
        credentials: 'include',
        cache: 'force-cache',
        referrer: geminiOrigin,
        referrerPolicy: 'origin',
      },
    },
    {
      label: 'omit-credentials-page-referrer',
      init: {
        credentials: 'omit',
        cache: 'force-cache',
        referrer: safePageUrl,
        referrerPolicy: 'strict-origin-when-cross-origin',
      },
    },
    {
      label: 'omit-credentials-origin-referrer',
      init: {
        credentials: 'omit',
        cache: 'force-cache',
        referrer: geminiOrigin,
        referrerPolicy: 'origin',
      },
    },
    {
      label: 'omit-credentials-no-referrer',
      init: {
        credentials: 'omit',
        cache: 'force-cache',
        referrerPolicy: 'no-referrer',
      },
    },
    {
      label: 'default-fetch',
      init: {
        cache: 'force-cache',
      },
    },
  ];

  return strategies.filter((strategy) => !(strategy.init.referrer === undefined && strategy.label.includes('page-referrer')));
}

async function extractImageDataUrlFromNavigatedTab(src: string): Promise<string | null> {
  const scriptingApi = (browser as typeof browser & {
    scripting?: {
      executeScript: (details: {
        target: { tabId: number };
        args?: unknown[];
        func: (...args: unknown[]) => unknown;
      }) => Promise<Array<{ result?: unknown }>>;
    };
  }).scripting;

  if (!scriptingApi?.executeScript) {
    console.warn(`${BACKGROUND_IMAGE_LOG_PREFIX} navigation fallback unavailable because browser.scripting.executeScript is not supported`);
    return null;
  }

  let tempTabId: number | undefined;

  try {
    const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    const createdTab = await browser.tabs.create({
      url: src,
      active: false,
      ...(activeTab?.windowId ? { windowId: activeTab.windowId } : {}),
    });

    if (!createdTab?.id) {
      console.warn(`${BACKGROUND_IMAGE_LOG_PREFIX} navigation fallback could not create a temporary tab`);
      return null;
    }

    tempTabId = createdTab.id;

    if (createdTab.status !== 'complete') {
      await waitForTabLoad(createdTab.id, 20_000);
    }

    const results = await scriptingApi.executeScript({
      target: { tabId: createdTab.id },
      args: [src],
      func: async (imageSrc: string) => {
        const waitForImage = async (image: HTMLImageElement) => {
          if (image.complete && image.naturalWidth > 0) {
            return image;
          }

          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              image.removeEventListener('load', handleLoad);
              image.removeEventListener('error', handleError);
            };

            const handleLoad = () => {
              cleanup();
              resolve();
            };

            const handleError = () => {
              cleanup();
              reject(new Error('Image failed to load in temporary navigation tab'));
            };

            image.addEventListener('load', handleLoad, { once: true });
            image.addEventListener('error', handleError, { once: true });
          });

          return image;
        };

        try {
          const existingImage = document.querySelector('img');
          const image = existingImage instanceof HTMLImageElement ? existingImage : new Image();

          if (!(existingImage instanceof HTMLImageElement)) {
            image.src = imageSrc;
          }

          await waitForImage(image);

          if (!image.naturalWidth || !image.naturalHeight) {
            return null;
          }

          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            return null;
          }

          ctx.drawImage(image, 0, 0);
          return canvas.toDataURL('image/png');
        } catch (error) {
          console.warn('[GCE][background][images] navigation tab extraction failed:', error);
          return null;
        }
      },
    });

    const dataUrl = typeof results?.[0]?.result === 'string' ? results[0].result : null;
    if (dataUrl?.startsWith('data:image/')) {
      console.info(`${BACKGROUND_IMAGE_LOG_PREFIX} navigation fallback extracted image via temporary tab`);
      return dataUrl;
    }

    console.warn(`${BACKGROUND_IMAGE_LOG_PREFIX} navigation fallback did not produce a valid image payload`);
    return null;
  } catch (error) {
    console.warn(`${BACKGROUND_IMAGE_LOG_PREFIX} navigation fallback failed`, {
      src,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    if (tempTabId) {
      await browser.tabs.remove(tempTabId).catch(() => undefined);
    }
  }
}

async function fetchImageAsDataUrlFromBackground(src: string, pageUrl?: string): Promise<FetchImageAsDataUrlResponse> {
  if (!isAllowedRemoteImageUrl(src)) {
    return { success: false, error: 'URL is not allowed for background image fetch' };
  }

  const strategies = buildBackgroundFetchStrategies(pageUrl);

  for (const strategy of strategies) {
    try {
      console.info(`${BACKGROUND_IMAGE_LOG_PREFIX} fetch attempt`, {
        src,
        strategy: strategy.label,
        init: strategy.init,
      });

      const response = await fetch(src, strategy.init);

      if (!response.ok) {
        console.warn(`${BACKGROUND_IMAGE_LOG_PREFIX} non-ok response`, {
          src,
          strategy: strategy.label,
          status: response.status,
          statusText: response.statusText,
        });
        continue;
      }

      const blob = await response.blob();
      console.info(`${BACKGROUND_IMAGE_LOG_PREFIX} fetch succeeded`, {
        src,
        strategy: strategy.label,
        status: response.status,
        mimeType: blob.type,
      });
      return { success: true, dataUrl: await blobToDataUrl(blob) };
    } catch (error) {
      console.warn(`${BACKGROUND_IMAGE_LOG_PREFIX} fetch failed`, {
        src,
        strategy: strategy.label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const navigatedDataUrl = await extractImageDataUrlFromNavigatedTab(src);
  if (navigatedDataUrl) {
    return { success: true, dataUrl: navigatedDataUrl };
  }

  return {
    success: false,
    error: 'All background image fetch strategies failed',
  };
}

function normalizeExportTheme(theme: unknown): string {
  if (theme === 'theme-academic') return 'theme-academic';
  if (theme === 'theme-script') return 'theme-script';
  return 'theme-notion';
}

function createGhostExportId(): string {
  return `ghost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildGhostExportStorageKey(exportId: string): string {
  return `gemini_ghost_export_payload_${exportId}`;
}

function resolveUserLabel(settings: { userLabelMode?: 'you' | 'account-name' } | undefined, authorName?: string): string {
  if (settings?.userLabelMode === 'account-name') {
    const trimmed = (authorName || '').trim();
    if (trimmed && trimmed !== 'Unknown User') return trimmed;
  }
  return 'You';
}

async function resolveRequestedTheme(theme: unknown): Promise<string> {
  if (typeof theme === 'string' && theme.trim()) {
    return normalizeExportTheme(theme.trim());
  }

  const stored = await browser.storage.local.get(['gemini_export_theme']);
  return normalizeExportTheme(stored.gemini_export_theme);
}

async function shouldKeepGhostPreviewOpen(): Promise<boolean> {
  const stored = await browser.storage.local.get([GHOST_PREVIEW_OPEN_STORAGE_KEY]);
  return stored[GHOST_PREVIEW_OPEN_STORAGE_KEY] === true;
}

async function shouldEnableGhostDebugLogging(): Promise<boolean> {
  const stored = await browser.storage.local.get([GHOST_DEBUG_LOGGING_STORAGE_KEY]);
  return stored[GHOST_DEBUG_LOGGING_STORAGE_KEY] === true;
}

async function openGhostExportTab(payload: {
  html?: string;
  title?: string;
  filename?: string;
  theme?: unknown;
  language?: UserSettings['language'];
}): Promise<void> {
  const theme = await resolveRequestedTheme(payload.theme);
  const [keepPreviewOpen, debugLogging, language] = await Promise.all([
    shouldKeepGhostPreviewOpen(),
    shouldEnableGhostDebugLogging(),
    payload.language
      ? Promise.resolve(payload.language)
      : resolvePreferredLanguage({ migrateLegacyLanguage: false }),
  ]);
  const exportId = createGhostExportId();
  const storageKey = buildGhostExportStorageKey(exportId);
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const previousActiveTab = tabs[0];
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : 'Gemini Chat Export';
  const filename = typeof payload.filename === 'string' && payload.filename.trim()
    ? payload.filename.trim()
    : 'Gemini Chat Export.pdf';

  await browser.storage.local.set({
    [storageKey]: {
      html: payload.html,
      title,
      filename,
      theme,
      language,
      createdAt: Date.now(),
      previousActiveTabId: previousActiveTab?.id,
      previousWindowId: previousActiveTab?.windowId,
    },
    gemini_export_theme: theme,
  });

  const ghostUrl = new URL(browser.runtime.getURL('ghost.html'));
  ghostUrl.searchParams.set('theme', theme);
  ghostUrl.searchParams.set('exportId', exportId);
  ghostUrl.searchParams.set('lang', language);
  if (debugLogging || keepPreviewOpen) {
    ghostUrl.searchParams.set('debug', '1');
  }
  if (keepPreviewOpen) {
    ghostUrl.searchParams.set('keepOpen', '1');
  }

  console.log('[GCE][background] opening ghost export tab', {
    exportId,
    theme,
    keepPreviewOpen,
    title,
    filename,
    ghostUrl: ghostUrl.toString(),
  });

  const createdTab = await browser.tabs.create({
    url: ghostUrl.toString(),
    active: keepPreviewOpen,
  });

  console.log('[GCE][background] ghost tab created', {
    exportId,
    tabId: createdTab.id,
    keepPreviewOpen,
    url: createdTab.url,
    active: createdTab.active,
    windowId: createdTab.windowId,
  });
}

async function openGhostExportForSession(
  session: ChatSession,
  settings: UserSettings,
  theme?: unknown,
): Promise<void> {
  const userLabel = resolveUserLabel(settings, session.author);
  const includeImages = shouldExportUserInputImages(settings);
  const html = buildStandardChatHtml(sanitizeMessagesForImageExport(session.messages, includeImages), {
    title: session.title,
    userLabel,
    includeImages,
  });

  await openGhostExportTab({
    html,
    title: session.title,
    filename: buildFilename(session.title, 'pdf', session.exportDate),
    theme,
    language: settings.language,
  });
}

/** 消息分发路由 */
export async function handleMessage(
  message: Record<string, unknown>,
  _sender: browser.Runtime.MessageSender
): Promise<unknown> {
  const action = message.action as string;
  switch (action) {
    case 'PING': {
      return { success: true };
    }

    case 'FETCH_IMAGE_AS_DATA_URL': {
      const { src, pageUrl } = message as unknown as FetchImageAsDataUrlRequest;
      return fetchImageAsDataUrlFromBackground(src, pageUrl);
    }

    case 'exportPdf': {
      await openGhostExportTab(message);
      return { success: true };
    }

    case 'EXPORT_SESSION': {
      const { session, format, settings } = message as unknown as ExportSessionRequest;
      // 缓存到 IndexedDB
      await upsertSession(session);

      // PDF 优先走 HTML 聊天视图渲染（更接近预览效果）；失败时由 PDFExporter 兜底
      if (format === 'pdf') {
        try {
          const htmlExporter = new HtmlExporter({ preferPlainText: false });
          const htmlBlob = await htmlExporter.export(session, settings);
          const html = await htmlBlob.text();

          const resp = await forwardToGeminiTab({ action: 'RENDER_HTML_TO_PDF', html }) as {
            success: boolean; pdfBase64?: string; error?: string;
          };

          if (resp.success && resp.pdfBase64 && resp.pdfBase64.length > 3000) {
            session.pdfBase64 = resp.pdfBase64;
          } else {
            console.warn('[PDF] Pre-rendered PDF is empty/invalid, fallback to jsPDF', {
              success: resp.success,
              size: resp.pdfBase64?.length ?? 0,
              error: resp.error,
            });
            delete session.pdfBase64;
          }
        } catch (e) {
          console.warn('[PDF] HTML chat-view render failed, fallback to jsPDF:', e);
          delete session.pdfBase64;
        }
      }

      // 当前聊天导出改为异步启动，避免 Popup 一直阻塞到下载对话框/下载启动完成。
      const task = startExportTask(session, format, settings);
      return { success: true, taskId: task.id };
    }

    case 'BATCH_EXPORT': {
      const { sessionIds, format, settings, theme } = message as unknown as BatchExportRequest;
      const results: ExportTask[] = [];
      let activeTabId: number | undefined;

      for (const id of sessionIds) {
        let session = await getSession(id);
        
        // 如果会话没有消息数据，说明它只是刚同步的摘要，需要尝试打开页面提取
        if (session && (!session.messages || session.messages.length === 0) && session.url) {
          if (!activeTabId) {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]?.id) {
              activeTabId = tabs[0].id;
            } else {
               // 不能提取，因为没有可用标签页
               continue;
            }
          }
          try {
            await browser.tabs.update(activeTabId, { url: session.url });
            await waitForTabLoad(activeTabId);
            const extractResult = await extractChatWithRetries(activeTabId);
            if (extractResult.success && extractResult.data) {
               await upsertSession(extractResult.data);
               session = extractResult.data;
            }
          } catch (e) {
            console.error(`[BatchExport] Failed to extract chat ${session.id}:`, e);
            continue; // 提取失败跳过导出
          }
        }

        if (session && session.messages && session.messages.length > 0) {
          if (format === 'pdf') {
            await openGhostExportForSession(session, settings, theme);
            results.push({
              id: createGhostExportId(),
              sessionId: session.id,
              sessionTitle: session.title,
              format,
              status: 'done',
              progress: 100,
            });
          } else {
            const task = await executeExportTask(session, format, settings);
            results.push(task);
          }
        }
      }
      return {
        success: results.length > 0 && results.every((t) => t.status === 'done'),
        data: results,
      };
    }

    case 'SYNC_WEB_SESSIONS': {
      const resp = await forwardToGeminiTab({ action: 'EXTRACT_CHAT_LIST' }) as { success: boolean, data?: ChatSessionSummary[], error?: string };
      if (resp.success && resp.data) {
        await upsertWebSummaries(resp.data);
      }
      const summaries = await getAllSessionSummaries();
      return { success: resp.success, data: summaries, error: resp.error };
    }

    case 'GET_CACHED_SESSIONS': {
      const summaries = await getAllSessionSummaries();
      return { success: true, data: summaries };
    }

    case 'SEARCH_SESSIONS': {
      const { query } = message as unknown as SearchSessionsRequest;
      const results = await searchSessions(query);
      return { success: true, data: results };
    }

    case 'DELETE_CACHED_SESSION': {
      const { sessionId } = message as unknown as DeleteCachedSessionRequest;
      await deleteSession(sessionId);
      return { success: true };
    }

    case 'BATCH_DELETE_SESSIONS': {
      const { sessionIds, deleteFromWeb } = message as unknown as BatchDeleteSessionsRequest;
      const deleted: string[] = [];
      const failed: string[] = [];

      for (const id of sessionIds) {
        try {
          // 删除本地缓存
          await deleteSession(id);

          // 如果需要，从 web 上删除
          if (deleteFromWeb) {
            const session = await getSession(id);
            if (!session) {
              // 如果已删除，尝试使用 ID 从 web 删除
              await deleteFromWebIfPossible(id);
            }
          }

          deleted.push(id);
        } catch (error) {
          console.error(`Failed to delete session ${id}:`, error);
          failed.push(id);
        }
      }

      return {
        success: failed.length === 0,
        deleted,
        failed: failed.length > 0 ? failed : undefined,
      };
    }

    case 'GET_SETTINGS': {
      const [settings, storedSettings] = await Promise.all([
        getSettings(),
        getStoredSettings(),
      ]);
      const language = await resolvePreferredLanguage({
        fallbackLanguage: storedSettings?.language,
        migrateLegacyLanguage: false,
      });
      return { success: true, data: { ...settings, language } };
    }

    case 'SAVE_SETTINGS': {
      const { settings: userSettings } = message as unknown as SaveSettingsRequest;
      await saveSettings(userSettings);
      return { success: true };
    }

    case 'GET_EXPORT_TASKS': {
      return { success: true, data: getActiveTasks() };
    }

    case 'EXPORT_ALL': {
      const { format, settings, theme } = message as unknown as ExportAllRequest;
      return handleExportAll(format, settings, theme);
    }

    case 'SELECT_MESSAGES_FOR_EXPORT':
    case 'EXTRACT_CURRENT_CHAT': {
      // 转发到 Content Script
      return forwardToContentScript(message);
    }

    case 'EXTRACT_GEMINI_CHAT_HTML': {
      const response = await forwardToContentScript(message) as ExtractGeminiChatHtmlResponse;
      if (!response?.success) {
        return response;
      }

      if ((message as { mode?: string }).mode === 'cache-only') {
        return response;
      }

      if (!response.html || !response.html.trim()) {
        return { success: false, error: 'Extracted HTML is empty' };
      }

      await openGhostExportTab({
        html: response.html,
        title: response.title,
        filename: response.filename,
        theme: response.theme ?? message.theme,
      });

      return { success: true };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

/** 将消息转发给当前活跃标签页的 Content Script */
async function forwardToContentScript(message: Record<string, unknown>): Promise<unknown> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) {
    return { success: false, error: 'No active tab' };
  }

  if (!isGeminiTab(tab.url)) {
    return {
      success: false,
      error: `Please open a Gemini chat page on https://${GEMINI_HOST}/ and try again.`,
    };
  }

  try {
    return await sendMessageToContentWithRecovery(tab.id, message);
  } catch (e) {
    return {
      success: false,
      error: `Content script not available: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** 尝试找到任何一个 Gemini 页面并转发消息 (不一定要当前 active tab) */
async function forwardToGeminiTab(message: Record<string, unknown>): Promise<unknown> {
  const tabs = await browser.tabs.query({ url: "*://gemini.google.com/*" });
  const t = tabs.find(tab => isGeminiTab(tab.url) && tab.id);
  
  if (!t || !t.id) {
    return { success: false, error: `Please open a Gemini chat page on https://${GEMINI_HOST}/ and try again.` };
  }

  try {
    return await sendMessageToContentWithRecovery(t.id, message);
  } catch (e) {
    return {
      success: false,
      error: `Content script not available on Gemini tab: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function isGeminiTab(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === GEMINI_HOST;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingReceiverError(error: unknown): boolean {
  const msg = errorMessage(error);
  return msg.includes('Could not establish connection')
    || msg.includes('Receiving end does not exist')
    || msg.includes('message port closed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryInjectContentScript(tabId: number): Promise<boolean> {
  const api = browser as unknown as {
    scripting?: {
      executeScript: (details: { target: { tabId: number }; files: string[] }) => Promise<unknown>;
    };
  };

  if (!api.scripting?.executeScript) return false;

  try {
    const browserTarget = typeof __BROWSER_TARGET__ !== 'undefined'
      ? __BROWSER_TARGET__
      : 'chrome';
    const files = browserTarget === 'firefox'
      ? ['content-loader.js']
      : ['content.js'];

    await api.scripting.executeScript({
      target: { tabId },
      files,
    });
    return true;
  } catch (e) {
    console.warn('[ContentScript] Failed to inject content script:', e);
    return false;
  }
}

async function waitForContentReady(tabId: number, attempts = 12, delayMs = 200): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await browser.tabs.sendMessage(tabId, { action: 'PING' });
      return true;
    } catch {
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  return false;
}

async function sendMessageToContentWithRecovery(
  tabId: number,
  message: Record<string, unknown>,
): Promise<unknown> {
  let injected = false;
  let lastReceiverError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const ready = await waitForContentReady(
      tabId,
      injected ? 30 : attempt === 1 ? 1 : 10,
      injected ? 250 : attempt === 1 ? 0 : 180,
    );

    if (!ready) {
      const injectedNow = await tryInjectContentScript(tabId);
      injected = injected || injectedNow;

      if (injectedNow) {
        const becameReady = await waitForContentReady(tabId, 30, 250);
        if (!becameReady) {
          lastReceiverError = new Error('Content script injection completed but no receiver became ready in time.');
          if (attempt < 3) {
            await sleep(220 * attempt);
            continue;
          }

          throw new Error('Content script is still starting up. Wait a moment, then retry export. If it keeps happening, reload the Gemini tab.');
        }
      } else {
        lastReceiverError = new Error('Content script receiver is not ready yet.');
        if (attempt < 3) {
          await sleep(220 * attempt);
          continue;
        }

        throw new Error('Content script not available. Gemini may still be loading—wait a moment or refresh the tab, then retry export.');
      }
    }

    try {
      return await browser.tabs.sendMessage(tabId, message);
    } catch (e) {
      if (!isMissingReceiverError(e)) throw e;

      lastReceiverError = e;
      const injectedNow = await tryInjectContentScript(tabId);
      injected = injected || injectedNow;

      if (attempt < 3) {
        await sleep(220 * attempt);
        continue;
      }
    }
  }

  throw new Error(`Content script not available: ${errorMessage(lastReceiverError)}`);
}

/** 从 Gemini web 删除聊天 */
async function deleteFromWebIfPossible(chatId: string): Promise<void> {
  try {
    const tabs = await browser.tabs.query({ url: `https://${GEMINI_HOST}/*` });
    if (tabs.length === 0) {
      console.warn(`[DELETE] No active Gemini tab found to delete chat ${chatId}`);
      return;
    }

    // 使用第一个找到的 Gemini 标签页
    const tab = tabs[0];
    if (!tab.id) return;

    const result = await sendMessageToContentWithRecovery(tab.id, {
      action: 'DELETE_CHAT_FROM_WEB',
      chatId,
    } as unknown as Record<string, unknown>) as { success?: boolean; error?: string };

    if (!result.success) {
      console.warn(`[DELETE] Failed to delete chat ${chatId} from web:`, result.error);
    } else {
      console.log(`[DELETE] Successfully deleted chat ${chatId} from web`);
    }
  } catch (error) {
    console.error(`[DELETE] Error deleting chat ${chatId} from web:`, error);
  }
}

async function extractChatWithRetries(tabId: number): Promise<ExtractCurrentChatResponse> {
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await sendMessageToContentWithRecovery(tabId, {
      action: 'EXTRACT_CURRENT_CHAT',
    }) as ExtractCurrentChatResponse;

    if (result.success && result.data) {
      return result;
    }

    const message = result.error ?? '';
    const canRetry = message.includes('No messages found') || message.includes('not available');
    if (!canRetry || attempt === maxAttempts) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  return { success: false, error: 'Unable to extract chat after retries' };
}

/** 缓存提取到的对话 (供 Content Script 主动上报使用) */
export async function cacheSession(session: ChatSession): Promise<void> {
  await upsertSession(session);
}

/** 等待标签页加载完成 */
function waitForTabLoad(tabId: number, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: browser.Tabs.OnUpdatedChangeInfoType) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    browser.tabs.onUpdated.addListener(listener);
  });
}

/** 导出所有对话: 从侧边栏获取列表, 逐个打开、提取、导出 */
async function handleExportAll(
  format: 'markdown' | 'pdf' | 'html' | 'txt',
  settings: import('@/types/models').UserSettings,
  theme?: string,
): Promise<unknown> {
  // 1. 在页面弹窗让用户选择需要导出的聊天
  const selectedResp = await forwardToContentScript({ action: 'SELECT_CHATS_FOR_EXPORT' }) as SelectChatsForExportResponse;
  if (selectedResp.cancelled) {
    return { success: false, cancelled: true, total: 0, exported: 0 };
  }

  if (!selectedResp.success || !selectedResp.data || selectedResp.data.length === 0) {
    return { success: false, total: 0, exported: 0, error: selectedResp.error ?? 'No chats selected' };
  }

  const chatEntries: ChatSessionSummary[] = selectedResp.data;
  const total = chatEntries.length;
  let exported = 0;
  let processed = 0;

  // Broadcast initial progress
  broadcastExportAllProgress({
    total,
    exported,
    processed,
    currentIndex: 0,
    currentProgress: 0,
    phase: 'preparing',
    status: 'in-progress',
  });

  // 2. Get the current active tab so we can reuse it
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab?.id) {
    return { success: false, total, exported: 0, error: 'No active tab' };
  }
  const tabId = activeTab.id;

  // 3. For each chat, navigate the tab, extract, and export
  for (const [index, entry] of chatEntries.entries()) {
    const currentIndex = index + 1;

    if (!entry.url) {
      processed = currentIndex;
      broadcastExportAllProgress({
        total,
        exported,
        processed,
        currentIndex,
        currentTitle: entry.title,
        currentProgress: 100,
        phase: 'skipped-chat',
        status: 'in-progress',
      });
      continue;
    }

    try {
      broadcastExportAllProgress({
        total,
        exported,
        processed,
        currentIndex,
        currentTitle: entry.title,
        currentProgress: 15,
        phase: 'loading-chat',
        status: 'in-progress',
      });

      // Navigate to the chat URL
      await browser.tabs.update(tabId, { url: entry.url });
      await waitForTabLoad(tabId);

      broadcastExportAllProgress({
        total,
        exported,
        processed,
        currentIndex,
        currentTitle: entry.title,
        currentProgress: 50,
        phase: 'extracting-chat',
        status: 'in-progress',
      });

      // Extract chat data with retries because Gemini page can take time to render messages.
      const extractResult = await extractChatWithRetries(tabId);

      if (extractResult.success && extractResult.data) {
        // Cache and export
        await upsertSession(extractResult.data);
        broadcastExportAllProgress({
          total,
          exported,
          processed,
          currentIndex,
          currentTitle: extractResult.data.title || entry.title,
          currentProgress: 80,
          phase: 'exporting-chat',
          status: 'in-progress',
        });

        if (format === 'pdf') {
          await openGhostExportForSession(extractResult.data, settings, theme);
        } else {
          await executeExportTask(extractResult.data, format, settings);
        }
        exported++;
        processed = currentIndex;
        broadcastExportAllProgress({
          total,
          exported,
          processed,
          currentIndex,
          currentTitle: extractResult.data.title || entry.title,
          currentProgress: 100,
          phase: 'completed-chat',
          status: 'in-progress',
        });
      } else {
        processed = currentIndex;
        broadcastExportAllProgress({
          total,
          exported,
          processed,
          currentIndex,
          currentTitle: entry.title,
          currentProgress: 100,
          phase: 'failed-chat',
          status: 'in-progress',
        });
      }
    } catch (e) {
      processed = currentIndex;
      console.error(`[ExportAll] Failed to export chat ${entry.id}:`, e);
      broadcastExportAllProgress({
        total,
        exported,
        processed,
        currentIndex,
        currentTitle: entry.title,
        currentProgress: 100,
        phase: 'failed-chat',
        status: 'in-progress',
      });
    }
  }

  broadcastExportAllProgress({
    total,
    exported,
    processed: total,
    currentIndex: total,
    currentProgress: 100,
    phase: 'done',
    status: 'done',
  });
  if (exported === 0) {
    return { success: false, total, exported, error: 'No selected chats were exported successfully. Please retry after chats finish loading.' };
  }
  return { success: true, total, exported };
}

/** 广播 Export All 进度 */
function broadcastExportAllProgress(progress: Omit<ExportAllProgressMessage, 'action'>): void {
  browser.runtime.sendMessage({
    action: 'EXPORT_ALL_PROGRESS',
    ...progress,
  }).catch(() => { /* UI may be closed */ });
}

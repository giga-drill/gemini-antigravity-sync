// src/shared/browser-api.ts — 跨浏览器兼容层
// 统一 Chrome / Firefox 扩展 API 调用

import browser from 'webextension-polyfill';

export { browser };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientBackgroundMessageError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('Could not establish connection')
    || message.includes('Receiving end does not exist')
    || message.includes('message port closed');
}

/** 向当前活跃标签页的 Content Script 发送消息 */
export async function sendMessageToActiveTab<T>(message: unknown): Promise<T> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error('No active tab found');
  return browser.tabs.sendMessage(tab.id, message) as Promise<T>;
}

/** 向 Background Service Worker 发送消息 */
export async function sendMessageToBackground<T>(message: unknown): Promise<T> {
  let lastError: unknown;
  const isPingMessage = typeof message === 'object'
    && message !== null
    && 'action' in message
    && (message as { action?: unknown }).action === 'PING';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await browser.runtime.sendMessage(message) as T;
    } catch (error) {
      lastError = error;

      if (!isTransientBackgroundMessageError(error) || attempt === 3) {
        throw error;
      }

      if (!isPingMessage) {
        try {
          await browser.runtime.sendMessage({ action: 'PING' });
        } catch {
          // Ignore warm-up failures and retry the original message below.
        }
      }

      await sleep(120 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(getErrorMessage(lastError));
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,${btoa(binary)}`;
}

/** 触发浏览器本地下载 */
export async function triggerDownload(blob: Blob, filename: string): Promise<number> {
  const isMarkdown = filename.toLowerCase().endsWith('.md');
  const normalizedFilename = filename.replace(/^[/\\]+/, '');
  const targetFilename = isMarkdown && !normalizedFilename.startsWith('gemini-chats/')
    ? `gemini-chats/${normalizedFilename}`
    : filename;

  const canUseObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  const url = canUseObjectUrl ? URL.createObjectURL(blob) : await blobToDataUrl(blob);
  try {
    const downloadId = await browser.downloads.download({
      url,
      filename: targetFilename,
      saveAs: !isMarkdown,
    });
    return downloadId;
  } finally {
    if (canUseObjectUrl) {
      // 延迟释放 URL, 确保下载启动
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
}

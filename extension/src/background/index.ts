// src/background/index.ts — Background Service Worker 入口
// MV3 Service Worker: 统筹全局逻辑、处理消息路由

import { browser } from '@/shared/browser-api';
import { handleMessage } from './message-handler';

// 消息监听
browser.runtime.onMessage.addListener(
  (message: unknown, sender: browser.Runtime.MessageSender) => {
    // 返回 Promise 以支持异步响应
    return handleMessage(message as Record<string, unknown>, sender);
  }
);

// 安装事件
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Gemini Chat Exporter] Extension installed');
  }
});

console.log('[Gemini Chat Exporter] Background service worker started');

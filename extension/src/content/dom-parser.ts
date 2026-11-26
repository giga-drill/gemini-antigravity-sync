// src/content/dom-parser.ts — Gemini 页面 DOM 解析器
//
// Gemini 网页的 DOM 结构可能随版本迭代变化,
// 本模块使用多组选择器进行降级匹配, 提升鲁棒性。

import type { ChatMessage, ChatSessionSummary } from '@/types/models';
import { extractImages } from './image-extractor';
import { CONTENT_GEMINI_ORIGIN } from './constants';

interface ParseMessagesOptions {
  includeImages?: boolean;
}

/** 对话轮次容器的候选选择器 (按优先级) */
const TURN_SELECTORS = [
  '.conversation-turn',         // 常见布局
  '[data-turn-id]',             // 带 turn id 属性
  '.message-row',               // 备选
  'model-response, user-query', // Web Component 标签
];

/** 用户消息的候选选择器 */
const USER_SELECTORS = [
  '.user-query',
  '[data-is-user="true"]',
  '.query-text',
  'user-query',
];

/** 模型回复的候选选择器 */
const MODEL_SELECTORS = [
  '.model-response',
  '[data-is-model="true"]',
  '.response-text',
  'model-response',
  '.markdown-main-panel',
];

/** 用户消息内容区域的候选选择器 */
const USER_CONTENT_SELECTORS = [
  '.query-text',
  'user-query-content',
  '.user-query-bubble-with-background',
  '.message-content',
  '.text-content',
];

/** 模型回复文本内容区域的候选选择器 */
const CONTENT_SELECTORS = [
  '.message-content',
  '.text-content',
  '.markdown-content',
  'message-content',
  '.markdown-main-panel',
];

/** 辅助阅读/装饰节点选择器，导出正文与 HTML 时需剥离 */
const NON_CONTENT_SELECTOR =
  'script, style, svg, button, mat-icon, [aria-hidden="true"], .cdk-visually-hidden, .sr-only, .visually-hidden';

function resolveContentElement(turn: Element, role: 'user' | 'model'): Element {
  const selectors = role === 'user' ? USER_CONTENT_SELECTORS : CONTENT_SELECTORS;
  return queryFirst(turn, selectors) ?? turn;
}

function queryFirst(root: Element | Document, selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function queryAll(root: Element | Document, selectors: string[]): Element[] {
  for (const sel of selectors) {
    const els = root.querySelectorAll(sel);
    if (els.length > 0) return Array.from(els);
  }
  return [];
}

/** 提取元素 innerHTML, 清理 Gemini 特有属性但保留语义标签 */
function extractHtml(el: Element): string {
  const clone = el.cloneNode(true) as Element;

  // Remove non-semantic and screen-reader-only elements entirely
  clone.querySelectorAll(NON_CONTENT_SELECTOR).forEach(n => n.remove());
  clone.querySelectorAll('img').forEach((n) => n.remove());

  // Unwrap Gemini custom elements and meaningless wrapper divs,
  // keeping only their children to avoid extra block-level spacing.
  const unwrapSelectors = [
    'response-element', 'table-block', 'message-content',
    'user-query', 'model-response',
    'chat-message', 'model-thoughts',
  ];
  for (const sel of unwrapSelectors) {
    clone.querySelectorAll(sel).forEach(node => {
      const parent = node.parentNode;
      if (parent) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
      }
    });
  }

  // Unwrap pure wrapper <div> and <span> that contain only a single block child
  // or that add no semantic meaning (no useful attributes after cleanup)
  const unwrapEmpty = (root: Element) => {
    // Multiple passes for nested wrappers
    for (let pass = 0; pass < 3; pass++) {
      root.querySelectorAll('div, span').forEach(node => {
        // If it has no text content at all, remove it
        if (!node.textContent?.trim()) {
          node.remove();
          return;
        }
        // Unwrap divs that just wrap other block elements with no added value
        if (node.tagName === 'DIV' && node.children.length > 0) {
          // Check if this div has no useful attributes
          if (node.attributes.length === 0) {
            // Check if parent is also a block container — unwrap to reduce nesting
            const parent = node.parentNode;
            if (parent && parent !== root) {
              while (node.firstChild) parent.insertBefore(node.firstChild, node);
              parent.removeChild(node);
            }
          }
        }
      });
    }
  };
  unwrapEmpty(clone);

  // Strip all attributes except essential ones
  clone.querySelectorAll('*').forEach(node => {
    const keep = new Set(['href', 'src', 'alt', 'colspan', 'rowspan']);
    for (const attr of Array.from(node.attributes)) {
      if (!keep.has(attr.name)) {
        node.removeAttribute(attr.name);
      }
    }
  });

  // Remove HTML comments (<!---->)
  const removeComments = (node: Node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_COMMENT);
    const comments: Node[] = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(c => c.parentNode?.removeChild(c));
  };
  removeComments(clone);

  // Clean up excessive whitespace
  return clone.innerHTML
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

const NESTED_BLOCK_SELECTOR = 'p, pre, ul, ol, table, br, h1, h2, h3, h4, h5, h6, div';

function extractTextFromCleanNode(el: Element): string {
  const parts: string[] = [];

  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) parts.push(text);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      const tag = childEl.tagName.toLowerCase();
      const innerText = childEl.textContent?.trim() ?? '';
      switch (tag) {
        case 'pre': {
          const code = childEl.querySelector('code');
          const lang = code?.className?.match(/language-(\w+)/)?.[1] ?? '';
          parts.push(`\n\`\`\`${lang}\n${code?.textContent ?? innerText}\n\`\`\`\n`);
          break;
        }
        case 'code':
          parts.push(`\`${innerText}\``);
          break;
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
          const level = parseInt(tag[1]);
          parts.push(`\n${'#'.repeat(level)} ${innerText}\n`);
          break;
        }
        case 'ul': case 'ol': {
          const items = childEl.querySelectorAll(':scope > li');
          items.forEach((li, i) => {
            const prefix = tag === 'ol' ? `${i + 1}. ` : '- ';
            parts.push(`${prefix}${li.textContent?.trim()}`);
          });
          parts.push('');
          break;
        }
        case 'table':
          parts.push(extractTable(child as HTMLTableElement));
          break;
        case 'strong': case 'b':
          parts.push(`**${innerText}**`);
          break;
        case 'em': case 'i':
          parts.push(`*${innerText}*`);
          break;
        case 'br':
          parts.push('\n');
          break;
        case 'img':
          // 图片由 image-extractor 处理
          break;
        default:
          if (childEl.querySelector(NESTED_BLOCK_SELECTOR)) {
            const nested = extractTextFromCleanNode(childEl);
            if (nested) parts.push(nested);
          } else if (innerText) {
            parts.push(innerText);
          }
      }
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 从元素中提取可读文本, 保留基本的 Markdown 格式并剔除隐藏辅助文本 */
function extractText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(NON_CONTENT_SELECTOR).forEach(n => n.remove());
  return extractTextFromCleanNode(clone);
}

function extractTable(table: HTMLTableElement): string {
  const rows: string[][] = [];
  table.querySelectorAll('tr').forEach(tr => {
    const cells: string[] = [];
    tr.querySelectorAll('th, td').forEach(cell => {
      cells.push(cell.textContent?.trim() ?? '');
    });
    rows.push(cells);
  });

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map(r => r.length));
  const header = rows[0];
  const separator = Array(colCount).fill('---');
  const bodyRows = rows.slice(1);

  const lines = [
    '| ' + header.join(' | ') + ' |',
    '| ' + separator.join(' | ') + ' |',
    ...bodyRows.map(r => '| ' + r.join(' | ') + ' |'),
  ];
  return '\n' + lines.join('\n') + '\n';
}

/** 判断元素是否属于用户消息 */
function isUserTurn(el: Element): boolean {
  for (const sel of USER_SELECTORS) {
    if (el.matches(sel) || el.querySelector(sel)) return true;
  }
  // 检查 data 属性
  if (el.getAttribute('data-role') === 'user') return true;
  if (el.classList.contains('user')) return true;
  return false;
}

/**
 * 解析当前页面的对话消息列表
 * 采用多级选择器降级策略, 兼容 Gemini DOM 结构变化
 */
export async function parseMessages(
  onlySelected?: boolean,
  options: ParseMessagesOptions = {},
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  const imageOptions = {
    enabled: options.includeImages !== false,
  };

  const checkSelected = (el: Element): boolean => {
    return !onlySelected || el.classList.contains('gce-message-selected');
  };

  // 策略1: 按对话轮次容器解析
  const turns = queryAll(document, TURN_SELECTORS);
  if (turns.length > 0) {
    for (const turn of turns) {
      if (!checkSelected(turn)) continue;
      const role: 'user' | 'model' = isUserTurn(turn) ? 'user' : 'model';
      const contentEl = resolveContentElement(turn, role);
      const content = extractText(contentEl);
      const contentHtml = extractHtml(contentEl);
      const images = role === 'user' ? await extractImages(turn, imageOptions) : [];
      if (content || images.length > 0) {
        messages.push({ role, content, contentHtml, images, timestamp: Date.now() });
      }
    }
    return messages;
  }

  // 策略2: 分别查找 user 和 model 块, 交替排列
  const userEls = queryAll(document, USER_SELECTORS);
  const modelEls = queryAll(document, MODEL_SELECTORS);
  const maxLen = Math.max(userEls.length, modelEls.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < userEls.length) {
      if (checkSelected(userEls[i])) {
        const contentEl = resolveContentElement(userEls[i], 'user');
        const content = extractText(contentEl);
        const contentHtml = extractHtml(contentEl);
        const images = await extractImages(userEls[i], imageOptions);
        if (content || images.length > 0) {
          messages.push({ role: 'user', content, contentHtml, images, timestamp: Date.now() });
        }
      }
    }
    if (i < modelEls.length) {
      if (checkSelected(modelEls[i])) {
        const contentEl = resolveContentElement(modelEls[i], 'model');
        const content = extractText(contentEl);
        const contentHtml = extractHtml(contentEl);
        const images: string[] = [];
        if (content || images.length > 0) {
          messages.push({ role: 'model', content, contentHtml, images, timestamp: Date.now() });
        }
      }
    }
  }

  return messages;
}

export function getMessageNodes(): Element[] {
  const turns = queryAll(document, TURN_SELECTORS);
  if (turns.length > 0) return turns;

  const userEls = queryAll(document, USER_SELECTORS);
  const modelEls = queryAll(document, MODEL_SELECTORS);
  const nodes: Element[] = [];
  const maxLen = Math.max(userEls.length, modelEls.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < userEls.length) nodes.push(userEls[i]);
    if (i < modelEls.length) nodes.push(modelEls[i]);
  }
  return nodes;
}

/** 解析对话标题 */
export function parseTitle(): string {
  const conversationTitleEl = document.querySelector('[data-test-id="conversation-title"]');
  const conversationTitle = conversationTitleEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (conversationTitle) return conversationTitle;

  // 优先从页面标题提取
  const titleEl = document.querySelector('title');
  const pageTitle = titleEl?.textContent?.trim() ?? '';

  // 去掉 "Gemini" 等后缀
  const cleaned = pageTitle.replace(/\s*[-–—|]\s*Gemini.*$/i, '').trim();
  if (cleaned && cleaned !== 'Gemini') return cleaned;

  // 从 DOM 中找可能的标题元素
  const headerEl = document.querySelector(
    '.conversation-title, [data-conversation-title], h1'
  );
  if (headerEl?.textContent?.trim()) return headerEl.textContent.trim();

  return `Gemini Chat ${new Date().toLocaleDateString()}`;
}

/** 从 URL 提取对话 ID */
export function parseChatId(): string {
  const match = window.location.pathname.match(/\/(?:chat|app)\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get('chatId') ?? `chat_${Date.now()}`;
}

/** 侧边栏聊天链接的候选选择器 (按优先级) */
const SIDEBAR_CHAT_SELECTORS = [
  'a[href*="/app/"]',                 // 新版 Gemini 常见路径
  'a[href*="/chat/"]',                // 链接中包含 /chat/ 路径
  'nav a[href*="/app/"]',             // 备选路径格式
  '.conversation-list a',              // 常见列表容器
  '[data-conversation-id]',            // 带对话 ID 属性的元素
  '[data-chat-id]',
  '[data-id]',
];

function parseChatIdFromUrl(url: string): string | null {
  const match = url.match(/\/(?:chat|app)\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/);
  return match ? match[1] : null;
}

function queryAllDeep(root: Document | ShadowRoot, selector: string): Element[] {
  const results = new Set<Element>();
  const stack: Array<Document | ShadowRoot | Element> = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    if ('querySelectorAll' in current) {
      current.querySelectorAll(selector).forEach((el) => results.add(el));
      current.querySelectorAll('*').forEach((el) => {
        const maybeShadow = (el as Element).shadowRoot;
        if (maybeShadow) stack.push(maybeShadow);
      });
    }
  }

  return Array.from(results);
}

/**
 * 从侧边栏解析所有聊天条目
 * 返回包含 id, title, url 的摘要列表
 */
export function parseChatList(): ChatSessionSummary[] {
  const results: ChatSessionSummary[] = [];
  const seen = new Set<string>();

  for (const sel of SIDEBAR_CHAT_SELECTORS) {
    const elements = queryAllDeep(document, sel);
    if (elements.length === 0) continue;

    for (const el of elements) {
      const anchor = el.closest('a') ?? (el.tagName === 'A' ? el as HTMLAnchorElement : null);
      let chatId: string | null = null;
      let url = '';

      if (anchor) {
        const href = (anchor as HTMLAnchorElement).getAttribute('href') ?? '';
        if (href) {
          try {
            url = new URL(href, window.location.origin).href;
          } catch {
            url = (anchor as HTMLAnchorElement).href;
          }
        }
        chatId = parseChatIdFromUrl(url);
      }

      // 也支持 data-conversation-id 属性
      if (!chatId) {
        chatId = el.getAttribute('data-conversation-id')
          ?? el.getAttribute('data-chat-id')
          ?? el.getAttribute('data-id');
        if (chatId && !url) {
          url = `${CONTENT_GEMINI_ORIGIN}/app/${chatId}`;
        }
      }

      if (!chatId || seen.has(chatId)) continue;
      seen.add(chatId);

      const title = el.getAttribute('aria-label')
        ?? el.getAttribute('title')
        ?? el.textContent?.trim()
        ?? `Chat ${chatId}`;

      results.push({
        id: chatId,
        title: title.substring(0, 200),
        author: '',
        url,
        messageCount: 0,
        exportDate: 0,
      });
    }

    if (results.length > 0) break; // 找到就停止
  }

  // 兜底: 至少返回当前会话, 避免误报“未找到聊天”
  if (results.length === 0) {
    const currentId = parseChatId();
    results.push({
      id: currentId,
      title: parseTitle(),
      author: '',
      url: window.location.href,
      messageCount: 0,
      exportDate: 0,
    });
  }

  return results;
}

// src/content/index.ts — Content Script 入口
// 注入到 Gemini 页面, 响应来自 Background 的数据提取请求

import { parseMessages, parseTitle, parseChatId, parseChatList, getMessageNodes } from './dom-parser';
import { fetchAuthorName, fetchModelVersion } from './metadata-fetcher';
import { buildFilename } from '@/shared/constants';
import { browser } from '@/shared/browser-api';
import { buildStandardChatHtml } from '@/shared/standard-chat-html';
import type { ChatMessage, ChatSession, ChatSessionSummary, UserSettings } from '@/types/models';
import { sanitizeMessagesForImageExport, shouldExportUserInputImages } from '@/types/models';
import type {
  ExtractGeminiChatHtmlResponse,
  ExtractCurrentChatResponse,
  SelectChatsForExportResponse,
} from '@/types/messages';

type RuntimeLike = {
  onMessage: {
    addListener: (listener: (message: unknown) => unknown) => void;
  };
};

type BrowserLike = {
  storage?: {
    local?: {
      get?: (keys?: string | string[] | Record<string, unknown>) => Promise<Record<string, unknown>>;
      set?: (items: Record<string, unknown>) => Promise<void>;
    };
  };
  runtime?: {
    sendMessage?: (message: unknown) => Promise<unknown>;
  };
};

type ConversationScrollContext = {
  root: HTMLElement;
  messageNodes: Element[];
  interactionRoot: HTMLElement | null;
};

function getRuntime(): RuntimeLike {
  return browser.runtime as unknown as RuntimeLike;
}

function getBrowserApi(): BrowserLike {
  return browser as unknown as BrowserLike;
}

function normalizeExportTheme(theme: unknown): 'theme-notion' | 'theme-academic' | 'theme-script' {
  if (theme === 'theme-academic') return 'theme-academic';
  if (theme === 'theme-script') return 'theme-script';
  return 'theme-notion';
}

function resolveUserLabel(settings: { userLabelMode?: 'you' | 'account-name' } | undefined, authorName?: string): string {
  if (settings?.userLabelMode === 'account-name') {
    const trimmed = (authorName || '').trim();
    if (trimmed && trimmed !== 'Unknown User') return trimmed;
  }
  return 'You';
}

function resolveImageExtractionOptions(settings: UserSettings | undefined) {
  return {
    includeImages: shouldExportUserInputImages(settings),
  };
}

function isZhLanguage(preferredLanguage?: string): boolean {
  const lang = (preferredLanguage || navigator.language || '').toLowerCase();
  return lang.startsWith('zh');
}

const DEBUG_EXTRACTION = (() => {
  try {
    const byQuery = new URLSearchParams(window.location.search).get('gce_debug_extract') === '1';
    const byStorage = globalThis.localStorage?.getItem('gce_debug_extract') === '1';
    return byQuery || byStorage;
  } catch {
    return false;
  }
})();

function debugLog(event: string, data?: Record<string, unknown>): void {
  if (!DEBUG_EXTRACTION) return;
  if (data) {
    console.log('[GCE][extract]', event, data);
  } else {
    console.log('[GCE][extract]', event);
  }
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const raf = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0);

    raf(() => resolve());
  });
}

function getConversationPreparationText(preferredLanguage?: string) {
  const isZh = isZhLanguage(preferredLanguage);
  return {
    preparingCurrent: isZh ? '正在准备当前会话内容…' : 'Preparing current conversation…',
    preparingSelection: isZh ? '正在准备框选导出…' : 'Preparing selection export…',
    expanding: isZh ? '正在展开会话内容…' : 'Expanding conversation content…',
    loadingEarlier: isZh ? '正在拉取最早的对话内容，请稍候…' : 'Loading the earliest messages. Please wait…',
    finalizing: isZh ? '正在整理对话内容…' : 'Finalizing conversation content…',
  };
}

/**
 * Firefox 专用：提取 Gemini 聊天 HTML，保存到 storage 并通知 Background 静默导出 PDF
 */
async function extractGeminiChat(
  themeOverride?: string,
  settingsOverride?: UserSettings,
  _mode: 'export-pdf' | 'cache-only' = 'export-pdf'
): Promise<ExtractGeminiChatHtmlResponse> {
  try {
    const browserApi = getBrowserApi();
    const preparationText = getConversationPreparationText(settingsOverride?.language);
    const loadingOverlay = showSelectionPreparationOverlay(preparationText.preparingCurrent);

    try {
      loadingOverlay.update(preparationText.expanding);
      await waitForNextFrame();
      await warmUpConversationContent(() => loadingOverlay.update(preparationText.expanding));

      const conversationTitle = parseTitle();
      const authorName = fetchAuthorName();
      const userLabel = resolveUserLabel(settingsOverride, authorName);
      const imageOptions = resolveImageExtractionOptions(settingsOverride);
      const includeImages = shouldExportUserInputImages(settingsOverride);

      const rawMessages = await Promise.race([
        collectMessagesByAutoScroll(false, settingsOverride, (statusText) => loadingOverlay.update(statusText)),
        (async () => {
          await sleep(35000);
          loadingOverlay.update(preparationText.finalizing);
          return parseMessages(false, imageOptions);
        })(),
      ]);
      const messages = sanitizeMessagesForImageExport(rawMessages, includeImages);

      const html = buildStandardChatHtml(messages, {
        title: conversationTitle,
        userLabel,
        includeImages,
      });

      console.log('[Gemini Chat Exporter] PDF chat HTML prepared', {
        messageCount: messages.length,
        htmlLength: html.length,
        imageCount: messages.reduce((sum, message) => sum + (message.images?.length || 0), 0),
        imageSummary: summarizeImageSources(messages),
      });

      if (!html || html.trim().length < 20) {
        return { success: false, error: 'Extracted HTML is empty' };
      }

      let theme = normalizeExportTheme(themeOverride);
      if (browserApi.storage?.local?.get) {
        const stored = await browserApi.storage.local.get(['gemini_export_theme']);
        const storedTheme = stored.gemini_export_theme;
        if ((!themeOverride || !themeOverride.trim()) && typeof storedTheme === 'string' && storedTheme.trim()) {
          theme = normalizeExportTheme(storedTheme.trim());
        }
      }

      const filename = buildFilename(conversationTitle, 'pdf');

      const legacyPayload = {
        gemini_clean_html: html,
        gemini_export_theme: theme,
        gemini_chat_title: conversationTitle,
        gemini_export_filename: filename,
      };

      if (_mode === 'cache-only') {
        await browserApi.storage?.local?.set?.(legacyPayload);
      } else {
        window.setTimeout(() => {
          void browserApi.storage?.local?.set?.(legacyPayload).catch((storageError) => {
            console.warn('[Gemini Chat Exporter] Failed to persist legacy PDF cache:', storageError);
          });
        }, 0);
      }

      return {
        success: true,
        html,
        title: conversationTitle,
        filename,
        theme,
      };
    } finally {
      loadingOverlay.close();
    }
  } catch (e) {
    console.error('[Gemini Chat Exporter] PDF chat extract failed:', e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function summarizeImageSources(messages: ChatMessage[]): {
  totalImages: number;
  dataUrlImages: number;
  blobImages: number;
  remoteImages: number;
  googleusercontentImages: number;
  sampleSources: string[];
} {
  const sources = messages.flatMap((message) => message.images || []);
  const sampleSources = sources.slice(0, 5).map((src) => src.slice(0, 160));

  return {
    totalImages: sources.length,
    dataUrlImages: sources.filter((src) => src.startsWith('data:image/')).length,
    blobImages: sources.filter((src) => src.startsWith('blob:')).length,
    remoteImages: sources.filter((src) => /^https?:/i.test(src)).length,
    googleusercontentImages: sources.filter((src) => /(^https?:\/\/)?([^/]+\.)?googleusercontent\.com/i.test(src)).length,
    sampleSources,
  };
}

function getSelectionPreparationText(preferredLanguage?: string) {
  const base = getConversationPreparationText(preferredLanguage);
  const isZh = isZhLanguage(preferredLanguage);
  return {
    preparing: base.preparingSelection,
    expanding: base.expanding,
    loadingEarlier: base.loadingEarlier,
    finalizing: isZh ? '正在整理可选消息…' : 'Finalizing selectable messages…',
  };
}

function showSelectionPreparationOverlay(initialText: string) {
  const existing = document.getElementById('gce-selection-loading-overlay');
  existing?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'gce-selection-loading-overlay';
  overlay.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:24px',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:14px 18px',
    'border-radius:999px',
    'background:rgba(15,23,42,0.88)',
    'color:#fff',
    'box-shadow:0 20px 45px rgba(15,23,42,0.3)',
    'backdrop-filter:blur(10px)',
    'font:600 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
  ].join(';');

  const spinner = document.createElement('div');
  spinner.style.cssText = [
    'width:18px',
    'height:18px',
    'border-radius:999px',
    'border:2px solid rgba(255,255,255,0.3)',
    'border-top-color:#fff',
    'animation:gce-spin 0.9s linear infinite',
    'flex:0 0 auto',
  ].join(';');

  const text = document.createElement('span');
  text.textContent = initialText;

  if (!document.getElementById('gce-selection-loading-style')) {
    const style = document.createElement('style');
    style.id = 'gce-selection-loading-style';
    style.textContent = '@keyframes gce-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
    document.documentElement.appendChild(style);
  }

  overlay.appendChild(spinner);
  overlay.appendChild(text);
  document.body.appendChild(overlay);

  return {
    update(nextText: string) {
      text.textContent = nextText;
    },
    close() {
      overlay.remove();
    },
  };
}

function estimateMessagesSizeBytes(messages: ChatMessage[]): number {
  try {
    return new Blob([JSON.stringify(messages)]).size;
  } catch {
    return 0;
  }
}

function reduceMessagePayload(messages: ChatMessage[]): ChatMessage[] {
  const maxPayloadBytes = 9 * 1024 * 1024; // keep below runtime messaging pressure
  const currentSize = estimateMessagesSizeBytes(messages);
  if (currentSize <= maxPayloadBytes) return messages;

  const stripped = messages.map((m) => ({ ...m, images: [] }));
  const strippedSize = estimateMessagesSizeBytes(stripped);
  debugLog('payload-reduced', {
    beforeBytes: currentSize,
    afterBytes: strippedSize,
    messageCount: messages.length,
  });
  return stripped;
}

const expandButtonClickHistory = new WeakMap<HTMLButtonElement, number>();
const EXPAND_BUTTON_RECLICK_COOLDOWN_MS = 1_200;

function getExpandButtonSearchRoots(): ParentNode[] {
  const main = document.querySelector('main, [role="main"]');
  const candidates = [main, document.body, document.documentElement];
  const roots: ParentNode[] = [];
  const seen = new Set<ParentNode>();

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    roots.push(candidate);
  }

  return roots;
}

function clickExpandButtons(): void {
  const expandPattern = /show more|expand|继续|展开|显示更多/i;
  const seen = new Set<HTMLButtonElement>();
  const now = Date.now();

  for (const root of getExpandButtonSearchRoots()) {
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    for (const button of buttons) {
      if (seen.has(button)) continue;
      seen.add(button);

      const text = (button.textContent ?? '').trim();
      if (!text || !expandPattern.test(text)) continue;
      if (button.disabled) continue;
      if (button.getAttribute('aria-expanded') === 'true') continue;

      const lastClickedAt = expandButtonClickHistory.get(button) ?? 0;
      if (now - lastClickedAt < EXPAND_BUTTON_RECLICK_COOLDOWN_MS) continue;

      expandButtonClickHistory.set(button, now);
      button.click();
    }
  }
}

function countMessageLikeNodes(): number {
  return document.querySelectorAll('.conversation-turn, [data-turn-id], .message-row, model-response, user-query').length;
}

function isNearTop(el: HTMLElement): boolean {
  return el.scrollTop <= 2;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


async function waitForDomMutation(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;

    const done = (changed: boolean) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(changed);
    };

    const observer = new MutationObserver(() => done(true));
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const timer = window.setTimeout(() => done(false), timeoutMs);
  });
}

function getScrollableRoot(): HTMLElement {
  const docRoot = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('main, [role="main"], div'));

  let best: HTMLElement = docRoot;
  let bestScore = Math.max(0, docRoot.scrollHeight - docRoot.clientHeight);

  for (const el of candidates) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (!/(auto|scroll)/.test(style.overflowY)) continue;
    if (el.clientHeight < 220) continue;

    const score = el.scrollHeight - el.clientHeight;
    if (score > bestScore + 120) {
      best = el;
      bestScore = score;
    }
  }

  return best;
}

function isScrollableElement(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  return /(auto|scroll)/.test(style.overflowY) && el.clientHeight >= 180;
}

function isNavLikeContainer(el: HTMLElement): boolean {
  const text = `${el.tagName} ${el.className} ${el.getAttribute('role') ?? ''}`.toLowerCase();
  return /sidenav|sidebar|drawer|nav|aside/.test(text);
}

function parentElementCrossShadow(node: Element | null): HTMLElement | null {
  if (!node) return null;

  if (node.parentElement instanceof HTMLElement) {
    return node.parentElement;
  }

  const root = node.getRootNode();
  if (root instanceof ShadowRoot && root.host instanceof HTMLElement) {
    return root.host;
  }

  return null;
}

function canScrollByTopProbe(el: HTMLElement): boolean {
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  if (max <= 0) return false;

  const previous = el.scrollTop;
  const next = Math.max(0, Math.min(max, previous + 1));
  if (next === previous) return false;

  el.scrollTop = next;
  const changed = el.scrollTop !== previous;
  el.scrollTop = previous;
  return changed;
}

function findScrollableAncestor(start: Element | null): HTMLElement | null {
  let current: HTMLElement | null = start instanceof HTMLElement ? start : parentElementCrossShadow(start);
  while (current) {
    const probeScrollable = canScrollByTopProbe(current);
    const cssScrollable = isScrollableElement(current) && current.scrollHeight - current.clientHeight > 20;
    if (!isNavLikeContainer(current) && (cssScrollable || probeScrollable)) {
      return current;
    }
    current = parentElementCrossShadow(current);
  }
  return null;
}

function getMessageLikeNodesDeep(): Element[] {
  const selectors = ['.conversation-turn', '[data-turn-id]', '.message-row', 'model-response', 'user-query'];
  const roots: Array<Document | ShadowRoot> = [document];
  const seenRoots = new Set<Document | ShadowRoot>();
  const nodes: Element[] = [];

  while (roots.length > 0) {
    const root = roots.pop();
    if (!root || seenRoots.has(root)) continue;
    seenRoots.add(root);

    for (const sel of selectors) {
      root.querySelectorAll(sel).forEach((el) => nodes.push(el));
    }

    root.querySelectorAll('*').forEach((el) => {
      const shadow = (el as Element).shadowRoot;
      if (shadow) roots.push(shadow);
    });
  }

  return nodes;
}

function getCandidateConversationMessageNodes(): Element[] {
  const directNodes = getMessageNodes();
  if (directNodes.length > 0) {
    return directNodes;
  }

  return getMessageLikeNodesDeep();
}

function getInteractionRootFromMessages(messageNodes: Element[]): HTMLElement | null {
  if (messageNodes.length === 0) return null;

  const stats = new Map<HTMLElement, { hits: number; area: number }>();

  for (const node of messageNodes) {
    let current: HTMLElement | null = node instanceof HTMLElement ? node : parentElementCrossShadow(node);
    let depth = 0;
    while (current && depth < 16) {
      const rect = current.getBoundingClientRect();
      const area = Math.max(0, rect.width * rect.height);
      const item = stats.get(current);
      if (item) {
        item.hits += 1;
        item.area = Math.max(item.area, area);
      } else {
        stats.set(current, { hits: 1, area });
      }
      current = parentElementCrossShadow(current);
      depth += 1;
    }
  }

  const minHits = Math.max(3, Math.floor(messageNodes.length * 0.35));
  let best: HTMLElement | null = null;
  let bestHits = -1;
  let bestArea = -1;

  for (const [el, info] of stats.entries()) {
    if (isNavLikeContainer(el)) continue;
    if (info.hits < minHits) continue;
    if (info.hits > bestHits || (info.hits === bestHits && info.area > bestArea)) {
      best = el;
      bestHits = info.hits;
      bestArea = info.area;
    }
  }

  if (best) return best;

  // Fallback: use the first message node's nearest host ancestor.
  const fallback = messageNodes[0] instanceof HTMLElement
    ? (messageNodes[0] as HTMLElement)
    : parentElementCrossShadow(messageNodes[0]);
  if (fallback && !isNavLikeContainer(fallback)) return fallback;

  const nonNavNode = messageNodes.find((n) => {
    const el = n instanceof HTMLElement ? n : parentElementCrossShadow(n);
    return !!el && !isNavLikeContainer(el);
  });
  if (!nonNavNode) return null;
  return nonNavNode instanceof HTMLElement ? nonNavNode : parentElementCrossShadow(nonNavNode);
}

function resolveConversationScrollContext(): ConversationScrollContext {
  const messageNodes = getCandidateConversationMessageNodes();
  const interactionRoot = getInteractionRootFromMessages(messageNodes);

  for (const messageNode of messageNodes) {
    const messageAncestor = findScrollableAncestor(messageNode);
    if (messageAncestor) {
      debugLog('scroll-root-from-message-ancestor', {
        tag: messageAncestor.tagName,
        className: messageAncestor.className,
        scrollHeight: messageAncestor.scrollHeight,
        clientHeight: messageAncestor.clientHeight,
      });
      return {
        root: messageAncestor,
        messageNodes,
        interactionRoot,
      };
    }
  }

  const main = document.querySelector('main, [role="main"]');
  const mainAncestor = findScrollableAncestor(main);
  if (mainAncestor) {
    debugLog('scroll-root-from-main-ancestor', {
      tag: mainAncestor.tagName,
      className: mainAncestor.className,
      scrollHeight: mainAncestor.scrollHeight,
      clientHeight: mainAncestor.clientHeight,
    });
    return {
      root: mainAncestor,
      messageNodes,
      interactionRoot,
    };
  }

  if (interactionRoot) {
    debugLog('scroll-root-from-interaction-root', {
      tag: interactionRoot.tagName,
      className: interactionRoot.className,
      scrollHeight: interactionRoot.scrollHeight,
      clientHeight: interactionRoot.clientHeight,
      messageNodeCount: messageNodes.length,
    });
    return {
      root: interactionRoot,
      messageNodes,
      interactionRoot,
    };
  }

  const fallback = getScrollableRoot();
  if (isNavLikeContainer(fallback)) {
    debugLog('scroll-root-fallback-nav-like', {
      tag: fallback.tagName,
      className: fallback.className,
    });
    return {
      root: document.documentElement,
      messageNodes,
      interactionRoot,
    };
  }
  debugLog('scroll-root-fallback', {
    tag: fallback.tagName,
    className: fallback.className,
    scrollHeight: fallback.scrollHeight,
    clientHeight: fallback.clientHeight,
  });
  return {
    root: fallback,
    messageNodes,
    interactionRoot,
  };
}

function setTop(root: HTMLElement, top: number): void {
  root.scrollTop = top;
  if (root === document.documentElement || root === document.body || root === document.scrollingElement) {
    window.scrollTo(0, top);
  }
}

function scrollToAbsoluteTop(root: HTMLElement): void {
  setTop(root, 0);
  window.scrollTo(0, 0);
}

function nudgeTopLoad(root: HTMLElement, max: number): void {
  const nudge = Math.min(120, max);
  if (nudge <= 0) return;

  // Trigger lazy-load listeners that rely on real scroll deltas.
  setTop(root, nudge);
  window.scrollBy(0, nudge);
}

function triggerVirtualScrollUp(
  root: HTMLElement,
  messageNodes: Element[] = [],
  interactionRoot: HTMLElement | null = null,
): void {
  const targets = messageNodes.length > 0 ? messageNodes : getCandidateConversationMessageNodes();
  const resolvedInteractionRoot = interactionRoot ?? getInteractionRootFromMessages(targets);
  const target = (targets[0] as HTMLElement | undefined) ?? resolvedInteractionRoot ?? root;
  const dispatchTargets = [target, resolvedInteractionRoot, root, document.body, document.documentElement]
    .filter((el): el is HTMLElement => el instanceof HTMLElement);
  const eventInit: WheelEventInit = {
    deltaY: -1100,
    bubbles: true,
    cancelable: true,
  };

  try {
    for (const el of dispatchTargets) {
      el.dispatchEvent(new WheelEvent('wheel', eventInit));
    }
    window.dispatchEvent(new WheelEvent('wheel', eventInit));
  } catch {
    // Ignore unsupported synthetic wheel dispatch in some environments.
  }

  try {
    const keyInit: KeyboardEventInit = {
      key: 'PageUp',
      code: 'PageUp',
      bubbles: true,
      cancelable: true,
    };
    dispatchTargets[0]?.dispatchEvent(new KeyboardEvent('keydown', keyInit));
    window.dispatchEvent(new KeyboardEvent('keydown', keyInit));
  } catch {
    // Ignore keyboard dispatch errors.
  }

  debugLog('virtual-scroll-up-dispatched', {
    targetTag: target.tagName,
    targetClass: target.className,
    interactionTag: resolvedInteractionRoot?.tagName ?? '',
    interactionClass: resolvedInteractionRoot?.className ?? '',
    targetCount: targets.length,
  });
}

function messageSignature(msg: ChatMessage): string {
  const text = msg.content.replace(/\s+/g, ' ').trim();
  const imageSig = msg.images.map((img) => `${img.length}:${img.slice(0, 24)}`).join('|');
  return `${msg.role}::${text}::${imageSig}`;
}

function isSequenceIncluded(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return true;
  if (needle.length > haystack.length) return false;

  for (let start = 0; start <= haystack.length - needle.length; start++) {
    let matched = true;
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }

  return false;
}

function suffixPrefixOverlap(left: string[], right: string[]): number {
  const max = Math.min(left.length, right.length, 100);
  for (let size = max; size >= 1; size--) {
    let matched = true;
    for (let i = 0; i < size; i++) {
      if (left[left.length - size + i] !== right[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return size;
  }
  return 0;
}

function mergeByOccurrenceFallback(
  base: ChatMessage[],
  incoming: ChatMessage[],
  direction: 'up' | 'down',
): ChatMessage[] {
  if (base.length === 0) return [...incoming];
  if (incoming.length === 0) return base;
  // Prefer completeness over strict de-dup for unstable virtualized windows.
  return direction === 'up' ? incoming.concat(base) : base.concat(incoming);
}

function mergeMessageSnapshots(
  base: ChatMessage[],
  incoming: ChatMessage[],
  direction: 'up' | 'down',
): ChatMessage[] {
  if (base.length === 0) return [...incoming];
  if (incoming.length === 0) return base;

  const baseSig = base.map(messageSignature);
  const incomingSig = incoming.map(messageSignature);

  if (isSequenceIncluded(baseSig, incomingSig)) return base;
  if (isSequenceIncluded(incomingSig, baseSig)) return incoming;

  if (direction === 'up') {
    const overlap = suffixPrefixOverlap(incomingSig, baseSig);
    if (overlap > 0) {
      return incoming.slice(0, incoming.length - overlap).concat(base);
    }

    const reverseOverlap = suffixPrefixOverlap(baseSig, incomingSig);
    if (reverseOverlap > 0) {
      return base.concat(incoming.slice(reverseOverlap));
    }
  } else {
    const overlap = suffixPrefixOverlap(baseSig, incomingSig);
    if (overlap > 0) {
      return base.concat(incoming.slice(overlap));
    }

    const reverseOverlap = suffixPrefixOverlap(incomingSig, baseSig);
    if (reverseOverlap > 0) {
      return incoming.concat(base.slice(reverseOverlap));
    }
  }

  return mergeByOccurrenceFallback(base, incoming, direction);
}

async function collectMessagesByAutoScroll(
  onlySelected?: boolean,
  settings?: UserSettings,
  onStatus?: (text: string) => void,
): Promise<ChatMessage[]> {
  const { root, messageNodes, interactionRoot } = resolveConversationScrollContext();
  const maxScroll = () => Math.max(0, root.scrollHeight - root.clientHeight);
  const startedAt = Date.now();
  const maxDurationMs = 45_000;
  const parseOptions = resolveImageExtractionOptions(settings);
  const text = getConversationPreparationText(settings?.language);

  debugLog('collect-start', {
    rootTag: root.tagName,
    rootClass: root.className,
    max: maxScroll(),
    nodeCount: countMessageLikeNodes(),
    navLike: isNavLikeContainer(root),
    probeScrollable: canScrollByTopProbe(root),
  });

  const noNativeScrollableRange = maxScroll() <= 0;
  if (noNativeScrollableRange) {
    debugLog('collect-no-native-scroll-range', {
      rootTag: root.tagName,
      rootClass: root.className,
      max: maxScroll(),
    });
  }

  const settleAndCollect = async (
    base: ChatMessage[],
    direction: 'up' | 'down',
  ): Promise<ChatMessage[]> => {
    clickExpandButtons();
    let merged = mergeMessageSnapshots(base, await parseMessages(onlySelected, parseOptions), direction);

    // Give Gemini time to append newly loaded turns.
    for (let i = 0; i < 3; i++) {
      await sleep(180);
      clickExpandButtons();
      const next = mergeMessageSnapshots(merged, await parseMessages(onlySelected, parseOptions), direction);
      if (next.length === merged.length) break;
      merged = next;
    }

    return merged;
  };

  setTop(root, maxScroll());
  await sleep(260);

  let collected: ChatMessage[] = [];
  collected = await settleAndCollect(collected, 'down');

  debugLog('collect-tail-baseline', {
    collected: collected.length,
    startTop: root.scrollTop,
    max: maxScroll(),
  });

  // Phase 1: keep forcing top and wait for mutation until history no longer grows.
  let topStableRounds = 0;
  let lastHeight = -1;
  let lastVisibleHead = '';

  for (let step = 0; step < 24; step++) {
    if (Date.now() - startedAt > maxDurationMs) {
      debugLog('collect-stop-time-budget-top', { step, collected: collected.length });
      break;
    }

    onStatus?.(step < 20 ? text.loadingEarlier : text.finalizing);

    scrollToAbsoluteTop(root);
    if (noNativeScrollableRange) {
      triggerVirtualScrollUp(root, messageNodes, interactionRoot);
    }
    await sleep(120);

    const changed = await waitForDomMutation(520);
    clickExpandButtons();
    await sleep(120);

    collected = await settleAndCollect(collected, 'up');

    const currentHeight = root.scrollHeight;
    const visibleNow = await parseMessages(onlySelected, {
      ...parseOptions,
      includeImages: false,
    });
    const visibleHead = visibleNow.slice(0, 3).map(messageSignature).join('||');

    const progressed = changed || currentHeight > lastHeight || visibleHead !== lastVisibleHead;
    topStableRounds = progressed ? 0 : topStableRounds + 1;

    lastHeight = Math.max(lastHeight, currentHeight);
    lastVisibleHead = visibleHead;

    if (topStableRounds >= 2 && isNearTop(root)) {
      debugLog('top-phase-stable-stop', {
        step,
        topStableRounds,
        currentHeight,
        collected: collected.length,
      });
      break;
    }

    // Some pages only trigger loading on real scroll transitions.
    nudgeTopLoad(root, maxScroll());
    if (noNativeScrollableRange) {
      triggerVirtualScrollUp(root, messageNodes, interactionRoot);
    }
    await sleep(70);
    scrollToAbsoluteTop(root);
    await sleep(100);

    if (DEBUG_EXTRACTION && step % 6 === 0) {
      debugLog('top-phase-progress', {
        step,
        top: root.scrollTop,
        max: maxScroll(),
        height: root.scrollHeight,
        collected: collected.length,
      });
    }
  }

  debugLog('collect-skip-down-phase', {
    reason: noNativeScrollableRange ? 'no-native-range' : 'one-way-up-optimized',
    collected: collected.length,
  });

  // Return to top so user page context is unchanged after export.
  onStatus?.(text.finalizing);
  scrollToAbsoluteTop(root);
  await sleep(120);

  debugLog('collect-finish', {
    collected: collected.length,
    finalMax: maxScroll(),
    finalTop: root.scrollTop,
  });

  if (collected.length === 0) {
    return parseMessages(onlySelected, parseOptions);
  }
  return collected;
}

async function warmUpConversationContent(onProgress?: () => void): Promise<void> {
  const maxRounds = 6;
  const settleDelayMs = 160;
  const minimumRoundsBeforeEarlyExit = 2;
  let previousCount = -1;
  let stableRounds = 0;

  for (let i = 0; i < maxRounds; i++) {
    onProgress?.();
    clickExpandButtons();
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(settleDelayMs);
    window.scrollTo(0, 0);
    await sleep(settleDelayMs);

    const currentCount = countMessageLikeNodes();
    if (currentCount === previousCount) {
      stableRounds++;
      if (i >= minimumRoundsBeforeEarlyExit && stableRounds >= 2) break;
    } else {
      stableRounds = 0;
    }
    previousCount = currentCount;
  }
}

function getMessageNodeSignature(nodes: Element[]): string {
  return nodes
    .slice(0, 4)
    .map((node) => ((node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)))
    .join('||') + `::${nodes.length}`;
}

async function loadSelectableMessageNodes(
  root: HTMLElement,
  preferredLanguage?: string,
  onStatus?: (text: string) => void,
): Promise<Element[]> {
  const text = getSelectionPreparationText(preferredLanguage);
  let bestNodes: Element[] = [];
  let lastSignature = '';
  let stableRounds = 0;

  for (let i = 0; i < 6; i++) {
    onStatus?.(i < 4 ? text.loadingEarlier : text.finalizing);
    scrollToAbsoluteTop(root);
    if (Math.max(0, root.scrollHeight - root.clientHeight) <= 0) {
      triggerVirtualScrollUp(root);
    }

    await sleep(120);
    const changed = await waitForDomMutation(420);
    clickExpandButtons();
    await sleep(180);

    const nodes = getMessageNodes();
    if (nodes.length >= bestNodes.length) {
      bestNodes = nodes;
    }

    const signature = getMessageNodeSignature(nodes);
    if (nodes.length > 0 && signature === lastSignature && !changed) {
      stableRounds += 1;
      if (stableRounds >= 1) {
        return bestNodes;
      }
    } else {
      stableRounds = 0;
    }

    lastSignature = signature;
  }

  return bestNodes;
}

/** 提取当前页面的完整对话数据 */
async function extractCurrentChat(onlySelected?: boolean, settings?: UserSettings): Promise<ExtractCurrentChatResponse> {
  try {
    debugLog('extract-start', { href: window.location.href, onlySelected });
    const parseOptions = resolveImageExtractionOptions(settings);
    
    let messages: ChatMessage[];
    
    if (onlySelected) {
      // 当只需导出选中的消息时，不需要滚动或热身，直接解析当前页面的选中节点
      messages = await parseMessages(true, parseOptions);
    } else {
      const preparationText = getConversationPreparationText(settings?.language);
      const loadingOverlay = showSelectionPreparationOverlay(preparationText.preparingCurrent);

      try {
        loadingOverlay.update(preparationText.expanding);
        await waitForNextFrame();
        await warmUpConversationContent(() => loadingOverlay.update(preparationText.expanding));

        messages = await Promise.race([
          collectMessagesByAutoScroll(false, settings, (statusText) => loadingOverlay.update(statusText)),
          (async () => {
            await sleep(35000);
            loadingOverlay.update(preparationText.finalizing);
            return parseMessages(false, parseOptions);
          })(),
        ]);
      } finally {
        loadingOverlay.close();
      }
    }

    messages = reduceMessagePayload(messages);

    if (messages.length === 0) {
      debugLog('extract-no-messages');
      return { success: false, error: 'No messages found on this page' };
    }

    const session: ChatSession = {
      id: parseChatId(),
      title: parseTitle(),
      author: fetchAuthorName(),
      url: window.location.href,
      modelVersion: fetchModelVersion(),
      exportDate: Date.now(),
      messages,
    };

    debugLog('extract-success', {
      messageCount: messages.length,
      payloadBytes: estimateMessagesSizeBytes(messages),
      ...summarizeImageSources(messages),
    });
    return { success: true, data: session };
  } catch (e) {
    debugLog('extract-error', {
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown extraction error',
    };
  }
}

const CHAT_SELECTOR_ID = 'gemini-chat-exporter-selector';

function getModalText() {
  const lang = (navigator.language || '').toLowerCase();
  const zh = lang.startsWith('zh');
  return {
    title: zh ? '选择要导出的对话' : 'Select chats to export',
    selected: zh ? '已选择' : 'Selected',
    selectAll: zh ? '全选' : 'Select All',
    deselectAll: zh ? '取消全选' : 'Deselect All',
    confirm: zh ? '确认导出' : 'Confirm',
    cancel: zh ? '取消' : 'Cancel',
  };
}

function showChatSelectorModal(chats: ChatSessionSummary[]): Promise<ChatSessionSummary[] | null> {
  return new Promise((resolve) => {
    document.getElementById(CHAT_SELECTOR_ID)?.remove();
    const text = getModalText();

    const selected = new Set(chats.map((c) => c.id));

    const overlay = document.createElement('div');
    overlay.id = CHAT_SELECTOR_ID;
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(15,23,42,0.45)',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:20px',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'width:min(680px,96vw)',
      'max-height:84vh',
      'background:#ffffff',
      'border-radius:12px',
      'box-shadow:0 24px 60px rgba(0,0,0,0.25)',
      'display:flex',
      'flex-direction:column',
      'overflow:hidden',
      'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'color:#0f172a',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'padding:16px 18px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:12px;';

    const headerTitle = document.createElement('div');
    headerTitle.style.cssText = 'font-size:18px;font-weight:700;';
    headerTitle.textContent = text.title;

    const selectedCounter = document.createElement('div');
    selectedCounter.style.cssText = 'font-size:13px;font-weight:600;color:#334155;background:#e2e8f0;padding:4px 10px;border-radius:999px;white-space:nowrap;';

    header.appendChild(headerTitle);
    header.appendChild(selectedCounter);

    const controlBar = document.createElement('div');
    controlBar.style.cssText = 'padding:12px 18px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:10px;';

    const selectAllLabel = document.createElement('label');
    selectAllLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;cursor:pointer;';
    const selectAllInput = document.createElement('input');
    selectAllInput.type = 'checkbox';
    selectAllInput.checked = true;
    selectAllLabel.appendChild(selectAllInput);
    selectAllLabel.appendChild(document.createTextNode(text.selectAll));
    controlBar.appendChild(selectAllLabel);

    const list = document.createElement('div');
    list.style.cssText = 'padding:10px 18px;overflow:auto;max-height:46vh;display:flex;flex-direction:column;gap:8px;';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = text.confirm;
    confirmBtn.style.cssText = 'padding:10px 16px;border:none;border-radius:8px;background:#2563eb;color:white;font-size:14px;font-weight:700;cursor:pointer;';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = text.cancel;
    cancelBtn.style.cssText = 'padding:10px 16px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#334155;font-size:14px;font-weight:600;cursor:pointer;';

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:14px 18px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:10px;';
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    const updateConfirmState = () => {
      const hasSelected = selected.size > 0;
      confirmBtn.disabled = !hasSelected;
      confirmBtn.style.opacity = hasSelected ? '1' : '0.55';
      confirmBtn.style.cursor = hasSelected ? 'pointer' : 'not-allowed';
      selectAllInput.checked = selected.size === chats.length;
      selectedCounter.textContent = `${text.selected} ${selected.size} / ${chats.length}`;
    };

    chats.forEach((chat) => {
      const rowLabel = document.createElement('label');
      rowLabel.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;background:#f8fafc;';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      input.style.marginTop = '2px';

      const textWrap = document.createElement('div');
      textWrap.style.cssText = 'min-width:0;display:flex;flex-direction:column;gap:2px;';

      const title = document.createElement('div');
      title.textContent = chat.title || chat.id;
      title.style.cssText = 'font-size:14px;font-weight:600;color:#0f172a;word-break:break-word;';

      const url = document.createElement('div');
      url.textContent = chat.url;
      url.style.cssText = 'font-size:12px;color:#64748b;word-break:break-all;';

      textWrap.appendChild(title);
      textWrap.appendChild(url);
      rowLabel.appendChild(input);
      rowLabel.appendChild(textWrap);

      input.addEventListener('change', () => {
        if (input.checked) {
          selected.add(chat.id);
        } else {
          selected.delete(chat.id);
        }
        updateConfirmState();
      });

      list.appendChild(rowLabel);
    });

    selectAllInput.addEventListener('change', () => {
      const checked = selectAllInput.checked;
      const checkboxes = list.querySelectorAll('input[type="checkbox"]');
      selected.clear();
      checkboxes.forEach((node, idx) => {
        const checkbox = node as HTMLInputElement;
        checkbox.checked = checked;
        if (checked) selected.add(chats[idx].id);
      });
      updateConfirmState();
    });

    const close = (value: ChatSessionSummary[] | null) => {
      document.removeEventListener('keydown', onEscKeyDown);
      overlay.remove();
      resolve(value);
    };

    const onEscKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        evt.preventDefault();
        close(null);
      }
    };

    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (evt) => {
      if (evt.target === overlay) close(null);
    });
    confirmBtn.addEventListener('click', () => {
      if (selected.size === 0) return;
      const picked = chats.filter((chat) => selected.has(chat.id));
      close(picked);
    });

    panel.appendChild(header);
    panel.appendChild(controlBar);
    panel.appendChild(list);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onEscKeyDown);
    updateConfirmState();
  });
}

async function selectChatsForExport(): Promise<SelectChatsForExportResponse> {
  console.log('[GCE] selectChatsForExport start', {
    initialChatCount: parseChatList().length,
    href: window.location.href,
  });

  // 滚动侧边栏以加载所有聊天 (解决懒加载问题)
  const loadedChats = await scrollSidebarToLoadAllChats();
  console.log('[GCE] after scrollSidebarToLoadAllChats', {
    loadedChatCount: loadedChats.length,
  });

  if (loadedChats.length === 0) {
    console.error('[GCE] No chats found after scrolling');
    return { success: false, error: 'No chats found in sidebar after scrolling' };
  }

  const selectedChats = await showChatSelectorModal(loadedChats);
  if (!selectedChats) {
    return { success: false, cancelled: true, error: 'Selection cancelled' };
  }

  if (selectedChats.length === 0) {
    return { success: false, error: 'No chats selected' };
  }

  console.log('[GCE] selectChatsForExport complete', {
    selectedCount: selectedChats.length,
  });

  return { success: true, data: selectedChats };
}

/**
 * 滚动侧边栏到底部以加载所有聊天条目
 * 解决懒加载问题，确保获取完整的聊天列表
 */
async function scrollSidebarToLoadAllChats(): Promise<ChatSessionSummary[]> {
  const startedAt = Date.now();
  const maxDurationMs = 60_000;      // 增加总超时时间到 60秒
  const maxScrollAttempts = 150;     // 增加最大尝试次数
  const scrollStepMs = 400;          // 每次等待 400ms，让 React/Angular 和网络请求有足够时间响应

  console.log('[GCE] scroll start', {
    maxDurationMs,
    maxScrollAttempts,
    scrollStepMs,
  });

  const scrollTargets = findScrollableTargets();
  if (scrollTargets.length === 0) {
    console.error('[GCE] scroll error', { error: 'No potential sidebar containers found' });
    return parseChatList();
  }

  console.log('[GCE] found potential scroll targets', scrollTargets.length);

  let lastChatCount = parseChatList().length;
  let stableRounds = 0;
  let scrollAttempts = 0;

  for (let i = 0; i < maxScrollAttempts; i++) {
    if (Date.now() - startedAt > maxDurationMs) {
      console.log('[GCE] scroll timeout', {
        elapsedMs: Date.now() - startedAt,
        finalChatCount: parseChatList().length,
      });
      break;
    }

    // 尝试直接使用 scrollIntoView 让最近的几个对话元素滚动到底部
    // 对话列表常常采用无限滚动，滚动最后一个元素有时可以触发加载
    const chatLinks = Array.from(document.querySelectorAll('a[href*="/app/"], a[href*="/chat/"]'));
    if (chatLinks.length > 0) {
      try {
        const lastLink = chatLinks[chatLinks.length - 1];
        lastLink.scrollIntoView({ behavior: 'auto', block: 'end' });
      } catch(e) {}
    }

    //尝试滚动所有潜在的容器及其子容器
    for (const target of scrollTargets) {
      if (!target) continue;
      
      // 添加 wheel 事件分发，强制模拟物理鼠标滚轮
      try {
        target.dispatchEvent(new WheelEvent('wheel', { 
           deltaY: 1000, 
           bubbles: true 
        }));
      } catch (e) {}

      const targetScrollTop = target.scrollTop + 800;
      try {
        target.scrollTo({ top: targetScrollTop, behavior: 'auto' });
      } catch(e) {}
      
      // 强制设置
      if (target.scrollTop < targetScrollTop) {
        target.scrollTop = targetScrollTop;
      }
    }
    
    scrollAttempts++;

    // 等待 DOM/请求 更新
    await sleep(scrollStepMs);

    const currentChatCount = parseChatList().length;
    if (currentChatCount === lastChatCount) {
      stableRounds++;
      console.log('[GCE] scroll stable', {
        stableRounds,
        chatCount: currentChatCount,
      });
      // 将之前的 8 轮稳定判定提高到 15 轮 (大约 400ms * 15 = 6s)
      // 确保极早期的请求响应即使因为网络延迟较慢，也能有足够的充裕时间返回
      if (stableRounds >= 15) {
        console.log('[GCE] scroll complete - stable');
        break;
      }
    } else {
      console.log('[GCE] scroll loaded more chats', {
        previousCount: lastChatCount,
        newCount: currentChatCount,
      });
      stableRounds = 0;
      lastChatCount = currentChatCount;
    }
  }

  const finalChats = parseChatList();
  console.log('[GCE] scroll complete', {
    scrollAttempts,
    elapsedMs: Date.now() - startedAt,
    finalChatCount: finalChats.length,
  });

  return finalChats;
}

/**
 * 查找所有可能需要滚动的侧边栏容器
 */
function findScrollableTargets(): HTMLElement[] {
  console.log('[GCE] finding scrollable targets...');
  const targets = new Set<HTMLElement>();

  // 1. 显式指定的 Gemini 侧边栏及内部列表容器
  const explicitSelectors = [
    '.sidenav-with-history-container',
    '.chat-history-list',
    'conversations-list',
    'bot-list',
    'side-navigation-content',
    'bard-sidenav-container'
  ];
  
  for (const selector of explicitSelectors) {
    const els = document.querySelectorAll<HTMLElement>(selector);
    els.forEach(el => targets.add(el));
  }

  // 2. 查找包含最多聊天链接的未知容器
  const allDivs = Array.from(document.querySelectorAll<HTMLElement>('div'));
  let containerWithMostChats: HTMLElement | null = null;
  let maxChatLinks = 0;

  for (const el of allDivs) {
    const chatLinks = el.querySelectorAll('a[href*="/app/"], a[href*="/chat/"]');
    if (chatLinks.length > maxChatLinks) {
      maxChatLinks = chatLinks.length;
      containerWithMostChats = el;
    }
  }

  if (containerWithMostChats) {
    targets.add(containerWithMostChats);
    // 加入子元素，因为由于滚动条限制，子元素才可能真正负责滚动
    const children = containerWithMostChats.querySelectorAll<HTMLElement>('*');
    for (const child of Array.from(children)) {
      if (child.tagName === 'DIV' || child.tagName === 'UL') {
        targets.add(child);
      }
    }
    // 加入它的父级元素（向上4层），可能包装它的容器才是负责滚动的
    let p = containerWithMostChats.parentElement;
    for(let i = 0; i < 4 && p; i++) {
        targets.add(p);
        p = p.parentElement;
    }
  }

  return Array.from(targets);
}

/** 删除 Gemini web 上的聊天条目 */
async function deleteChatFromWeb(chatId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // 从侧边栏找到对应的聊天条目
    const chats = parseChatList();
    const targetChat = chats.find((c) => c.id === chatId);
    if (!targetChat) {
      return { success: false, error: `Chat ${chatId} not found in sidebar` };
    }

    // 查找对应的 DOM 元素（链接或条目）
    let chatElement: HTMLElement | null = null;
    const selectors = [
      `a[href*="/app/${chatId}"]`,
      `a[href*="/chat/${chatId}"]`,
      `[data-conversation-id="${chatId}"]`,
      `[data-chat-id="${chatId}"]`,
    ];

    for (const sel of selectors) {
      chatElement = document.querySelector(sel) as HTMLElement | null;
      if (chatElement) break;
    }

    if (!chatElement) {
      return { success: false, error: `Cannot find chat element for ${chatId}` };
    }

    // 尝试找到母元素（包含删除按钮）
    let container = chatElement;
    for (let i = 0; i < 5; i++) {
      if (!container.parentElement) break;
      container = container.parentElement;

      // 查找删除按钮（通常是在悬停时显示的按钮）
      const deleteBtn = container.querySelector(
        'button[aria-label*="Delete"], button[aria-label*="delete"], ' +
        'button[title*="Delete"], button[title*="delete"], ' +
        '[role="button"][aria-label*="delete"]'
      ) as HTMLElement | null;

      if (deleteBtn) {
        deleteBtn.click();
        // 等待确认对话
        await sleep(500);
        // 查找确认按钮
        const confirmBtn = document.querySelector(
          'button:contains("Delete"), button[aria-label*="confirm"], ' +
          '[role="button"][aria-label*="confirm delete"]'
        ) as HTMLElement | null;
        if (confirmBtn) {
          confirmBtn.click();
          await sleep(500);
          return { success: true };
        }
        // 如果没有找到确认按钮，但删除按钮已经点击，可能是一步完成
        return { success: true };
      }
    }

    // 如果找不到删除按钮，尝试右键菜单方式
    const contextMenu = await tryContextMenuDelete(chatElement);
    if (contextMenu) {
      return { success: true };
    }

    return { success: false, error: 'Cannot find delete button for chat' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** 尝试通过右键菜单删除聊天 */
async function tryContextMenuDelete(element: HTMLElement): Promise<boolean> {
  try {
    // 创建右键点击事件
    const contextEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    element.dispatchEvent(contextEvent);
    await sleep(300);

    // 查找并点击上下文菜单中的删除选项
    const menuItems = document.querySelectorAll('[role="menuitem"], [role="button"]');
    for (const item of menuItems) {
      const text = (item.textContent || '').toLowerCase();
      if (text.includes('delete') || text.includes('trash') || text.includes('remove')) {
        (item as HTMLElement).click();
        await sleep(500);

        // 查找并点击确认按钮
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(
          (btn) =>
            (btn.textContent || '').toLowerCase().includes('delete') ||
            (btn.textContent || '').toLowerCase().includes('confirm')
        ) as HTMLElement | null;

        if (confirmBtn) {
          confirmBtn.click();
          await sleep(500);
        }
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/** 在 content script (DOM 环境) 中将 HTML 渲染为 PDF base64 */
async function renderHtmlToPdf(html: string): Promise<{ success: boolean; pdfBase64?: string; error?: string }> {
  try {
    // Render in extension-owned hidden page to avoid host-page CSP issues.
    const g = globalThis as unknown as {
      chrome?: { runtime?: { getURL?: (p: string) => string } };
      browser?: { runtime?: { getURL?: (p: string) => string } };
    };
    const getURL = g.chrome?.runtime?.getURL ?? g.browser?.runtime?.getURL;
    if (!getURL) {
      return { success: false, error: 'runtime.getURL not available' };
    }

    const rendererUrl = getURL('pdf-renderer.html');

    const pdfBase64 = await new Promise<string>((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:1px;height:1px;border:none;opacity:0;pointer-events:none;';
      document.body.appendChild(iframe);

      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        if (timer) window.clearTimeout(timer);
        iframe.remove();
      };

      const onMessage = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data as { type?: string; success?: boolean; pdfBase64?: string; error?: string };
        if (data?.type !== 'GCE_PDF_RESULT') return;

        if (data.success && data.pdfBase64 && data.pdfBase64.length > 3000) {
          cleanup();
          resolve(data.pdfBase64);
        } else {
          cleanup();
          reject(new Error(data.error || 'Generated PDF is empty or invalid'));
        }
      };

      window.addEventListener('message', onMessage);

      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('Hidden PDF renderer timed out'));
      }, 30000);

      iframe.onload = async () => {
        try {
          iframe.contentWindow?.postMessage({ type: 'GCE_RENDER_HTML_TO_PDF', html }, '*');
        } catch (err) {
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };

      iframe.src = rendererUrl;
    });

    return { success: true, pdfBase64 };
  } catch (e) {
    console.error('[Gemini Chat Exporter] PDF render error:', e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// 监听来自 Background / Popup 的消息（幂等保护，避免重复注入注册多个监听器）
const gceGlobal = globalThis as unknown as { __GCE_CONTENT_LISTENER_READY__?: boolean };
if (!gceGlobal.__GCE_CONTENT_LISTENER_READY__) {
  gceGlobal.__GCE_CONTENT_LISTENER_READY__ = true;
  getRuntime().onMessage.addListener(
    (message: unknown) => {
      const msg = message as { action?: string };
      switch (msg.action) {
        case 'PING': {
          return Promise.resolve({ success: true, source: 'content' });
        }
        case 'SELECT_MESSAGES_FOR_EXPORT': {
          return selectMessagesForExport(msg);
        }
        case 'EXTRACT_CURRENT_CHAT': {
          const { settings } = msg as { settings?: UserSettings };
          return extractCurrentChat(false, settings);
        }
        case 'RENDER_HTML_TO_PDF': {
          const { html } = msg as unknown as { html: string };
          return renderHtmlToPdf(html);
        }
        case 'EXTRACT_GEMINI_CHAT_HTML': {
          const { theme, settings, mode } = msg as {
            theme?: string;
            settings?: import('@/types/models').UserSettings;
            mode?: 'export-pdf' | 'cache-only';
          };
            return extractGeminiChat(theme, settings, mode ?? 'export-pdf');
        }
        case 'EXTRACT_CHAT_LIST': {
          return scrollSidebarToLoadAllChats().then(chatList => ({ success: true, data: chatList }));
        }
        case 'SELECT_CHATS_FOR_EXPORT': {
          return selectChatsForExport();
        }
        case 'DELETE_CHAT_FROM_WEB': {
          const { chatId } = message as { chatId?: string };
          if (!chatId) {
            return Promise.resolve({ success: false, error: 'Missing chatId' });
          }
          return deleteChatFromWeb(chatId);
        }
        default:
          return;
      }
    }
  );

  console.log('[Gemini Chat Exporter] Content script loaded');
}
async function selectMessagesForExport(req: any): Promise<import('@/types/messages').SelectMessagesForExportResponse> {
  const preparationText = getSelectionPreparationText(req?.settings?.language);
  const loadingOverlay = showSelectionPreparationOverlay(preparationText.preparing);

  let nodes: Element[] = [];
  try {
    loadingOverlay.update(preparationText.expanding);
    await waitForNextFrame();
    await warmUpConversationContent(() => loadingOverlay.update(preparationText.expanding));
    clickExpandButtons();

    const { root: conversationRoot } = resolveConversationScrollContext();
    nodes = await loadSelectableMessageNodes(
      conversationRoot,
      req?.settings?.language,
      (statusText) => loadingOverlay.update(statusText),
    );
  } finally {
    loadingOverlay.close();
  }

  if (nodes.length === 0) {
    return { success: false, error: 'No selectable messages found' };
  }

  return new Promise((resolve) => {
    const isZh = isZhLanguage(req?.settings?.language);
    const panelText = {
      selected: isZh ? '已框选' : 'Selected',
      selectAll: isZh ? '全选' : 'Select All',
      deselectAll: isZh ? '取消全选' : 'Deselect All',
      confirm: isZh ? '导出所选内容' : 'Export Selection',
      cancel: isZh ? '取消' : 'Cancel',
    };

    const setNodeSelectedState = (el: HTMLElement, selected: boolean) => {
      const checkmark = el.querySelector('.gce-checkmark') as HTMLElement | null;
      if (selected) {
        el.classList.add('gce-message-selected');
        el.style.outline = '2px solid rgba(26,115,232,0.9)';
        el.style.outlineOffset = '4px';
        el.style.boxShadow = '0 8px 20px rgba(26,115,232,0.14)';
        if (checkmark) {
          checkmark.textContent = '✔';
          checkmark.style.borderColor = 'rgba(26,115,232,0.22)';
          checkmark.style.background = 'rgba(255,255,255,0.96)';
          checkmark.style.color = '#1a73e8';
        }
      } else {
        el.classList.remove('gce-message-selected');
        el.style.outline = 'none';
        el.style.outlineOffset = '';
        el.style.boxShadow = '';
        if (checkmark) {
          checkmark.textContent = '';
          checkmark.style.borderColor = 'rgba(148,163,184,0.35)';
          checkmark.style.background = 'rgba(255,255,255,0.88)';
          checkmark.style.color = '#94a3b8';
        }
      }
    };

    const updateFloatingPanel = () => {
      const selectedCount = document.querySelectorAll('.gce-message-selected').length;
      countText.textContent = `${panelText.selected} ${selectedCount}`;
      confirmBtn.disabled = selectedCount === 0;
      confirmBtn.style.opacity = selectedCount === 0 ? '0.5' : '1';
      toggleAllBtn.textContent = selectedCount === nodes.length ? panelText.deselectAll : panelText.selectAll;
    };

    for (const node of nodes) {
      const el = node as HTMLElement;
      el.style.position = 'relative';
      el.classList.add('gce-selectable-message');
      el.classList.add('gce-message-selected');
      el.style.outline = '2px solid rgba(26,115,232,0.9)';
      el.style.outlineOffset = '4px';
      el.style.boxShadow = '0 8px 20px rgba(26,115,232,0.14)';
      
      const checkmark = document.createElement('div');
      checkmark.className = 'gce-checkmark';
      checkmark.style.cssText = 'position:absolute; top: 12px; right: 12px; width: 30px; height: 30px; border: 1px solid rgba(26,115,232,0.22); border-radius: 999px; background: rgba(255,255,255,0.96); color: #1a73e8; z-index: 10; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 8px 18px rgba(15,23,42,0.14); transition: all 0.2s ease;';
      checkmark.textContent = '✔';
      
      el.appendChild(checkmark);

      const toggle = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const isSelected = el.classList.contains('gce-message-selected');
        setNodeSelectedState(el, !isSelected);
        updateFloatingPanel();
      };
      checkmark.addEventListener('click', toggle);
    }

    const panel = document.createElement('div');
    panel.id = 'gce-selection-panel';
  panel.style.cssText = 'position:fixed; width:auto; max-width:min(600px,calc(100vw - 24px)); left:50%; transform:translateX(-50%); bottom:24px; border-radius:50px; padding:12px 24px; background:rgba(255,255,255,0.95); border:1px solid rgba(226,232,240,0.95); box-shadow:0 4px 16px rgba(0,0,0,0.2); backdrop-filter:blur(14px); display:flex; gap:12px; align-items:center; z-index:2147483647; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';
    
    const countText = document.createElement('span');
  countText.style.cssText = 'font-weight:700;color:#0f172a;background:#eff6ff;border:1px solid #bfdbfe;padding:8px 12px;border-radius:999px;white-space:nowrap;';

    const toggleAllBtn = document.createElement('button');
  toggleAllBtn.type = 'button';
  toggleAllBtn.style.cssText = 'background:#fff; color:#1d4ed8; border:1px solid #bfdbfe; padding:10px 16px; border-radius:999px; cursor:pointer; font-weight:700;';
    
    const confirmBtn = document.createElement('button');
  confirmBtn.textContent = panelText.confirm;
  confirmBtn.style.cssText = 'background:linear-gradient(135deg,#1a73e8 0%,#1558d6 100%); color:#fff; border:none; padding:10px 18px; border-radius:999px; cursor:pointer; font-weight:800; box-shadow:0 10px 20px rgba(26,115,232,0.24);';
    
    const cancelBtn = document.createElement('button');
  cancelBtn.textContent = panelText.cancel;
  cancelBtn.style.cssText = 'background:#fff; color:#475569; border:1px solid #cbd5e1; padding:10px 16px; border-radius:999px; cursor:pointer; font-weight:700;';
    
    panel.appendChild(countText);
    panel.appendChild(toggleAllBtn);
    panel.appendChild(confirmBtn);
    panel.appendChild(cancelBtn);
    document.body.appendChild(panel);

    updateFloatingPanel();

    const cleanup = () => {
      panel.remove();
      for (const node of nodes) {
        const el = node as HTMLElement;
        el.classList.remove('gce-selectable-message');
        el.classList.remove('gce-message-selected');
        el.style.outline = '';
        el.style.outlineOffset = '';
        el.style.boxShadow = '';
        const cm = el.querySelector('.gce-checkmark');
        if (cm) cm.remove();
      }
    };

    cancelBtn.onclick = () => {
      cleanup();
      resolve({ success: false, cancelled: true });
    };

    toggleAllBtn.onclick = () => {
      const shouldSelectAll = document.querySelectorAll('.gce-message-selected').length !== nodes.length;
      for (const node of nodes) {
        setNodeSelectedState(node as HTMLElement, shouldSelectAll);
      }
      updateFloatingPanel();
    };

    confirmBtn.onclick = async () => {
      // Don't cleanup the classes before extraction, because the extractor needs the classes!
      panel.remove(); // Just hide the panel for now
      
      // Extract only selected!
      const data = await extractCurrentChat(true, req.settings);
      
      // Now cleanup classes
      cleanup();
      
      if (data.success && data.data) {
        try {
          const selectedFormat = req.format || 'markdown';

          if (req.outputMode === 'clipboard') {
            resolve({ success: true, data: data.data });
            return;
          }

          // Selected-message PDF follows the same themed ghost pipeline as current-chat PDF export.
          if (selectedFormat === 'pdf') {
            const theme = normalizeExportTheme(req.theme);
            const userLabel = resolveUserLabel(req.settings, data.data.author);
            const includeImages = shouldExportUserInputImages(req.settings);
            const exportMessages = sanitizeMessagesForImageExport(data.data.messages, includeImages);

            const browserApi = getBrowserApi();
            const standardHtml = buildStandardChatHtml(exportMessages, {
              title: data.data.title,
              userLabel,
              includeImages,
            });

            if (browserApi.runtime?.sendMessage) {
              const exportResult = await browserApi.runtime.sendMessage({
                action: 'exportPdf',
                theme,
                html: standardHtml,
                title: data.data.title,
                filename: buildFilename(data.data.title, 'pdf'),
              });

              if ((exportResult as { success?: boolean; error?: string } | undefined)?.success === false) {
                throw new Error((exportResult as { error?: string }).error || 'Failed to export selected PDF');
              }
            }
          } else {
            // Non-PDF keeps the existing task-manager export path.
            const exportResult = await browser.runtime.sendMessage({
              action: 'EXPORT_SESSION',
              session: data.data,
              format: selectedFormat,
              settings: req.settings,
            }) as { success?: boolean; error?: string } | undefined;

            if (!exportResult?.success) {
              throw new Error(exportResult?.error || 'Failed to start selected export');
            }
          }
        } catch (e) {
          console.error('[Gemini Chat Exporter] Failed to send EXPORT_SESSION', e);
          resolve({ success: false, error: e instanceof Error ? e.message : String(e) });
          return;
        }
        resolve({ success: true });
        return;
      }
      resolve({ success: false, error: data.error || 'Failed to extract selected messages' });
    };
  });
}

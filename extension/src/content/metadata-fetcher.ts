// src/content/metadata-fetcher.ts — 页面元数据抓取

function normalizeAccountLabel(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function extractNameFromAccountLabel(label: string | null | undefined): string | null {
  if (!label) return null;

  const normalized = normalizeAccountLabel(label);
  const patterns = [
    /Google\s+(?:Account|帐号)\s*[:：]\s*(.+?)(?:\s*[(\uff08]|$)/i,
    /Google\s+(?:Account|帐号)\s+for\s+(.+?)(?:\s*[(\uff08]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) return candidate;
  }

  return null;
}

function isPlausibleDisplayName(value: string | null | undefined): value is string {
  const text = (value ?? '').trim();
  if (!text) return false;
  if (text.length > 80) return false;
  if (/^google\s+(?:account|帐号)/i.test(text)) return false;
  if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(text)) return false;
  return true;
}

function extractNameFromElement(el: Element | null): string | null {
  if (!el) return null;

  const ariaCandidates = [
    el,
    el.closest('[aria-label]'),
    el.querySelector('[aria-label]'),
    el.querySelector('a[aria-label*="Google Account"], a[aria-label*="Google 帐号"], [role="button"][aria-label*="Google Account"], [role="button"][aria-label*="Google 帐号"]'),
  ];

  for (const candidate of ariaCandidates) {
    if (!candidate) continue;
    const name = extractNameFromAccountLabel((candidate as Element).getAttribute('aria-label'));
    if (name) return name;
  }

  const img = el.matches('img[alt]')
    ? el as HTMLImageElement
    : el.querySelector('img[alt]');
  const alt = img?.getAttribute('alt')?.trim();
  if (isPlausibleDisplayName(alt)) return alt;

  const textContent = normalizeAccountLabel(el.textContent);
  if (isPlausibleDisplayName(textContent)) return textContent;

  return null;
}

/** 提取当前登录用户的显示名称 */
export function fetchAuthorName(): string {
  // 策略1: 遍历 Google 账号入口相关元素，优先从 aria-label 中解析真实用户名。
  const accountSelectors = [
    'a[aria-label*="Google Account"]',
    'a[aria-label*="Google 帐号"]',
    '[role="button"][aria-label*="Google Account"]',
    '[role="button"][aria-label*="Google 帐号"]',
    '[data-ogsr-up]',
  ];

  const accountCandidates = document.querySelectorAll(accountSelectors.join(', '));
  for (const candidate of accountCandidates) {
    const name = extractNameFromElement(candidate);
    if (name) return name;
  }

  // 策略2: 兜底遍历所有带 aria-label 的元素，防止 Google 改版后 DOM 层级变化。
  const labeledNodes = document.querySelectorAll('[aria-label*="Google Account"], [aria-label*="Google 帐号"]');
  for (const candidate of labeledNodes) {
    const name = extractNameFromElement(candidate);
    if (name) return name;
  }

  // 策略3: 从头像 img 的 alt 属性
  const avatarImg = document.querySelector(
    'img.gb_q, img.gb_Q, img[data-noaft], header img[alt]'
  );
  if (avatarImg) {
    const alt = avatarImg.getAttribute('alt')?.trim();
    if (isPlausibleDisplayName(alt)) return alt;
  }

  // 策略4: 从页面 meta 标签
  const metaAuthor = document.querySelector('meta[name="author"]');
  if (metaAuthor) {
    const content = metaAuthor.getAttribute('content')?.trim();
    if (isPlausibleDisplayName(content)) return content;
  }

  return 'Unknown User';
}

/** 提取 Gemini 模型版本 */
export function fetchModelVersion(): string | undefined {
  // 从页面中查找模型标识
  const modelEl = document.querySelector(
    '[data-model-id], .model-selector .selected, .model-badge'
  );
  if (modelEl?.textContent?.trim()) {
    return modelEl.textContent.trim();
  }

  // 从下拉菜单提取
  const dropdownText = document.querySelector(
    'button[aria-haspopup] span, .model-picker'
  )?.textContent?.trim();
  if (dropdownText && /gemini/i.test(dropdownText)) {
    return dropdownText;
  }

  return undefined;
}

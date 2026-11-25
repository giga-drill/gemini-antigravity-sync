import type { ChatMessage } from '@/types/models';

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDocumentHeaderHtml(title?: string): string {
  const resolvedTitle = (title || 'Gemini Chat Export').trim() || 'Gemini Chat Export';
  return `
    <header class="doc-header">
      <div class="doc-icon">💬</div>
      <h1 class="doc-title">${escapeHtml(resolvedTitle)}</h1>
    </header>
  `;
}

function renderTextBlockHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '<p></p>';

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function renderAttachmentGalleryHtml(images: string[]): string {
  if (images.length === 0) return '';

  const items = images
    .map((src, index) => `
      <figure class="message-attachment">
        <div class="message-attachment__badge">Attachment ${index + 1}</div>
        <img class="message-attachment__image" src="${escapeHtml(src)}" alt="chat attachment ${index + 1}" loading="eager" decoding="async" referrerpolicy="no-referrer" crossorigin="anonymous" />
      </figure>
    `)
    .join('');

  return `<div class="message-attachments">${items}</div>`;
}

function renderMessageBodyHtml(message: ChatMessage, includeImages = true): string {
  const contentHtml = typeof message.contentHtml === 'string' && message.contentHtml.trim()
    ? message.contentHtml.trim()
    : renderTextBlockHtml(message.content || '');
  const imagesHtml = includeImages && message.role === 'user'
    ? renderAttachmentGalleryHtml(message.images || [])
    : '';

  return `${contentHtml}${imagesHtml}`;
}

export function buildStandardChatHtml(
  messages: ChatMessage[],
  options?: { title?: string; userLabel?: string; includeImages?: boolean },
): string {
  const turns = messages
    .map((msg) => {
      const roleClass = msg.role === 'user' ? 'role-user' : 'role-ai';
      const avatarText = msg.role === 'user' ? (options?.userLabel || 'You') : 'Gemini';
      const contentHtml = renderMessageBodyHtml(msg, options?.includeImages !== false);

      return `
        <div class="chat-turn ${roleClass}">
          <div class="turn-avatar">${escapeHtml(avatarText)}</div>
          <div class="turn-content">${contentHtml}</div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="chat-document">
      ${buildDocumentHeaderHtml(options?.title)}
      ${turns}
    </div>
  `.trim();
}
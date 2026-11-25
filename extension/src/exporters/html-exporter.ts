// src/exporters/html-exporter.ts — HTML 格式导出器

import type { IExporter } from './types';
import type { ChatSession, UserSettings, ChatMessage } from '@/types/models';
import { shouldExportUserInputImages } from '@/types/models';

interface HtmlExporterOptions {
  preferPlainText?: boolean;
}

export class HtmlExporter implements IExporter {
  constructor(private readonly options: HtmlExporterOptions = {}) {}

  private resolveUserLabel(session: ChatSession, settings: UserSettings): string {
    if (settings.userLabelMode === 'account-name') {
      const name = (session.author || '').trim();
      if (name && name !== 'Unknown User') return name;
    }
    return 'You';
  }

  async export(session: ChatSession, settings: UserSettings): Promise<Blob> {
    const parts: string[] = [];
    const userLabel = this.resolveUserLabel(session, settings);

    parts.push('<!DOCTYPE html>');
    parts.push('<html lang="en">');
    parts.push('<head>');
    parts.push('  <meta charset="UTF-8">');
    parts.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
    parts.push(`  <title>${this.escapeHtml(session.title)}</title>`);
    parts.push('  <style>');
    parts.push(`
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.7; color: #1a1a1a; max-width: 800px; margin: 0 auto; padding: 20px; font-size: 15px; }
    h1 { color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px; }
    .meta { color: #666; font-size: 0.9em; margin-bottom: 30px; background: #f9f9f9; padding: 15px; border-radius: 8px; }
    .message { margin-bottom: 24px; padding: 18px 20px; border-radius: 8px; }
    .message.user { background: #e3f2fd; margin-left: 20px; border-left: 4px solid #2196f3; }
    .message.model { background: #f8f9fa; margin-right: 20px; border-left: 4px solid #4caf50; }
    .role { font-weight: bold; margin-bottom: 12px; color: #555; font-size: 14px; }
    .content { }
    .content div { margin: 0; padding: 0; }
    .content p { margin: 0 0 12px 0; }
    .content p:last-child { margin-bottom: 0; }
    .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
      margin: 20px 0 10px 0; font-weight: 700; line-height: 1.3;
    }
    .content h1 { font-size: 1.6em; }
    .content h2 { font-size: 1.4em; }
    .content h3 { font-size: 1.2em; }
    .content h4 { font-size: 1.1em; }
    .content strong, .content b { font-weight: 700; }
    .content em, .content i { font-style: italic; }
    .content ul, .content ol { margin: 8px 0 12px 0; padding-left: 24px; }
    .content li { margin-bottom: 6px; line-height: 1.6; }
    .content li > ul, .content li > ol { margin-top: 4px; margin-bottom: 4px; }
    .content blockquote {
      margin: 12px 0; padding: 10px 16px; border-left: 4px solid #ddd;
      background: #f6f8fa; color: #555; font-style: italic;
    }
    .content pre {
      background: #1e1e1e; color: #d4d4d4; padding: 14px 16px; border-radius: 6px;
      overflow-x: auto; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 13px; line-height: 1.5; margin: 12px 0;
    }
    .content code {
      background: #e8eaed; padding: 2px 6px; border-radius: 4px;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 0.9em;
    }
    .content pre code { background: transparent; padding: 0; border-radius: 0; font-size: inherit; }
    .content table { border-collapse: collapse; margin: 12px 0; width: 100%; }
    .content th, .content td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    .content th { background: #f2f2f2; font-weight: 600; }
    .content a { color: #1a73e8; text-decoration: none; }
    .content a:hover { text-decoration: underline; }
    .content hr { border: none; border-top: 1px solid #e0e0e0; margin: 16px 0; }
    img { max-width: 100%; border-radius: 4px; margin-top: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    `);
    parts.push('  </style>');
    parts.push('</head>');
    parts.push('<body>');

    parts.push('  <div class="chat-container">');

    for (const msg of session.messages) {
      parts.push(this.renderMessage({
        ...msg,
        images: shouldExportUserInputImages(settings) && msg.role === 'user' ? (msg.images || []) : [],
      }, userLabel));
    }

    parts.push('  </div>');
    parts.push('</body>');
    parts.push('</html>');

    const content = parts.join('\n');
    return new Blob([content], { type: 'text/html;charset=utf-8' });
  }

  private renderMessage(msg: ChatMessage, userLabel: string): string {
    const lines: string[] = [];
    const roleClass = msg.role === 'user' ? 'user' : 'model';
    const label = msg.role === 'user' ? `🧑 ${this.escapeHtml(userLabel)}` : '🤖 Gemini';

    lines.push(`    <div class="message ${roleClass}">`);
    lines.push(`      <div class="role">${label}</div>`);
    
    if (msg.contentHtml && !this.options.preferPlainText) {
      // Use original DOM HTML — preserves headings, lists, bold, code blocks, etc.
      lines.push(`      <div class="content">${msg.contentHtml}</div>`);
    } else if (msg.content) {
      // Stable fallback: escaped plain text
      const content = this.escapeHtml(this.normalizeText(msg.content));
      lines.push(`      <div class="content" style="white-space:pre-wrap">${content}</div>`);
    }

    if (msg.images && msg.images.length > 0) {
      lines.push('      <div class="images">');
      for (const img of msg.images) {
        lines.push(`        <img src="${img}" alt="conversation image" />`);
      }
      lines.push('      </div>');
    }

    lines.push('    </div>');

    return lines.join('\n');
  }

  escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private normalizeText(str: string): string {
    return str
      .replace(/\r\n?/g, '\n')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/[\t\f\v ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([\u4E00-\u9FFF])\s+([\u4E00-\u9FFF])/g, '$1$2')
      .trim();
  }
}

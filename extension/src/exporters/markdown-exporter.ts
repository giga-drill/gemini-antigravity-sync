// src/exporters/markdown-exporter.ts — Markdown 格式导出器

import type { IExporter } from './types';
import type { ChatSession, UserSettings, ChatMessage } from '@/types/models';
import { shouldExportUserInputImages } from '@/types/models';

export class MarkdownExporter implements IExporter {
  async export(session: ChatSession, settings: UserSettings): Promise<Blob> {
    const parts: string[] = [];
    const userLabel = settings.userLabelMode === 'account-name' && session.author && session.author !== 'Unknown User'
      ? session.author
      : 'You';

    // FrontMatter 元数据
    parts.push('---');
    parts.push(`title: "${this.escapeYaml(session.title)}"`);
    parts.push(`author: "${this.escapeYaml(session.author)}"`);
    parts.push(`date: ${new Date(session.exportDate).toISOString()}`);
    parts.push(`url: ${session.url}`);
    if (session.modelVersion) {
      parts.push(`model: "${this.escapeYaml(session.modelVersion)}"`);
    }
    parts.push('---');
    parts.push('');

    // 逐条消息渲染
    for (const msg of session.messages) {
      parts.push(this.renderMessage({
        ...msg,
        images: shouldExportUserInputImages(settings) && msg.role === 'user' ? (msg.images || []) : [],
      }, userLabel));
      parts.push('');
    }

    const content = parts.join('\n');
    return new Blob([content], { type: 'text/markdown;charset=utf-8' });
  }

  private renderMessage(msg: ChatMessage, userLabel: string): string {
    const lines: string[] = [];
    const label = msg.role === 'user' ? `🧑 **${userLabel}**` : '🤖 **Gemini**';

    lines.push(`### ${label}`);
    lines.push('');

    if (msg.content) {
      lines.push(msg.content);
    }

    // 嵌入图片 (直接使用 Base64 data URL)
    for (const img of msg.images) {
      lines.push('');
      lines.push(`<img src="${img}" alt="conversation image" style="max-width:100%;" />`);
    }

    lines.push('');
    lines.push('---');

    return lines.join('\n');
  }

  private escapeYaml(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
  }
}

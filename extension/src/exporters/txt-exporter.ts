// src/exporters/txt-exporter.ts — 纯文本格式导出器

import type { IExporter } from './types';
import type { ChatSession, UserSettings, ChatMessage } from '@/types/models';
import { shouldExportUserInputImages } from '@/types/models';

export class TxtExporter implements IExporter {
  async export(session: ChatSession, settings: UserSettings): Promise<Blob> {
    const parts: string[] = [];
    const userLabel = settings.userLabelMode === 'account-name' && session.author && session.author !== 'Unknown User'
      ? session.author
      : 'You';

    // 逐条消息渲染
    for (const msg of session.messages) {
      parts.push(this.renderMessage({
        ...msg,
        images: shouldExportUserInputImages(settings) && msg.role === 'user' ? (msg.images || []) : [],
      }, userLabel));
      parts.push('');
    }

    const content = parts.join('\n');
    return new Blob([content], { type: 'text/plain;charset=utf-8' });
  }

  private renderMessage(msg: ChatMessage, userLabel: string): string {
    const lines: string[] = [];
    const label = msg.role === 'user' ? userLabel : 'Gemini';

    lines.push(`[${label}]`);

    if (msg.content) {
      // 简单去除 markdown 图片和超链接，仅保留纯文本会比较好，但这里假设 content 原样也OK，最稳妥可以剥离HTML
      // 这里的 content 可能是 markdown 内容，纯文本模式下直接输出即可
      lines.push(msg.content);
    }

    if (msg.images && msg.images.length > 0) {
      lines.push('');
      lines.push(`[Image(s) omitted in text format: ${msg.images.length} image(s)]`);
    }

    lines.push('');
    lines.push('--------------------------------------------------------------------------------');

    return lines.join('\n');
  }
}

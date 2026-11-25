// src/exporters/pdf-exporter.ts — PDF 格式导出器
// 直接 Markdown -> jsPDF 渲染 (无 HTML 预渲染依赖), 可在 Service Worker 中运行

import { jsPDF } from 'jspdf';
import { browser } from '@/shared/browser-api';
import type { IExporter } from './types';
import type { ChatSession, UserSettings } from '@/types/models';
import { MarkdownExporter } from './markdown-exporter';
import { marked } from 'marked';

const PAGE = {
  width: 210,
  height: 297,
  margin: 18,
  lineHeight: 6.2,
  fontSize: {
    h1: 18,
    h2: 15,
    h3: 13,
    body: 11,
    code: 9.5,
  },
};

const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const PAGE_BOTTOM = PAGE.height - PAGE.margin;

export class PDFExporter implements IExporter {
  private fontLoaded = false;
  private fontBase64: string | null = null;
  private fallbackFont = 'helvetica';
  private currentFont = 'helvetica';

  async export(session: ChatSession, settings: UserSettings): Promise<Blob> {
    if (session.pdfBase64) {
      const byteCharacters = atob(session.pdfBase64);
      const byteArrays: BlobPart[] = [];
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Uint8Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(byteNumbers);
      }
      return new Blob(byteArrays, { type: 'application/pdf' });
    }

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    await this.initFont(doc);
    await this.renderMarkdownDocument(doc, session, settings);
    return doc.output('blob');
  }

  private async initFont(doc: jsPDF): Promise<void> {
    if (this.fontLoaded && this.fontBase64) {
      doc.addFileToVFS('DroidSansFallback.ttf', this.fontBase64);
      doc.addFont('DroidSansFallback.ttf', 'DroidSansFallback', 'normal');
      doc.addFont('DroidSansFallback.ttf', 'DroidSansFallback', 'bold');
      this.currentFont = 'DroidSansFallback';
      return;
    }

    try {
      const url = browser.runtime.getURL('fonts/DroidSansFallbackFull.ttf');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch font: ${res.status}`);

      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i += 8192) {
        const chunk = bytes.subarray(i, Math.min(i + 8192, bytes.byteLength));
        binary += String.fromCharCode.apply(null, chunk as any);
      }

      const b64 = btoa(binary);
      this.fontBase64 = b64;
      this.fontLoaded = true;

      doc.addFileToVFS('DroidSansFallback.ttf', b64);
      doc.addFont('DroidSansFallback.ttf', 'DroidSansFallback', 'normal');
      doc.addFont('DroidSansFallback.ttf', 'DroidSansFallback', 'bold');
      this.currentFont = 'DroidSansFallback';
    } catch (e) {
      console.warn('Failed to load CJK font, using fallback', e);
      this.currentFont = this.fallbackFont;
    }
  }

  private async renderMarkdownDocument(doc: jsPDF, session: ChatSession, settings: UserSettings): Promise<void> {
    const mdExporter = new MarkdownExporter();
    const mdBlob = await mdExporter.export(session, settings);
    const rawMarkdown = await mdBlob.text();

    const markdown = this.normalizeMarkdown(this.stripFrontMatter(rawMarkdown));
    const tokens = marked.lexer(markdown, {
      gfm: true,
      breaks: true,
    });

    let y = PAGE.margin;
    for (const token of tokens as any[]) {
      y = this.renderToken(doc, token, y, PAGE.margin, CONTENT_WIDTH);
    }
  }

  private renderToken(doc: jsPDF, token: any, y: number, x: number, width: number): number {
    switch (token.type) {
      case 'space':
        return y + PAGE.lineHeight * 0.35;

      case 'hr':
        y = this.ensureSpace(doc, y, 4);
        doc.setDrawColor(180, 180, 180);
        doc.line(x, y, x + width, y);
        return y + PAGE.lineHeight * 0.65;

      case 'heading': {
        const text = this.inlineTokensToText(token.tokens ?? []);
        let size = PAGE.fontSize.body;
        if (token.depth === 1) size = PAGE.fontSize.h1;
        else if (token.depth === 2) size = PAGE.fontSize.h2;
        else if (token.depth === 3) size = PAGE.fontSize.h3;
        y = this.drawWrappedText(doc, text, y, x, width, { fontSize: size, bold: true });
        return y + 1.2;
      }

      case 'paragraph': {
        const text = this.inlineTokensToText(token.tokens ?? []);
        y = this.drawWrappedText(doc, text, y, x, width, { fontSize: PAGE.fontSize.body });
        return y + 0.4;
      }

      case 'blockquote': {
        const qx = x + 4;
        y = this.ensureSpace(doc, y, PAGE.lineHeight * 2);
        doc.setDrawColor(160, 160, 160);
        doc.line(x + 1, y - 4, x + 1, y + PAGE.lineHeight * 1.4);
        for (const child of (token.tokens ?? [])) {
          y = this.renderToken(doc, child, y, qx, width - 4);
        }
        return y + 0.4;
      }

      case 'code': {
        const lines = String(token.text ?? '').split('\n');
        return this.renderCodeBlock(doc, lines, y);
      }

      case 'list': {
        const items = token.items ?? [];
        let idx = 1;
        for (const item of items) {
          const bullet = token.ordered ? `${idx}.` : '•';
          const text = this.inlineTokensToText(item.tokens ?? []);
          y = this.drawWrappedText(doc, `${bullet} ${text}`, y, x + 2, width - 2, { fontSize: PAGE.fontSize.body });
          idx += 1;
        }
        return y + 0.3;
      }

      default:
        return y;
    }
  }

  private renderCodeBlock(doc: jsPDF, codeLines: string[], startY: number): number {
    let y = this.ensureSpace(doc, startY, PAGE.lineHeight * 2);
    const x = PAGE.margin + 2;
    const width = CONTENT_WIDTH - 4;

    doc.setFont(this.currentFont, 'normal');
    doc.setFontSize(PAGE.fontSize.code);
    doc.setTextColor(40, 40, 40);

    for (const raw of codeLines) {
      const code = raw.replace(/\t/g, '  ');
      const wrapped = doc.splitTextToSize(code, width - 3);
      const wrappedLines = Array.isArray(wrapped) ? wrapped : [wrapped];
      for (const line of wrappedLines) {
        y = this.ensureSpace(doc, y, PAGE.lineHeight);
        doc.setFillColor(245, 245, 247);
        doc.rect(x - 1, y - 4.1, width, PAGE.lineHeight, 'F');
        doc.text(line, x + 0.8, y);
        y += PAGE.lineHeight;
      }
    }

    return y + 0.6;
  }

  private drawWrappedText(
    doc: jsPDF,
    text: string,
    startY: number,
    x: number,
    width: number,
    options: {
      fontSize: number;
      bold?: boolean;
      color?: [number, number, number];
    },
  ): number {
    if (!text.trim()) return startY;

    let y = startY;
    doc.setFont(this.currentFont, options.bold ? 'bold' : 'normal');
    doc.setFontSize(options.fontSize);
    const color = options.color ?? [30, 30, 30];
    doc.setTextColor(color[0], color[1], color[2]);

    const split = doc.splitTextToSize(text, width);
    const lines = Array.isArray(split) ? split : [split];
    for (const line of lines) {
      y = this.ensureSpace(doc, y, PAGE.lineHeight);
      doc.text(line, x, y);
      y += PAGE.lineHeight;
    }

    return y;
  }

  private ensureSpace(doc: jsPDF, y: number, requiredHeight: number): number {
    if (y + requiredHeight <= PAGE_BOTTOM) return y;
    doc.addPage();
    return PAGE.margin;
  }

  private stripFrontMatter(markdown: string): string {
    return markdown.replace(/^---\n[\s\S]*?\n---\n?/m, '');
  }

  private inlineTokensToText(tokens: any[]): string {
    const buf: string[] = [];
    for (const tk of tokens) {
      switch (tk.type) {
        case 'text':
        case 'codespan':
        case 'em':
        case 'strong':
        case 'del':
          if (tk.tokens) buf.push(this.inlineTokensToText(tk.tokens));
          else buf.push(String(tk.text ?? ''));
          break;
        case 'link':
          buf.push(`${this.inlineTokensToText(tk.tokens ?? [])} (${tk.href ?? ''})`);
          break;
        case 'image':
          buf.push(`[Image${tk.text ? `: ${tk.text}` : ''}]`);
          break;
        case 'br':
          buf.push('\n');
          break;
        default:
          buf.push(String(tk.raw ?? tk.text ?? ''));
      }
    }
    return buf.join('').replace(/[ \t]+/g, ' ').trim();
  }

  private normalizeMarkdown(markdown: string): string {
    return markdown
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

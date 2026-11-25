// src/exporters/index.ts — 导出器工厂

import type { IExporter } from './types';
import { MarkdownExporter } from './markdown-exporter';
import { PDFExporter } from './pdf-exporter';
import { HtmlExporter } from './html-exporter';
import { TxtExporter } from './txt-exporter';

export type { IExporter };

/** 根据格式创建对应的导出器 */
export function createExporter(format: 'markdown' | 'pdf' | 'html' | 'txt'): IExporter {
  switch (format) {
    case 'html':
      return new HtmlExporter();
    case 'txt':
      return new TxtExporter();
    case 'markdown':
      return new MarkdownExporter();
    case 'pdf':
      return new PDFExporter();
  }
}

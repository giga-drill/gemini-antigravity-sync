// src/background/task-manager.ts — 导出任务管理器

import type { ChatSession, ExportTask, UserSettings } from '@/types/models';
import { createExporter } from '@/exporters';
import { createStorage } from '@/storage';
import { buildFilename } from '@/shared/constants';
import { browser } from '@/shared/browser-api';

/** 活跃任务列表 */
const activeTasks = new Map<string, ExportTask>();

/** 广播任务进度给所有 UI 页面 */
function broadcastProgress(task: ExportTask): void {
  browser.runtime.sendMessage({
    action: 'TASK_PROGRESS',
    task: { ...task },
  }).catch(() => {
    // UI 可能已关闭, 忽略
  });
}

/** 生成任务 ID */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function runExportTask(
  task: ExportTask,
  session: ChatSession,
  format: 'markdown' | 'pdf' | 'html' | 'txt',
  settings: UserSettings,
): Promise<ExportTask> {
  activeTasks.set(task.id, task);
  broadcastProgress(task);

  try {
    // 阶段1: 生成文件
    task.status = 'exporting';
    task.progress = 30;
    broadcastProgress(task);

    const exporter = createExporter(format);
    const blob = await exporter.export(session, settings);

    // 阶段2: 保存文件
    task.status = 'exporting';
    task.progress = 70;
    broadcastProgress(task);

    const filename = buildFilename(session.title, format, session.exportDate);
    const storageImpl = createStorage();
    const success = await storageImpl.save(blob, filename);

    if (!success) {
      throw new Error('Storage save failed');
    }

    task.status = 'done';
    task.progress = 100;
    broadcastProgress(task);
  } catch (e) {
    task.status = 'error';
    task.error = e instanceof Error ? e.message : 'Unknown error';
    broadcastProgress(task);
  }

  return task;
}

export function startExportTask(
  session: ChatSession,
  format: 'markdown' | 'pdf' | 'html' | 'txt',
  settings: UserSettings,
): ExportTask {
  const task: ExportTask = {
    id: generateTaskId(),
    sessionId: session.id,
    sessionTitle: session.title,
    format,
    status: 'pending',
    progress: 0,
  };

  void runExportTask(task, session, format, settings);
  return task;
}

/**
 * 执行单个导出任务:
 * 1. 生成文件 (Markdown/PDF)
 * 2. 保存到本地下载
 * 3. 全程广播进度
 */
export async function executeExportTask(
  session: ChatSession,
  format: 'markdown' | 'pdf' | 'html' | 'txt',
  settings: UserSettings
): Promise<ExportTask> {
  const task: ExportTask = {
    id: generateTaskId(),
    sessionId: session.id,
    sessionTitle: session.title,
    format,
    status: 'pending',
    progress: 0,
  };

  return runExportTask(task, session, format, settings);
}

/** 获取所有活跃任务 */
export function getActiveTasks(): ExportTask[] {
  return Array.from(activeTasks.values());
}

// src/popup/components/StatusBar.tsx — 导出状态反馈

import { useTranslation } from 'react-i18next';
import type { ExportAllProgressPhase } from '@/types/messages';

interface Props {
  state: 'idle' | 'extracting' | 'exporting' | 'exportingAll' | 'sendingToNotebookLM' | 'success' | 'error';
  error: string;
  onOpenGemini?: () => void;
  exportAllProgress?: {
    total: number;
    exported: number;
    processed: number;
    currentIndex: number;
    currentTitle: string;
    currentProgress: number;
    phase: ExportAllProgressPhase | 'idle';
  };
}

function isNonGeminiContextError(error: string): boolean {
  return error === 'No active tab' || error.includes('Please open a Gemini chat page');
}

export default function StatusBar({ state, error, onOpenGemini, exportAllProgress }: Props) {
  const { t } = useTranslation();

  if (state === 'idle') return null;

  if (state === 'error' && isNonGeminiContextError(error)) {
    const description = error === 'No active tab'
      ? t('status.nonGeminiNoActiveTabDescription')
      : t('status.nonGeminiDescription');

    return (
      <div className="popup-guidance" role="status" aria-live="polite">
        <div className="popup-guidance__eyebrow">{t('status.nonGeminiEyebrow')}</div>
        <div className="popup-guidance__header">
          <span className="popup-guidance__icon" aria-hidden="true">🧭</span>
          <div className="popup-guidance__copy">
            <div className="popup-guidance__title">{t('status.nonGeminiTitle')}</div>
            <div className="popup-guidance__description">{description}</div>
            <div className="popup-guidance__tip">{t('status.nonGeminiTip')}</div>
          </div>
        </div>
        <div className="popup-guidance__actions">
          <button
            type="button"
            className="popup-guidance__action"
            onClick={onOpenGemini}
          >
            {t('status.openGemini')}
          </button>
        </div>
      </div>
    );
  }

  const isRefreshingList = state === 'exportingAll' && (!exportAllProgress || exportAllProgress.total === 0);
  const exportAllPhase = exportAllProgress?.phase ?? 'idle';

  const resolveExportAllMessage = () => {
    if (!exportAllProgress || exportAllProgress.total === 0) {
      return t('status.refreshingList');
    }

    const current = Math.min(Math.max(exportAllProgress.currentIndex || 1, 1), exportAllProgress.total);
    const vars = {
      current,
      total: exportAllProgress.total,
    };

    switch (exportAllPhase) {
      case 'preparing':
        return t('status.exportAllPreparing', { total: exportAllProgress.total });
      case 'loading-chat':
        return t('status.exportAllLoading', vars);
      case 'extracting-chat':
        return t('status.exportAllExtracting', vars);
      case 'exporting-chat':
        return t('status.exportAllSaving', vars);
      case 'completed-chat':
        return t('status.exportAllCompleted', vars);
      case 'failed-chat':
        return t('status.exportAllFailed', vars);
      case 'skipped-chat':
        return t('status.exportAllSkipped', vars);
      case 'done':
        return t('status.done');
      default:
        return t('status.exporting');
    }
  };

  const exportAllPercent = (() => {
    if (!exportAllProgress || exportAllProgress.total <= 0) return 0;
    if (exportAllPhase === 'done') return 100;

    const base = Math.max(0, (exportAllProgress.currentIndex || 1) - 1);
    const phaseWeight: Record<ExportAllProgressPhase | 'idle', number> = {
      idle: 0,
      preparing: 0,
      'loading-chat': 0.15,
      'extracting-chat': 0.5,
      'exporting-chat': 0.85,
      'completed-chat': 1,
      'failed-chat': 1,
      'skipped-chat': 1,
      done: 1,
    };

    const percent = ((base + (phaseWeight[exportAllPhase] ?? 0)) / exportAllProgress.total) * 100;
    return Math.max(0, Math.min(100, Math.round(percent)));
  })();

  const configs = {
    extracting: { bg: 'bg-blue-50', text: 'text-blue-700', icon: '⏳', msg: t('status.extracting') },
    exporting: { bg: 'bg-blue-50', text: 'text-blue-700', icon: '⏳', msg: t('status.exporting') },
    sendingToNotebookLM: { bg: 'bg-blue-50', text: 'text-blue-700', icon: '⏳', msg: t('status.sendingToNotebookLM') },
    exportingAll: { 
      bg: 'bg-blue-50', 
      text: 'text-blue-700', 
      icon: '⏳', 
      msg: isRefreshingList ? t('status.refreshingList') : resolveExportAllMessage(),
    },
    success: { bg: 'bg-green-50', text: 'text-green-700', icon: '✅', msg: t('popup.success') },
    error: { bg: 'bg-red-50', text: 'text-red-700', icon: '❌', msg: error || t('popup.error') },
  };

  const cfg = configs[state];

  return (
    <div className={`mt-3 p-2.5 rounded-lg ${cfg.bg} ${cfg.text} text-sm`}>
      <div className="flex items-center gap-2">
        <span>{cfg.icon}</span>
        <span className="flex-1">{cfg.msg}</span>
      </div>
      {state === 'exportingAll' && exportAllProgress && exportAllProgress.total > 0 ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs opacity-80">
            <span>{t('status.exportAllDetail', {
              current: Math.min(Math.max(exportAllProgress.currentIndex || 1, 1), exportAllProgress.total),
              total: exportAllProgress.total,
              exported: exportAllProgress.exported,
            })}</span>
            <span>{exportAllPercent}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-blue-100">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-200"
              style={{ width: `${exportAllPercent}%` }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

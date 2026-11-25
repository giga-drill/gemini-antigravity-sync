// src/popup/App.tsx — Popup 主界面

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { sendMessageToBackground } from '@/shared/browser-api';
import { browser as extensionBrowser } from '@/shared/browser-api';
import type { UserSettings, ExportTask, ChatSession } from '@/types/models';
import type { ExtractCurrentChatResponse, ExportSessionResponse, ExportAllResponse, SelectMessagesForExportResponse, ExportAllProgressPhase } from '@/types/messages';
import { DEFAULT_SETTINGS } from '@/types/models';
import { GEMINI_ORIGIN } from '@/shared/constants';
import OpenSourceFooter from '@/shared/components/OpenSourceFooter';
import { getNextReviewPromptState, type ReviewPromptStorage } from './review-prompt';
import ExportPanel from './components/ExportPanel';
import StatusBar from './components/StatusBar';

type PopupState = 'idle' | 'extracting' | 'exporting' | 'exportingAll' | 'sendingToNotebookLM' | 'success' | 'error';
type ExportScope = 'current' | 'selected' | 'all';
type ToastState = 'hidden' | 'visible' | 'hiding';
type ExportAllProgressState = {
  total: number;
  exported: number;
  processed: number;
  currentIndex: number;
  currentTitle: string;
  currentProgress: number;
  phase: ExportAllProgressPhase | 'idle';
};
type FormSelectionState = {
  format: 'markdown' | 'pdf' | 'html' | 'txt';
  outputMode: 'download' | 'clipboard';
  exportScope: ExportScope;
};
type StorageAreaLike = {
  get: (keys: string[] | Record<string, unknown>, callback?: (result: Record<string, unknown>) => void) => void | Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>, callback?: () => void) => void | Promise<void>;
};
type ExtensionGlobal = typeof globalThis & {
  browser?: typeof extensionBrowser;
  chrome?: {
    storage?: {
      local?: StorageAreaLike;
      session?: StorageAreaLike;
    };
    runtime?: {
      lastError?: {
        message: string;
      };
    };
  };
};

const STORE_REVIEW_URL = 'https://addons.mozilla.org/firefox/addon/gemini_chat_exporter@iplaysoft.com/reviews/';
const extensionGlobal = globalThis as ExtensionGlobal;
const browserAPI = typeof extensionGlobal.browser !== 'undefined' ? extensionGlobal.browser : extensionGlobal.chrome;
const POPUP_LOG_PREFIX = '[GCE][popup]';
const BACKGROUND_READY_CACHE_MS = 1000;
const POPUP_SESSION_SELECTION_KEY = 'gce_popup_session_selection';

function getStorageArea(area: 'local' | 'session'): StorageAreaLike | undefined {
  return browserAPI?.storage?.[area];
}

async function storageAreaGet<T extends Record<string, unknown>>(
  area: 'local' | 'session',
  keys: string[] | Record<string, unknown>,
): Promise<T> {
  const storageArea = getStorageArea(area);
  if (!storageArea) {
    return {} as T;
  }

  if (typeof extensionGlobal.browser !== 'undefined') {
    return (await storageArea.get(keys)) as T;
  }

  return await new Promise<T>((resolve, reject) => {
    storageArea.get(keys, (result) => {
      const runtimeError = extensionGlobal.chrome?.runtime?.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(((result ?? {}) as Record<string, unknown>) as T);
    });
  });
}

async function storageAreaSet(area: 'local' | 'session', items: Record<string, unknown>): Promise<void> {
  const storageArea = getStorageArea(area);
  if (!storageArea) {
    return;
  }

  if (typeof extensionGlobal.browser !== 'undefined') {
    await storageArea.set(items);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    storageArea.set(items, () => {
      const runtimeError = extensionGlobal.chrome?.runtime?.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve();
    });
  });
}

async function storageLocalGet<T extends Record<string, unknown>>(keys: string[] | Record<string, unknown>): Promise<T> {
  return storageAreaGet('local', keys);
}

async function storageLocalSet(items: Record<string, unknown>): Promise<void> {
  await storageAreaSet('local', items);
}

async function storageSessionGet<T extends Record<string, unknown>>(keys: string[] | Record<string, unknown>): Promise<T> {
  return storageAreaGet('session', keys);
}

async function storageSessionSet(items: Record<string, unknown>): Promise<void> {
  await storageAreaSet('session', items);
}

function normalizeStoredFormSelection(value: unknown): Partial<FormSelectionState> {
  const stored = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

  return {
    format: stored.format === 'pdf'
      ? 'pdf'
      : stored.format === 'html'
        ? 'html'
        : stored.format === 'txt'
          ? 'txt'
          : stored.format === 'markdown'
            ? 'markdown'
            : undefined,
    outputMode: stored.outputMode === 'clipboard' ? 'clipboard' : stored.outputMode === 'download' ? 'download' : undefined,
    exportScope: stored.exportScope === 'selected'
      ? 'selected'
      : stored.exportScope === 'all'
        ? 'all'
        : stored.exportScope === 'current'
          ? 'current'
          : undefined,
  };
}

function extractNotebookLMText(cleanHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(cleanHtml, 'text/html');
  const turns = Array.from(doc.querySelectorAll('.chat-turn'));

  const chunks = turns
    .map((turn) => {
      const isUser = turn.classList.contains('role-user');
      const isAi = turn.classList.contains('role-ai');
      const content = turn.querySelector('.turn-content');
      const text = content?.textContent?.replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();

      if (!text) return '';
      if (isUser) return `**YOU**:\n${text}`;
      if (isAi) return `**GEMINI**:\n${text}`;
      return text;
    })
    .filter(Boolean);

  return chunks.join('\n\n').trim();
}

function buildNotebookLMTextFromSession(session: ChatSession): string {
  return session.messages
    .map((message) => {
      const text = (message.content || '').replace(/\r\n?/g, '\n').trim();
      if (!text) return '';

      if (message.role === 'user') {
        return `**YOU**:\n${text}`;
      }

      return `**GEMINI**:\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!copied) {
      throw new Error('Clipboard copy failed');
    }
  }
}

async function openNotebookLMTab(): Promise<void> {
  const chromeApi = (globalThis as typeof globalThis & {
    chrome?: {
      tabs?: {
        create: (createProperties: { url: string }, callback?: () => void) => void;
      };
      runtime?: {
        lastError?: {
          message: string;
        };
      };
    };
  }).chrome;
  const chromeTabs = chromeApi?.tabs;

  if (chromeTabs?.create) {
    await new Promise<void>((resolve, reject) => {
      chromeTabs.create({ url: 'https://notebooklm.google.com/' }, () => {
        const runtimeError = chromeApi?.runtime?.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        resolve();
      });
    });
    return;
  }

  await extensionBrowser.tabs.create({ url: 'https://notebooklm.google.com/' });
}

function resolveUserLabel(session: ChatSession, settings: UserSettings): string {
  if (settings.userLabelMode === 'account-name') {
    const name = (session.author || '').trim();
    if (name && name !== 'Unknown User') return name;
  }

  return 'You';
}

async function buildClipboardContent(
  session: ChatSession,
  format: 'markdown' | 'pdf' | 'html' | 'txt',
  settings: UserSettings,
): Promise<string> {
  const [modelsModule, htmlModule] = await Promise.all([
    import('@/types/models'),
    import('@/shared/standard-chat-html'),
  ]);

  const { sanitizeMessagesForImageExport, shouldExportUserInputImages } = modelsModule;
  const { buildStandardChatHtml } = htmlModule;
  const includeImages = shouldExportUserInputImages(settings);
  const exportSession = {
    ...session,
    messages: sanitizeMessagesForImageExport(session.messages, includeImages),
  };

  switch (format) {
    case 'markdown': {
      const { MarkdownExporter } = await import('@/exporters/markdown-exporter');
      const blob = await new MarkdownExporter().export(exportSession, settings);
      return blob.text();
    }
    case 'txt': {
      const { TxtExporter } = await import('@/exporters/txt-exporter');
      const blob = await new TxtExporter().export(exportSession, settings);
      return blob.text();
    }
    case 'html': {
      return buildStandardChatHtml(exportSession.messages, {
        title: exportSession.title,
        userLabel: resolveUserLabel(exportSession, settings),
        includeImages,
      });
    }
    case 'pdf': {
      throw new Error('Clipboard output does not support PDF');
    }
  }
}

export default function App() {
  const { t } = useTranslation();
  const [state, setState] = useState<PopupState>('idle');
  const [error, setError] = useState('');
  const [fileActionLabel, setFileActionLabel] = useState<string | null>(null);
  const [toastState, setToastState] = useState<ToastState>('hidden');
  const [exportAllProgress, setExportAllProgress] = useState<ExportAllProgressState>({
    total: 0,
    exported: 0,
    processed: 0,
    currentIndex: 0,
    currentTitle: '',
    currentProgress: 0,
    phase: 'idle',
  });
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [format, setFormat] = useState<'markdown' | 'pdf' | 'html' | 'txt'>('markdown');
  const [outputMode, setOutputMode] = useState<'download' | 'clipboard'>('download');
  const normalizeTheme = (value: unknown): 'theme-notion' | 'theme-academic' | 'theme-script' => {
    if (value === 'theme-academic') return 'theme-academic';
    if (value === 'theme-script') return 'theme-script';
    return 'theme-notion';
  };

  const [theme, setTheme] = useState<'theme-notion' | 'theme-academic' | 'theme-script'>('theme-notion');
  const [exportScope, setExportScope] = useState<ExportScope>('current');
  const activeExportTaskIdRef = useRef<string | null>(null);
  const toastHideTimerRef = useRef<number | null>(null);
  const toastCleanupTimerRef = useRef<number | null>(null);
  const popupSelectionPersistTimerRef = useRef<number | null>(null);
  const themePersistTimerRef = useRef<number | null>(null);
  const backgroundReadyRef = useRef<boolean | null>(null);
  const backgroundReadyAtRef = useRef<number>(0);
  const backgroundReadyPromiseRef = useRef<Promise<boolean> | null>(null);
  const popupSelectionReadyRef = useRef(false);
  const isAllScopeDisabled = outputMode === 'clipboard';
  const isNotebookDisabled = outputMode !== 'clipboard';
  const allScopeDisabledTitle = isAllScopeDisabled
    ? t('popup.scopeAllClipboardDisabled')
    : undefined;
  const notebookDisabledTitle = isNotebookDisabled
    ? t('popup.notebookClipboardOnlyHint')
    : undefined;

  const validateFormState = (nextState: FormSelectionState): FormSelectionState => {
    const validatedState = { ...nextState };

    if (validatedState.format === 'pdf' && validatedState.outputMode === 'clipboard') {
      validatedState.outputMode = 'download';
    }

    if (validatedState.outputMode === 'clipboard' && validatedState.exportScope === 'all') {
      validatedState.exportScope = 'current';
    }

    return validatedState;
  };

  const applyValidatedFormState = (nextState: Partial<FormSelectionState>) => {
    const validatedState = validateFormState({
      format: nextState.format ?? format,
      outputMode: nextState.outputMode ?? outputMode,
      exportScope: nextState.exportScope ?? exportScope,
    });

    setFormat(validatedState.format);
    setOutputMode(validatedState.outputMode);
    setExportScope(validatedState.exportScope);
  };

  useEffect(() => {
    const initStartedAt = performance.now();
    document.body.classList.add('popup-page');
    console.info(`${POPUP_LOG_PREFIX} mounted`);

    return () => {
      document.body.classList.remove('popup-page');
      console.info(`${POPUP_LOG_PREFIX} unmounted`, {
        lifetimeMs: Math.round(performance.now() - initStartedAt),
      });

      if (toastHideTimerRef.current !== null) {
        window.clearTimeout(toastHideTimerRef.current);
      }
      if (toastCleanupTimerRef.current !== null) {
        window.clearTimeout(toastCleanupTimerRef.current);
      }
      if (popupSelectionPersistTimerRef.current !== null) {
        window.clearTimeout(popupSelectionPersistTimerRef.current);
      }
      if (themePersistTimerRef.current !== null) {
        window.clearTimeout(themePersistTimerRef.current);
      }
    };
  }, []);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const isExportBusy = state === 'extracting' || state === 'exporting' || state === 'exportingAll';
  const isNotebookBusy = state === 'sendingToNotebookLM';
  const isBusy = isExportBusy || isNotebookBusy;

  const showToast = () => {
    if (toastHideTimerRef.current !== null) {
      window.clearTimeout(toastHideTimerRef.current);
      toastHideTimerRef.current = null;
    }

    if (toastCleanupTimerRef.current !== null) {
      window.clearTimeout(toastCleanupTimerRef.current);
      toastCleanupTimerRef.current = null;
    }

    setToastState('visible');

    toastHideTimerRef.current = window.setTimeout(() => {
      setToastState('hiding');
      toastCleanupTimerRef.current = window.setTimeout(() => {
        setToastState('hidden');
        toastCleanupTimerRef.current = null;
      }, 320);
      toastHideTimerRef.current = null;
    }, 4500);
  };

  const trackSuccessfulAction = async () => {
    try {
      const stored = await storageLocalGet<ReviewPromptStorage>({
        exportSuccessCount: 0,
        hasClickedReview: false,
      });
      const { nextCount, shouldShowToast } = getNextReviewPromptState(stored);

      await storageLocalSet({ exportSuccessCount: nextCount });

      if (shouldShowToast) {
        showToast();
      }
    } catch (storageError) {
      console.warn('[Popup] Failed to update review prompt storage:', storageError);
    }
  };

  const handleReviewLinkClick = () => {
    void (async () => {
      try {
        await storageLocalSet({ hasClickedReview: true });
      } catch (storageError) {
        console.warn('[Popup] Failed to persist review click flag:', storageError);
      }

      if (toastHideTimerRef.current !== null) {
        window.clearTimeout(toastHideTimerRef.current);
        toastHideTimerRef.current = null;
      }
      if (toastCleanupTimerRef.current !== null) {
        window.clearTimeout(toastCleanupTimerRef.current);
        toastCleanupTimerRef.current = null;
      }
      setToastState('hidden');
    })();
  };

  const ensureBackgroundReady = async (): Promise<boolean> => {
    if (
      backgroundReadyRef.current === true
      && (performance.now() - backgroundReadyAtRef.current) < BACKGROUND_READY_CACHE_MS
    ) {
      return true;
    }

    if (backgroundReadyPromiseRef.current) {
      return backgroundReadyPromiseRef.current;
    }

    const readinessPromise = (async () => {
    for (let i = 0; i < 3; i++) {
      const attempt = i + 1;
      const startedAt = performance.now();
      try {
        await sendMessageToBackground<{ success: boolean }>({ action: 'PING' });
        console.info(`${POPUP_LOG_PREFIX} background ping succeeded`, {
          attempt,
          durationMs: Math.round(performance.now() - startedAt),
        });
        backgroundReadyRef.current = true;
        backgroundReadyAtRef.current = performance.now();
        return true;
      } catch (error) {
        console.warn(`${POPUP_LOG_PREFIX} background ping failed`, {
          attempt,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : String(error),
        });
        if (i < 2) await sleep(180);
      }
    }

      backgroundReadyRef.current = false;
      backgroundReadyAtRef.current = 0;
      return false;
    })();

    backgroundReadyPromiseRef.current = readinessPromise;

    try {
      return await readinessPromise;
    } finally {
      backgroundReadyPromiseRef.current = null;
    }
  };

  // 加载用户设置
  useEffect(() => {
    const startedAt = performance.now();
    let isCancelled = false;

    console.info(`${POPUP_LOG_PREFIX} starting popup initialization`);

    void (async () => {
      const backgroundUnavailableMessage = t('popup.backgroundUnavailable');

      try {
        const ok = await ensureBackgroundReady();
        if (!ok) {
          console.warn(`${POPUP_LOG_PREFIX} popup initialization aborted because background is unavailable`, {
            durationMs: Math.round(performance.now() - startedAt),
          });

          if (!isCancelled) {
            setState('error');
            setError(backgroundUnavailableMessage);
          }
          return;
        }

        const [res, storedThemeResult, storedPopupSelectionResult] = await Promise.all([
          sendMessageToBackground<{ success: boolean; data?: UserSettings }>({
            action: 'GET_SETTINGS',
          }),
          extensionBrowser.storage.local.get(['gemini_export_theme']).catch(() => ({ gemini_export_theme: undefined })),
          storageSessionGet<{ [POPUP_SESSION_SELECTION_KEY]?: unknown }>({
            [POPUP_SESSION_SELECTION_KEY]: undefined,
          }),
        ]);

        if (isCancelled) {
          return;
        }

        if (res.success && res.data) {
          console.info(`${POPUP_LOG_PREFIX} settings loaded`, {
            durationMs: Math.round(performance.now() - startedAt),
            language: res.data.language,
            defaultFormat: res.data.defaultExportFormat,
            defaultOutputMode: res.data.defaultOutputMode,
          });

          setSettings(res.data);
          const storedPopupSelection = normalizeStoredFormSelection(
            storedPopupSelectionResult[POPUP_SESSION_SELECTION_KEY],
          );
          const validatedState = validateFormState({
            format: storedPopupSelection.format ?? res.data.defaultExportFormat,
            outputMode: storedPopupSelection.outputMode ?? res.data.defaultOutputMode,
            exportScope: storedPopupSelection.exportScope ?? 'current',
          });

          setFormat(validatedState.format);
          setOutputMode(validatedState.outputMode);
          setExportScope(validatedState.exportScope);

          try {
            globalThis.localStorage?.setItem('gce_language', res.data.language);
          } catch {
            // Ignore persistence failures.
          }

          if (i18n.language !== res.data.language) {
            void i18n.changeLanguage(res.data.language);
          }
        }

        if (isCancelled) {
          return;
        }

        const resolvedTheme = normalizeTheme(storedThemeResult.gemini_export_theme);
        setTheme(resolvedTheme);
        popupSelectionReadyRef.current = true;
        console.info(`${POPUP_LOG_PREFIX} theme loaded`, {
          durationMs: Math.round(performance.now() - startedAt),
          theme: resolvedTheme,
        });
      } catch (e) {
        console.error(`${POPUP_LOG_PREFIX} popup initialization failed`, {
          durationMs: Math.round(performance.now() - startedAt),
          error: e instanceof Error ? e.message : String(e),
        });

        backgroundReadyRef.current = false;
        backgroundReadyAtRef.current = 0;

        if (!isCancelled) {
          setState('error');
          setError(e instanceof Error ? e.message : backgroundUnavailableMessage);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!popupSelectionReadyRef.current) {
      return;
    }

    if (popupSelectionPersistTimerRef.current !== null) {
      window.clearTimeout(popupSelectionPersistTimerRef.current);
    }

    popupSelectionPersistTimerRef.current = window.setTimeout(() => {
      popupSelectionPersistTimerRef.current = null;
      void storageSessionSet({
        [POPUP_SESSION_SELECTION_KEY]: {
          format,
          outputMode,
          exportScope,
        },
      }).catch((error) => {
        console.warn(`${POPUP_LOG_PREFIX} failed to persist popup session selection`, {
          error: error instanceof Error ? error.message : String(error),
        });
      });

    }, 160);

    return () => {
      if (popupSelectionPersistTimerRef.current !== null) {
        window.clearTimeout(popupSelectionPersistTimerRef.current);
        popupSelectionPersistTimerRef.current = null;
      }
    };
  }, [format, outputMode, exportScope]);

  useEffect(() => {
    if (!popupSelectionReadyRef.current) {
      return;
    }

    if (themePersistTimerRef.current !== null) {
      window.clearTimeout(themePersistTimerRef.current);
    }

    themePersistTimerRef.current = window.setTimeout(() => {
      themePersistTimerRef.current = null;
      void extensionBrowser.storage.local.set({ gemini_export_theme: theme }).catch(() => {
        console.warn(`${POPUP_LOG_PREFIX} failed to persist popup theme`);
      });
    }, 160);

    return () => {
      if (themePersistTimerRef.current !== null) {
        window.clearTimeout(themePersistTimerRef.current);
        themePersistTimerRef.current = null;
      }
    };
  }, [theme]);

  // 监听任务进度
  useEffect(() => {
    const listener = (message: unknown) => {
      const msg = message as { action?: string; task?: ExportTask };
      if (msg.action === 'TASK_PROGRESS' && msg.task) {
        if (activeExportTaskIdRef.current && msg.task.id === activeExportTaskIdRef.current) {
          if (msg.task.status === 'done') {
            activeExportTaskIdRef.current = null;
            setState('success');
            void trackSuccessfulAction();
          }
          if (msg.task.status === 'error') {
            activeExportTaskIdRef.current = null;
            setState('error');
            setError(msg.task.error ?? '');
          }
        }
      }
      const progressMsg = message as {
        action?: string;
        total?: number;
        exported?: number;
        processed?: number;
        currentIndex?: number;
        currentTitle?: string;
        currentProgress?: number;
        phase?: ExportAllProgressPhase;
        status?: string;
      };
      if (progressMsg.action === 'EXPORT_ALL_PROGRESS') {
        setExportAllProgress({
          total: progressMsg.total ?? 0,
          exported: progressMsg.exported ?? 0,
          processed: progressMsg.processed ?? 0,
          currentIndex: progressMsg.currentIndex ?? 0,
          currentTitle: progressMsg.currentTitle ?? '',
          currentProgress: progressMsg.currentProgress ?? 0,
          phase: progressMsg.phase ?? 'idle',
        });
        if (progressMsg.status === 'done') {
          setState('success');
        }
      }
    };
    extensionBrowser.runtime.onMessage.addListener(listener);
    return () => extensionBrowser.runtime.onMessage.removeListener(listener);
  }, []);

  const handleSendToNotebookLM = async () => {
    setState('sendingToNotebookLM');
    setError('');

    if (!(await ensureBackgroundReady())) {
      setState('error');
      setError(t('popup.backgroundUnavailable'));
      return;
    }

    try {
      const extractionResult = await sendMessageToBackground<ExtractCurrentChatResponse>({
        action: 'EXTRACT_CURRENT_CHAT',
      });

      if (!extractionResult.success || !extractionResult.data) {
        setState('error');
        setError(extractionResult.error ?? t('popup.error'));
        return;
      }

      const notebookText = buildNotebookLMTextFromSession(extractionResult.data);
      if (!notebookText) {
        const stored = await extensionBrowser.storage.local.get(['gemini_clean_html']);
        const cleanHtml = typeof stored.gemini_clean_html === 'string' ? stored.gemini_clean_html : '';
        const fallbackText = cleanHtml.trim() ? extractNotebookLMText(cleanHtml) : '';

        if (!fallbackText) {
          throw new Error(t('popup.noChat'));
        }

        await copyTextToClipboard(fallbackText);
        await openNotebookLMTab();
        setState('success');
        await trackSuccessfulAction();
        return;
      }

      await copyTextToClipboard(notebookText);
      await openNotebookLMTab();
      setState('success');
      await trackSuccessfulAction();
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExportCurrent = async () => {
    setState('extracting');
    setError('');

    if (!(await ensureBackgroundReady())) {
      setState('error');
      setError(t('popup.backgroundUnavailable'));
      return;
    }

    try {
      if (format === 'pdf') {
        setState('exporting');
        await extensionBrowser.storage.local.set({ gemini_export_theme: theme });

        const triggerResult = await sendMessageToBackground<{ success: boolean; error?: string }>({
          action: 'EXTRACT_GEMINI_CHAT_HTML',
          theme,
          settings,
        });

        if (triggerResult.success) {
          window.close();
        } else {
          setState('error');
          setError(triggerResult.error ?? t('popup.error'));
        }
        return;
      }

      // 步骤1: 通过 Background 转发, 让 Content Script 提取数据
      const extractResult = await sendMessageToBackground<ExtractCurrentChatResponse>({
        action: 'EXTRACT_CURRENT_CHAT',
        format,
        settings,
        theme,
      });

      if (extractResult.cancelled) {
         setState('idle');
         return;
      }

      if (!extractResult.success || !extractResult.data) {
        setState('error');
        setError(extractResult.error ?? t('popup.noChat'));
        return;
      }

      // 步骤2: 发送给 Background 执行导出
      setState('exporting');
      const exportResult = await sendMessageToBackground<ExportSessionResponse>({
        action: 'EXPORT_SESSION',
        session: extractResult.data,
        format,
        settings,
      });

      if (exportResult.success && exportResult.taskId) {
        activeExportTaskIdRef.current = exportResult.taskId;
      } else {
        setState('error');
        setError(exportResult.error ?? t('popup.error'));
      }
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExportSelection = async () => {
    setState('extracting');
    setError('');

    if (!(await ensureBackgroundReady())) {
      setState('error');
      setError(t('popup.backgroundUnavailable'));
      return;
    }

    try {
      const result = await sendMessageToBackground<SelectMessagesForExportResponse>({
        action: 'SELECT_MESSAGES_FOR_EXPORT',
        format,
        settings,
        theme,
      });

      if (result.cancelled) {
        setState('idle');
        return;
      }

      if (!result.success) {
        setState('error');
        setError(result.error ?? t('popup.error'));
        return;
      }

      window.close();
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExportAll = async () => {
    setState('exportingAll');
    setError('');
    setExportAllProgress({
      total: 0,
      exported: 0,
      processed: 0,
      currentIndex: 0,
      currentTitle: '',
      currentProgress: 0,
      phase: 'idle',
    });

    if (!(await ensureBackgroundReady())) {
      setState('error');
      setError(t('popup.backgroundUnavailable'));
      return;
    }

    try {
      const result = await sendMessageToBackground<ExportAllResponse>({
        action: 'EXPORT_ALL',
        format,
        settings,
        theme,
      });

      if (result.cancelled) {
        setState('idle');
        return;
      }

      if (result.success) {
        setState('success');
        await trackSuccessfulAction();
      } else {
        setState('error');
        setError(result.error ?? t('popup.error'));
      }
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openOptions = () => {
    extensionBrowser.runtime.openOptionsPage();
  };

  const openGemini = () => {
    void extensionBrowser.tabs.create({ url: GEMINI_ORIGIN });
  };

  const handleFormatChange = (nextFormat: 'markdown' | 'pdf' | 'html' | 'txt') => {
    applyValidatedFormState({ format: nextFormat });
  };

  const handleOutputModeChange = (nextOutputMode: 'download' | 'clipboard') => {
    applyValidatedFormState({ outputMode: nextOutputMode });
  };

  const handleExportScopeChange = (nextExportScope: ExportScope) => {
    applyValidatedFormState({ exportScope: nextExportScope });
  };

  const handleFileExport = async () => {
    if (outputMode === 'clipboard') {
      if (exportScope === 'all') {
        setState('error');
        setError(t('popup.clipboardAllUnsupported'));
        return;
      }

      setState('extracting');
      setError('');

      try {
        let session: ChatSession | undefined;

        if (exportScope === 'selected') {
          const result = await sendMessageToBackground<SelectMessagesForExportResponse>({
            action: 'SELECT_MESSAGES_FOR_EXPORT',
            format,
            settings,
            theme,
            outputMode: 'clipboard',
          });

          if (result.cancelled) {
            setState('idle');
            return;
          }

          if (!result.success || !result.data) {
            setState('error');
            setError(result.error ?? t('popup.error'));
            return;
          }

          session = result.data;
        } else {
          const result = await sendMessageToBackground<ExtractCurrentChatResponse>({
            action: 'EXTRACT_CURRENT_CHAT',
            format,
            settings,
            theme,
          });

          if (!result.success || !result.data) {
            setState('error');
            setError(result.error ?? t('popup.noChat'));
            return;
          }

          session = result.data;
        }

        const content = await buildClipboardContent(session, format, settings);
        await copyTextToClipboard(content);
        setState('idle');
        setError('');
        setFileActionLabel(t('popup.copiedToClipboard'));
        await trackSuccessfulAction();
        window.setTimeout(() => {
          setFileActionLabel(null);
        }, 2000);
        return;
      } catch (e) {
        setState('error');
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }

    if (exportScope === 'all') {
      await handleExportAll();
      return;
    }

    if (exportScope === 'selected') {
      await handleExportSelection();
      return;
    }

    await handleExportCurrent();
  };

  return (
    <div className="popup-shell font-sans text-gray-800">
      <div
        id="success-toast"
        className={`popup-toast ${toastState === 'visible' ? 'popup-toast--visible' : ''} ${toastState === 'hiding' ? 'popup-toast--hiding' : ''}`.trim()}
        aria-hidden={toastState === 'hidden'}
      >
        <div className="popup-toast__content">
          <span className="popup-toast__text">{t('feedback.reviewToast')}</span>
          <a
            href={STORE_REVIEW_URL}
            target="_blank"
            rel="noreferrer"
            className="popup-toast__link"
            onClick={handleReviewLinkClick}
          >
            {t('feedback.reviewToastLink')}
          </a>
        </div>
      </div>

      <div className="popup-card popup-content">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-bold text-blue-700">{t('popup.title')}</h1>
          <button
            onClick={openOptions}
            type="button"
            disabled={isBusy}
            className="text-xs text-blue-500 hover:underline"
            title={t('popup.openOptions')}
          >
            {t('popup.openOptions')}
          </button>
        </div>

        {/* 导出控制面板 */}
        <ExportPanel
          format={format}
          outputMode={outputMode}
          theme={theme}
          disabled={isBusy}
          onFormatChange={handleFormatChange}
          onOutputModeChange={handleOutputModeChange}
          onThemeChange={(nextTheme) => {
            setTheme(nextTheme);
          }}
        />

        <div className="mt-4">
          <label className="popup-section-label">{t('popup.scope')}</label>
          <div className="popup-option-grid popup-option-grid--scope">
            <button
              type="button"
              onClick={() => handleExportScopeChange('current')}
              disabled={isBusy}
              className={`option-btn ${exportScope === 'current' ? 'active' : ''}`}
            >
              <span className="option-btn__label">{t('popup.scopeCurrent')}</span>
            </button>
            <button
              type="button"
              onClick={() => handleExportScopeChange('selected')}
              disabled={isBusy}
              className={`option-btn ${exportScope === 'selected' ? 'active' : ''}`}
            >
              <span className="option-btn__label">{t('popup.scopeSelected')}</span>
            </button>
            <button
              type="button"
              onClick={() => handleExportScopeChange('all')}
              disabled={isBusy || isAllScopeDisabled}
              title={allScopeDisabledTitle}
              className={`option-btn ${exportScope === 'all' ? 'active' : ''} ${isAllScopeDisabled ? 'disabled-option' : ''}`}
            >
              <span className="option-btn__label">{t('popup.scopeAll')}</span>
            </button>
          </div>
          <p className="scope-hint mt-1.5">{t('popup.scopeHint')}</p>
        </div>

        {/* 状态栏 */}
        <StatusBar
          state={state}
          error={error}
          onOpenGemini={openGemini}
          exportAllProgress={exportAllProgress}
        />
      </div>

      <div className="popup-bottom-dock">
        <div className="action-footer">
          <button
            id="btn-export-file"
            onClick={handleFileExport}
            type="button"
            disabled={isBusy}
            className="action-btn primary-btn"
          >
            <span className="action-btn__label">
              {fileActionLabel
                ? fileActionLabel
                : state === 'exportingAll'
                ? (exportAllProgress.total === 0
                    ? t('popup.refreshingListBtn')
                  : t('popup.exportingAll', {
                    current: Math.max(exportAllProgress.currentIndex, 1),
                    total: exportAllProgress.total,
                    }))
                : (state === 'extracting' || state === 'exporting'
                    ? t('popup.exporting')
                    : t('popup.exportAndSave'))}
            </span>
          </button>
          <button
            id="btn-send-notebook"
            onClick={handleSendToNotebookLM}
            type="button"
            disabled={isBusy || isNotebookDisabled}
            title={notebookDisabledTitle}
            className={`action-btn magic-btn ${isNotebookDisabled ? 'disabled' : ''}`.trim()}
          >
            <span className="action-btn__label">
              {isNotebookBusy ? t('popup.sendingNotebookShort') : t('popup.sendNotebook')}
            </span>
          </button>
        </div>
        <div className="action-footer-meta">
          <OpenSourceFooter compact />
        </div>
      </div>
    </div>
  );
}

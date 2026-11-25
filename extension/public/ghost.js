function normalizeTheme(theme) {
  if (theme === 'theme-academic') return 'theme-academic';
  if (theme === 'theme-script') return 'theme-script';
  return 'theme-notion';
}

function normalizeLanguage(language) {
  return typeof language === 'string' && language.toLowerCase().includes('zh')
    ? 'zh-CN'
    : 'en-US';
}

const GHOST_COPY = {
  'en-US': {
    preparing: 'Preparing PDF export…',
    savingAutoClose: 'Generating and saving the PDF. This page will close automatically when it finishes.',
    savingKeepOpen: 'Generating and saving the PDF. Debug preview is enabled, so this page will stay open when it finishes.',
    savingAutoCloseAfterImages: 'Generating and saving the PDF. This page will close automatically once saving is complete.',
    savingKeepOpenAfterImages: 'Generating and saving the PDF. Debug preview is enabled, so this page will stay open after saving.',
    completeAutoClose: 'The PDF has been generated and saving has started. This page will close shortly.',
    completeKeepOpen: 'The PDF has been generated and saving has started. Debug preview is enabled, so this page will remain open for inspection.',
    debugKeepOpen: 'GCE Debug: the ghost preview stays open after saveAsPDF so you can inspect the result.',
    debugVerbose: 'GCE Debug: saveAsPDF is running with verbose logging enabled.',
    missingContainer: 'Cannot find render container #content-container',
    crash: 'Ghost export crashed:',
  },
  'zh-CN': {
    preparing: '正在准备 PDF 导出，请稍候…',
    savingAutoClose: '正在生成并保存 PDF，请稍候。完成后此页面会自动关闭。',
    savingKeepOpen: '正在生成并保存 PDF，请稍候。由于当前启用了调试预览，完成后此页面会保持打开。',
    savingAutoCloseAfterImages: '正在生成并保存 PDF，请稍候。完成后此页面会自动关闭。',
    savingKeepOpenAfterImages: '正在生成并保存 PDF，请稍候。调试预览模式已开启，完成后此页面会保持打开。',
    completeAutoClose: 'PDF 已生成并开始保存，此页面即将自动关闭。',
    completeKeepOpen: 'PDF 已生成并开始保存。调试预览模式已开启，此页面将保持打开供你检查。',
    debugKeepOpen: 'GCE 调试：Ghost 预览页会在 saveAsPDF 完成后保持打开，方便检查结果。',
    debugVerbose: 'GCE 调试：saveAsPDF 已启用详细日志输出。',
    missingContainer: '找不到渲染容器 #content-container',
    crash: '导出过程中发生崩溃:',
  },
};

function getGhostCopy(language) {
  return GHOST_COPY[normalizeLanguage(language)] || GHOST_COPY['en-US'];
}

function buildGhostExportStorageKey(exportId) {
  return `gemini_ghost_export_payload_${exportId}`;
}

function getBodyTextPreview() {
  const text = document.body?.innerText || document.body?.textContent || '';
  return text.slice(0, 300);
}

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function waitForNextPaint(frames = 2) {
  return new Promise((resolve) => {
    const raf = typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (cb) => globalThis.setTimeout(cb, 0);

    let remaining = Math.max(1, frames);
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }

      raf(tick);
    };

    raf(tick);
  });
}

function createLogger(enabled) {
  return {
    info(...args) {
      if (enabled) {
        console.log(...args);
      }
    },
    warn(...args) {
      console.warn(...args);
    },
    error(...args) {
      console.error(...args);
    },
  };
}

function updateStatusBanner(message, options = {}) {
  const banner = document.getElementById('ghost-status-banner');
  const text = document.getElementById('ghost-status-text');
  if (!banner || !text) {
    return;
  }

  text.textContent = message;
  banner.classList.toggle('is-complete', options.complete === true);
}

function summarizeImage(img) {
  const src = img.currentSrc || img.getAttribute('src') || '';
  return {
    srcPreview: src.slice(0, 180),
    complete: img.complete,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    loading: img.getAttribute('loading') || '',
    decoding: img.getAttribute('decoding') || '',
  };
}

async function waitForImagesReady(root, logger, timeoutMs = 12000) {
  const images = Array.from(root.querySelectorAll('img'));
  logger.info('[Ghost] image scan', {
    totalImages: images.length,
    sampleImages: images.slice(0, 5).map((img) => summarizeImage(img)),
  });

  if (images.length === 0) {
    return;
  }

  const startedAt = Date.now();

  await Promise.all(images.map((img, index) => new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      logger.info('[Ghost] image already ready', { index, ...summarizeImage(img) });
      resolve(true);
      return;
    }

    let settled = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      cleanup();
      logger.info('[Ghost] image wait finished', {
        index,
        state,
        elapsedMs: Date.now() - startedAt,
        ...summarizeImage(img),
      });
      resolve(state);
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    };

    const onLoad = () => finish('load');
    const onError = () => finish('error');
    const timer = window.setTimeout(() => finish('timeout'), timeoutMs);

    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });

    if (typeof img.decode === 'function') {
      img.decode()
        .then(() => finish('decode'))
        .catch((error) => {
          logger.warn('[Ghost] image decode rejected', {
            index,
            error: error && error.message ? error.message : String(error),
            ...summarizeImage(img),
          });
        });
    }
  })));

  logger.info('[Ghost] image wait summary', {
    elapsedMs: Date.now() - startedAt,
    totalImages: images.length,
    finalImages: images.slice(0, 10).map((img) => summarizeImage(img)),
  });
}

async function activateGhostTabIfNeeded(browserApi, currentTab, keepPreviewOpen) {
  if (!currentTab?.id || keepPreviewOpen || currentTab.active) {
    return;
  }

  if (currentTab.windowId && browserApi.windows?.update) {
    try {
      await browserApi.windows.update(currentTab.windowId, { focused: true });
    } catch (error) {
      console.warn('[Ghost] Failed to focus ghost window before saveAsPDF:', error);
    }
  }

  await browserApi.tabs.update(currentTab.id, { active: true });
  await sleep(150);
}

async function restorePreviousTab(browserApi, exportPayload, currentTab, keepPreviewOpen) {
  if (keepPreviewOpen || !currentTab?.id) {
    return;
  }

  const previousTabId = exportPayload?.previousActiveTabId;
  const previousWindowId = exportPayload?.previousWindowId;

  if (typeof previousTabId === 'number' && previousTabId !== currentTab.id) {
    try {
      if (typeof previousWindowId === 'number' && browserApi.windows?.update) {
        await browserApi.windows.update(previousWindowId, { focused: true });
      }
      await browserApi.tabs.update(previousTabId, { active: true });
    } catch (error) {
      console.warn('[Ghost] Failed to restore previous active tab:', error);
    }
  }

  await browserApi.tabs.remove(currentTab.id).catch((closeError) => {
    console.warn('[Ghost] Failed to auto-close ghost tab:', closeError);
  });
}

async function initRender() {
  try {
    const browserApi = globalThis.browser;
    if (!browserApi?.storage?.local?.get || !browserApi?.tabs?.getCurrent || !browserApi?.tabs?.saveAsPDF || !browserApi?.tabs?.remove || !browserApi?.tabs?.update) {
      throw new Error('Required Firefox browser APIs are unavailable');
    }

    const mount = document.getElementById('content-container');
    if (!mount) {
      console.error('找不到渲染容器 #content-container');
      return;
    }

    const params = new URLSearchParams(globalThis.location.search);
    const themeFromQuery = params.get('theme');
    const exportId = params.get('exportId');
    const languageFromQuery = normalizeLanguage(params.get('lang'));
    const debugMode = params.get('debug') === '1';
    const keepPreviewOpen = params.get('keepOpen') === '1';
    const logger = createLogger(debugMode || keepPreviewOpen);
    let copy = getGhostCopy(languageFromQuery);

    updateStatusBanner(keepPreviewOpen ? copy.savingKeepOpen : copy.savingAutoClose);

    let exportPayload = null;
    if (exportId) {
      const payloadKey = buildGhostExportStorageKey(exportId);
      const payloadResult = await browserApi.storage.local.get(payloadKey);
      exportPayload = payloadResult?.[payloadKey] ?? null;

      if (exportPayload?.language) {
        copy = getGhostCopy(exportPayload.language);
        updateStatusBanner(keepPreviewOpen ? copy.savingKeepOpen : copy.savingAutoClose);
      }

      if (exportPayload && browserApi.storage.local?.remove) {
        await browserApi.storage.local.remove(payloadKey).catch((error) => {
          logger.warn('[Ghost] Failed to clean payload key:', payloadKey, error);
        });
      }
    }

    const data = await browserApi.storage.local.get(['gemini_chat_html', 'gemini_export_theme', 'gemini_chat_title', 'gemini_export_filename']);
    logger.info('从 storage 读取到的数据:', {
      exportId,
      hasExportPayload: !!exportPayload,
      legacyKeys: Object.keys(data || {}),
    });

    const html = typeof exportPayload?.html === 'string' && exportPayload.html.trim()
      ? exportPayload.html
      : data?.gemini_chat_html;
    if (typeof html !== 'string' || !html.trim()) {
      throw new Error('No gemini_chat_html found in browser.storage.local');
    }

    const chatTitle = typeof exportPayload?.title === 'string' && exportPayload.title.trim()
      ? exportPayload.title.trim()
      : typeof data?.gemini_chat_title === 'string' && data.gemini_chat_title.trim()
        ? data.gemini_chat_title.trim()
      : 'Gemini Chat Export';
    const exportFilename = typeof exportPayload?.filename === 'string' && exportPayload.filename.trim()
      ? exportPayload.filename.trim()
      : typeof data?.gemini_export_filename === 'string' && data.gemini_export_filename.trim()
        ? data.gemini_export_filename.trim()
      : 'Gemini Chat Export.pdf';

    const themeFromStorage = typeof exportPayload?.theme === 'string'
      ? exportPayload.theme
      : typeof data?.gemini_export_theme === 'string'
        ? data.gemini_export_theme
      : '';
    const theme = normalizeTheme((themeFromQuery || themeFromStorage || 'theme-notion').trim());
    document.documentElement.lang = normalizeLanguage(exportPayload?.language || languageFromQuery);

    document.title = chatTitle;

    document.body.className = '';
    if (theme) {
      document.body.classList.add(theme);
    }

    mount.innerHTML = html;
    logger.info('[Ghost] HTML 已注入，长度:', html.length);
    logger.info('[Ghost] 注入后 DOM 快照', {
      documentTitle: document.title,
      bodyClassName: document.body.className,
      bodyTextPreview: getBodyTextPreview(),
      containerChildCount: mount.childElementCount,
      containerHtmlPreview: mount.innerHTML.slice(0, 500),
      containerHtmlTail: mount.innerHTML.slice(Math.max(0, mount.innerHTML.length - 500)),
    });

    const attachmentImages = Array.from(mount.querySelectorAll('.message-attachment__image'));
    logger.info('[Ghost] attachment images after inject', {
      attachmentCount: attachmentImages.length,
      attachments: attachmentImages.slice(0, 10).map((img) => summarizeImage(img)),
    });

    if (keepPreviewOpen || debugMode) {
      const debugBanner = document.createElement('div');
      debugBanner.className = 'debug-banner';
      debugBanner.style.cssText = 'position:sticky;top:0;z-index:99999;padding:8px 12px;background:#fff3cd;color:#7a4b00;border-bottom:1px solid #f0d98a;font:12px/1.4 sans-serif;';
      debugBanner.textContent = keepPreviewOpen
        ? copy.debugKeepOpen
        : copy.debugVerbose;
      document.body.insertBefore(debugBanner, document.body.firstChild);
    }

    void (async () => {
      try {
        await waitForNextPaint();

        const tab = await browserApi.tabs.getCurrent();
        logger.info('[Ghost] 当前标签页信息:', tab);

        if (!tab?.id) {
          throw new Error('Unable to get current tab id');
        }

        await waitForImagesReady(mount, logger);

        updateStatusBanner(
          keepPreviewOpen
            ? copy.savingKeepOpenAfterImages
            : copy.savingAutoCloseAfterImages,
        );

        await activateGhostTabIfNeeded(browserApi, tab, keepPreviewOpen);

        logger.info('[Ghost] saveAsPDF phase starting', {
          debugMode,
          tabId: tab.id,
          currentUrl: globalThis.location.href,
          bodyTextPreview: getBodyTextPreview().slice(0, 200),
        });

        const pageSettings = {
          toFileName: exportFilename,
          headerLeft: '',
          headerCenter: '',
          headerRight: '',
          footerLeft: '',
          footerCenter: '',
          footerRight: '',
          showBackgroundColors: true,
          showBackgroundImages: true,
        };
        logger.info('[Ghost] saveAsPDF page settings', pageSettings);

        // 不同 Firefox 版本对 saveAsPDF 参数签名存在差异：
        // 有的要求 pageSettings 对象，有的可不传参。
        let saveResult;
        try {
          logger.info('[Ghost] 尝试使用 saveAsPDF(pageSettings) 导出');
          saveResult = await browserApi.tabs.saveAsPDF(pageSettings);
        } catch (firstError) {
          logger.warn('[Ghost] saveAsPDF(pageSettings) 失败，回退到 saveAsPDF({}):', firstError);
          try {
            saveResult = await browserApi.tabs.saveAsPDF({});
          } catch (secondError) {
            logger.warn('[Ghost] saveAsPDF({}) 失败，回退到无参调用:', secondError);
            saveResult = await browserApi.tabs.saveAsPDF();
          }
        }

        await Promise.resolve(saveResult).then(async (result) => {
          updateStatusBanner(
            keepPreviewOpen
              ? copy.completeKeepOpen
              : copy.completeAutoClose,
            { complete: true },
          );

          logger.info('[Ghost] saveAsPDF Promise resolved.', {
            result,
            tabId: tab.id,
            currentUrl: globalThis.location.href,
            keepPreviewOpen,
            note: keepPreviewOpen
              ? 'Ghost tab remains open for inspection.'
              : 'Ghost tab will auto-close after PDF generation.',
          });

          await restorePreviousTab(browserApi, exportPayload, tab, keepPreviewOpen);
        });
      } catch (error) {
        logger.error(copy.crash, error);
      }
    })();
  } catch (error) {
    console.error('[Gemini Chat Exporter] Ghost initialization failed:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRender);
} else {
  initRender();
}

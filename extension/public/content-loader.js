// Firefox compatibility loader: run as a classic content script and load the ESM bundle once.
(function loadGeminiChatExporterContent() {
  if (globalThis.__GCE_CONTENT_MODULE_LOADING__) {
    return;
  }

  globalThis.__GCE_CONTENT_MODULE_LOADING__ = true;

  const runtime = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;
  if (!runtime?.getURL) {
    console.error('[Gemini Chat Exporter] Failed to load content module: runtime.getURL is unavailable');
    return;
  }

  import(runtime.getURL('content.js')).catch((error) => {
    console.error('[Gemini Chat Exporter] Failed to load content module:', error);
    globalThis.__GCE_CONTENT_MODULE_LOADING__ = false;
  });
})();

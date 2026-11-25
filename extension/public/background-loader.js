// Firefox compatibility loader: run as a classic background script and load the ESM bundle.
import('./background.js').catch((error) => {
  console.error('[Gemini Chat Exporter] Failed to load background module:', error);
});

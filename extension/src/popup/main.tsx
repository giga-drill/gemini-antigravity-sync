// src/popup/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ensureI18nInitialized } from '@/i18n';
import '@/styles/global.css';
import App from './App';

async function bootstrap() {
  const startedAt = performance.now();

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  console.info('[GCE][popup-bootstrap] root rendered', {
    durationMs: Math.round(performance.now() - startedAt),
  });

  try {
    await ensureI18nInitialized();
    console.info('[GCE][popup-bootstrap] i18n initialized', {
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    console.error('[GCE][popup-bootstrap] i18n initialization failed', {
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

void bootstrap();

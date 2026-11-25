// src/i18n/index.ts — 多语言初始化 (react-i18next)

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { detectBrowserLanguage, resolvePreferredLanguage } from '@/shared/language';
import en from './en.json';
import zhCN from './zh-CN.json';

const resources = {
  'en-US': { translation: en },
  'zh-CN': { translation: zhCN },
};

let initPromise: Promise<typeof i18n> | null = null;

export function ensureI18nInitialized(): Promise<typeof i18n> {
  if (!initPromise) {
    initPromise = (async () => {
      const initialLanguage = detectBrowserLanguage();

      if (!i18n.isInitialized) {
        await i18n.use(initReactI18next).init({
          resources,
          lng: initialLanguage,
          fallbackLng: 'en-US',
          interpolation: {
            escapeValue: false, // React 已自动转义
          },
        });
      }

      const resolvedLanguage = await resolvePreferredLanguage({
        fallbackLanguage: initialLanguage,
      });

      if (i18n.language !== resolvedLanguage) {
        await i18n.changeLanguage(resolvedLanguage);
      }

      return i18n;
    })();
  }

  return initPromise;
}

export default i18n;

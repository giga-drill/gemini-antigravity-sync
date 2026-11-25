import { browser } from '@/shared/browser-api';
import type { UserSettings } from '@/types/models';

export const USER_LANGUAGE_STORAGE_KEY = 'user_lang';
export const SETTINGS_STORAGE_KEY = 'user_settings';
export const LEGACY_LANGUAGE_STORAGE_KEY = 'gce_language';

export function normalizeAppLanguage(value: unknown): UserSettings['language'] | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes('zh')) {
    return 'zh-CN';
  }

  if (normalized === 'en' || normalized.startsWith('en')) {
    return 'en-US';
  }

  return null;
}

export function detectBrowserLanguage(): UserSettings['language'] {
  const uiLanguage = (() => {
    try {
      if (typeof browser.i18n?.getUILanguage === 'function') {
        return browser.i18n.getUILanguage();
      }
    } catch {
      // Ignore browser i18n access failures and fall back to navigator.language.
    }

    return globalThis.navigator?.language;
  })();

  return normalizeAppLanguage(uiLanguage) ?? 'en-US';
}

export async function resolvePreferredLanguage(options?: {
  fallbackLanguage?: unknown;
  migrateLegacyLanguage?: boolean;
}): Promise<UserSettings['language']> {
  try {
    const stored = await browser.storage.local.get([USER_LANGUAGE_STORAGE_KEY, SETTINGS_STORAGE_KEY]);

    const explicitLanguage = normalizeAppLanguage(stored[USER_LANGUAGE_STORAGE_KEY]);
    if (explicitLanguage) {
      return explicitLanguage;
    }

    const settingsLanguage = normalizeAppLanguage(
      (stored[SETTINGS_STORAGE_KEY] as { language?: unknown } | undefined)?.language,
    );
    if (settingsLanguage) {
      void browser.storage.local.set({ [USER_LANGUAGE_STORAGE_KEY]: settingsLanguage }).catch(() => {
        // Ignore migration persistence failures.
      });
      return settingsLanguage;
    }
  } catch {
    // Ignore browser storage failures and continue resolving language.
  }

  const fallbackLanguage = normalizeAppLanguage(options?.fallbackLanguage);
  if (fallbackLanguage) {
    return fallbackLanguage;
  }

  if (options?.migrateLegacyLanguage !== false) {
    try {
      const legacyLanguage = normalizeAppLanguage(globalThis.localStorage?.getItem(LEGACY_LANGUAGE_STORAGE_KEY));
      if (legacyLanguage) {
        void browser.storage.local.set({ [USER_LANGUAGE_STORAGE_KEY]: legacyLanguage }).catch(() => {
          // Ignore migration persistence failures.
        });
        return legacyLanguage;
      }
    } catch {
      // Ignore localStorage failures and continue with browser language sniffing.
    }
  }

  return detectBrowserLanguage();
}

export async function persistPreferredLanguage(
  language: unknown,
): Promise<UserSettings['language'] | null> {
  const normalized = normalizeAppLanguage(language);
  if (!normalized) {
    return null;
  }

  await browser.storage.local.set({ [USER_LANGUAGE_STORAGE_KEY]: normalized });

  try {
    globalThis.localStorage?.setItem(LEGACY_LANGUAGE_STORAGE_KEY, normalized);
  } catch {
    // Ignore localStorage persistence failures.
  }

  return normalized;
}
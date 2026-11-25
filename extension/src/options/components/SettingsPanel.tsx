// src/options/components/SettingsPanel.tsx — 用户设置面板

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { browser, sendMessageToBackground } from '@/shared/browser-api';
import { persistPreferredLanguage } from '@/shared/language';
import type { UserSettings } from '@/types/models';
import { DEFAULT_SETTINGS, USER_INPUT_IMAGE_EXPORT_ENABLED } from '@/types/models';

type SaveState = 'idle' | 'saved';

const SETTINGS_STORAGE_KEY = 'user_settings';

export default function SettingsPanel() {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    sendMessageToBackground<{ success: boolean; data?: UserSettings }>({
      action: 'GET_SETTINGS',
    }).then((res) => {
      if (res.success && res.data) {
        setSettings(res.data);
        if (i18n.language !== res.data.language) {
          void i18n.changeLanguage(res.data.language);
        }
      }
    });

    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, [i18n]);

  const updateField = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaveState('idle');
  };

  const handleSave = async () => {
    if (saveState !== 'idle') {
      return;
    }

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    setSaveState('saved');

    try {
      await browser.storage.local.set({
        [SETTINGS_STORAGE_KEY]: settings,
      });
      await sendMessageToBackground({ action: 'SAVE_SETTINGS', settings });

      await persistPreferredLanguage(settings.language);
      // 同步 i18n 语言
      if (i18n.language !== settings.language) {
        void i18n.changeLanguage(settings.language);
      }

      resetTimerRef.current = window.setTimeout(() => {
        setSaveState('idle');
        resetTimerRef.current = null;
      }, 2000);
    } catch (error) {
      setSaveState('idle');
      console.error('[Options] Failed to save settings:', error);
    }
  };

  const isButtonDisabled = saveState !== 'idle';
  const buttonText = saveState === 'saved' ? `✅ ${t('settings.saved')}` : t('settings.save');
  const buttonClassName = saveState === 'saved'
    ? 'rounded-xl bg-[#10b981] px-6 py-2.5 font-medium text-white cursor-not-allowed'
    : 'rounded-xl bg-blue-600 px-6 py-2.5 font-medium text-white hover:bg-blue-700';

  return (
    <div className="w-full max-w-none space-y-5">
      {/* 语言 */}
      <SettingRow label={t('settings.language')}>
        <select
          value={settings.language}
          onChange={(e) => updateField('language', e.target.value as UserSettings['language'])}
          className="min-w-[220px] rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="zh-CN">中文</option>
          <option value="en-US">English</option>
        </select>
      </SettingRow>

      {/* 默认导出格式 */}
      <SettingRow label={t('settings.defaultFormat')}>
        <select
          value={settings.defaultExportFormat}
          onChange={(e) =>
            updateField('defaultExportFormat', e.target.value as 'markdown' | 'pdf' | 'html' | 'txt')
          }
          className="min-w-[220px] rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="markdown">Markdown</option>
          <option value="pdf">PDF</option>
          <option value="html">HTML</option>
          <option value="txt">TXT</option>
        </select>
      </SettingRow>

      {/* 默认输出方式 */}
      <SettingRow label={t('settings.defaultOutputMode')}>
        <select
          value={settings.defaultOutputMode}
          onChange={(e) =>
            updateField('defaultOutputMode', e.target.value as UserSettings['defaultOutputMode'])
          }
          className="min-w-[220px] rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="download">{t('popup.download')}</option>
          <option value="clipboard">{t('popup.clipboard')}</option>
        </select>
      </SettingRow>

      <SettingRow label={t('settings.userLabelMode')}>
        <select
          value={settings.userLabelMode}
          onChange={(e) =>
            updateField('userLabelMode', e.target.value as UserSettings['userLabelMode'])
          }
          className="min-w-[220px] rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="you">{t('settings.userLabelYou')}</option>
          <option value="account-name">{t('settings.userLabelAccountName')}</option>
        </select>
      </SettingRow>

      {USER_INPUT_IMAGE_EXPORT_ENABLED && (
        <SettingRow
          label={t('settings.exportImages')}
          description={t('settings.exportImagesHint')}
        >
          <label className="inline-flex items-center gap-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settings.includeImages}
              onChange={(e) => updateField('includeImages', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>{settings.includeImages ? t('settings.enabled') : t('settings.disabled')}</span>
          </label>
        </SettingRow>
      )}

      {/* 保存按钮 */}
      <div className="flex items-center gap-3 pt-2">
        <button
          id="save-btn"
          onClick={handleSave}
          disabled={isButtonDisabled}
          className={buttonClassName}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-6 py-5 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="max-w-[320px] min-w-0">
        <label className="block text-base font-semibold leading-6 text-gray-700 break-words">{label}</label>
        {description && (
          <p className="mt-1 text-sm leading-5 text-gray-500">{description}</p>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-start md:w-[340px] md:max-w-[340px] md:justify-end">{children}</div>
    </div>
  );
}

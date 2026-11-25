// src/options/App.tsx — Options 设置页

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ReviewFunnelCard from '@/shared/components/ReviewFunnelCard';
import SettingsPanel from './components/SettingsPanel';

export default function App() {
  const { t } = useTranslation();

  useEffect(() => {
    document.body.classList.add('options-page');

    return () => {
      document.body.classList.remove('options-page');
    };
  }, []);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl p-8">
        <div className="rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-8 py-6">
            <h1 className="text-3xl font-bold text-gray-900">{t('settings.title')}</h1>
            <p className="mt-2 text-sm text-gray-500">{t('popup.openOptions')}</p>
          </div>
          <div className="px-8 py-8">
            <SettingsPanel />
          </div>
          <div className="px-8 pb-4">
            <ReviewFunnelCard />
          </div>
        </div>
      </div>
    </main>
  );
}

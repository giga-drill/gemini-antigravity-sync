// src/options/components/SearchBar.tsx — 搜索栏

import { useTranslation } from 'react-i18next';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function SearchBar({ value, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('options.search')}
        className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 bg-white
                   text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
      />
    </div>
  );
}

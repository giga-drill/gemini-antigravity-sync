// src/options/components/Sidebar.tsx — 左侧导航栏

import { useTranslation } from 'react-i18next';

interface Props {
  currentPage: 'chats' | 'settings';
  onNavigate: (page: 'chats' | 'settings') => void;
}

export default function Sidebar({ currentPage, onNavigate }: Props) {
  const { t } = useTranslation();

  const items = [
    { id: 'chats' as const, label: t('options.title'), icon: '💬' },
    { id: 'settings' as const, label: t('settings.title'), icon: '⚙️' },
  ];

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-base font-bold text-blue-700">{t('app.name')}</h2>
      </div>

      {/* 导航项 */}
      <nav className="flex-1 p-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 text-sm font-medium
              flex items-center gap-2 transition-colors
              ${currentPage === item.id
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
              }`}
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}

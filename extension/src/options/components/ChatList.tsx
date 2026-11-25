// src/options/components/ChatList.tsx — 聊天列表 (类邮箱界面)

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessageToBackground } from '@/shared/browser-api';
import type { ChatSessionSummary, UserSettings } from '@/types/models';
import type { GetCachedSessionsResponse, SearchSessionsResponse, BatchDeleteSessionsResponse } from '@/types/messages';
import { DEFAULT_SETTINGS } from '@/types/models';
import SearchBar from './SearchBar';

export default function ChatList() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFromWeb, setDeleteFromWeb] = useState(true);

  const loadSessions = useCallback(async (autoSync = false) => {
    setLoading(true);
    try {
      if (autoSync) {
         setSyncing(true);
         try {
           await sendMessageToBackground<GetCachedSessionsResponse>({
             action: 'SYNC_WEB_SESSIONS',
           });
         } catch(e) {
           console.error('Auto sync failed:', e);
         } finally {
           setSyncing(false);
         }
      }

      let res: GetCachedSessionsResponse | SearchSessionsResponse;
      if (search.trim()) {
        res = await sendMessageToBackground<SearchSessionsResponse>({
          action: 'SEARCH_SESSIONS',
          query: search,
        });
      } else {
        res = await sendMessageToBackground<GetCachedSessionsResponse>({
          action: 'GET_CACHED_SESSIONS',
        });
      }
      if (res.success && res.data) {
        setSessions(res.data);
      }
    } finally {
      setLoading(false);
    }
  }, [search]);

  // 组件装载时自动静默同步一次官网全量数据，增强用户体验 (Issue 3)
  useEffect(() => {
    let active = true;
    const initialLoad = async () => {
      // 1. 先用本地数据快速呈现
      setLoading(true);
      const resLocal = await sendMessageToBackground<GetCachedSessionsResponse>({ action: 'GET_CACHED_SESSIONS' });
      if (resLocal.success && resLocal.data && active) setSessions(resLocal.data);
      if (active) setLoading(false); // 改进：取完本地缓存后立刻解除加载状态，允许用户使用！
      
      // 2. 后台静默触发同步
      setSyncing(true);
      try {
        const resSync = await sendMessageToBackground<GetCachedSessionsResponse>({ action: 'SYNC_WEB_SESSIONS' });
        if (resSync.success && resSync.data && active) {
           setSessions(prev => resSync.data || prev);
        }
      } catch (e) {
        console.error('Auto sync failed:', e);
      } finally {
        if (active) {
           setSyncing(false);
        }
      }
    };
    initialLoad();
    return () => { active = false };
  }, []); // 仅挂载执行一次

  // 搜索框变化时进行本地结果过滤
  useEffect(() => {
    const timer = setTimeout(() => {
        if (!search.trim()) {
           sendMessageToBackground<GetCachedSessionsResponse>({ action: 'GET_CACHED_SESSIONS' })
             .then(res => {
                 if (res.success && res.data) setSessions(res.data);
             });
           return;
        }
        sendMessageToBackground<SearchSessionsResponse>({
          action: 'SEARCH_SESSIONS',
          query: search,
        }).then(res => {
            if(res.success && res.data) setSessions(res.data);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === sessions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sessions.map((s) => s.id)));
    }
  };

  const handleBatchExport = async (format: 'markdown' | 'pdf' | 'html' | 'txt') => {
    if (selected.size === 0) return;

    const settingsRes = await sendMessageToBackground<{ success: boolean; data?: UserSettings }>({
      action: 'GET_SETTINGS',
    });
    const settings = settingsRes.data ?? DEFAULT_SETTINGS;

    await sendMessageToBackground({
      action: 'BATCH_EXPORT',
      sessionIds: Array.from(selected),
      format,
      settings,
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('options.confirmDelete'))) return;
    await sendMessageToBackground({ action: 'DELETE_CACHED_SESSION', sessionId: id });
    loadSessions();
  };

  const handleSyncWeb = async () => {
    setSyncing(true);
    try {
      const res = await sendMessageToBackground<GetCachedSessionsResponse>({
        action: 'SYNC_WEB_SESSIONS',
      });
      if (res.success && res.data) {
        setSessions(res.data);
      } else {
        alert(t('options.syncFailed', { error: res.error || 'Unknown error' }));
      }
    } catch (e) {
      alert(t('options.syncFailed', { error: String(e) }));
    } finally {
      setSyncing(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selected.size === 0) return;

    const message = deleteFromWeb
      ? t('options.confirmBatchDeleteWithWeb', { count: selected.size })
      : t('options.confirmBatchDelete', { count: selected.size });

    if (!confirm(message)) return;

    setDeleting(true);
    try {
      const res = await sendMessageToBackground<BatchDeleteSessionsResponse>({
        action: 'BATCH_DELETE_SESSIONS',
        sessionIds: Array.from(selected),
        deleteFromWeb,
      });

      if (res.success) {
        setSelected(new Set());
        await loadSessions();
      } else {
        alert(`删除失败: ${res.error || '未知错误'}`);
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 搜索栏 */}
      <SearchBar value={search} onChange={setSearch} />

      {/* 工具栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={sessions.length > 0 && selected.size === sessions.length}
            onChange={toggleSelectAll}
            className="rounded"
          />
          {t('options.selectAll')}
        </label>

        {selected.size > 0 && (
          <div className="flex gap-2 ml-auto flex-wrap items-center">
            {/* 同步按钮 */}
            <button
              onClick={handleSyncWeb}
              disabled={syncing}
              className="px-3 py-1.5 text-xs bg-indigo-100 text-indigo-700 rounded-md hover:bg-indigo-200 transition-colors disabled:opacity-50"
            >
              🔄 {syncing ? t('options.syncing') : t('options.syncWeb')}
            </button>
            <div className="w-px h-4 bg-gray-300 mx-1"></div>
            {/* 导出按钮 */}
            <button
              onClick={() => handleBatchExport('markdown')}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              📝 Markdown ({selected.size})
            </button>
            <button
              onClick={() => handleBatchExport('pdf')}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            >
              📄 PDF ({selected.size})
            </button>

            {/* 删除按钮和选项 */}
            <div className="flex gap-2 items-center pl-2 border-l border-gray-300">
              <label className="flex items-center gap-2 text-xs text-gray-600 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={deleteFromWeb}
                  onChange={(e) => setDeleteFromWeb(e.target.checked)}
                  disabled={deleting}
                  className="rounded"
                />
                {t('options.syncDelete')}
              </label>
              <button
                onClick={handleBatchDelete}
                disabled={deleting}
                className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-red-400 transition-colors"
              >
                {deleting ? '删除中...' : `🗑️ 删除 (${selected.size})`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex flex-col items-center justify-center text-gray-400 py-16">
          <div className="inline-block animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mb-4"></div>
          <div className="text-sm">正在加载中...</div>
        </div>
      ) : sessions.length === 0 && syncing ? (
        <div className="flex flex-col items-center justify-center text-indigo-500 py-16 px-4 text-center">
          <div className="inline-block animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mb-4"></div>
          <div className="text-sm font-medium mb-1">正在远端拉取最新会话...</div>
          <div className="text-xs text-gray-400">首次同步或数据较多时耗时较长，请稍候...</div>
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center text-gray-400 py-12">{t('options.noResults')}</div>
      ) : (
        <>
          <div className="text-sm text-gray-500">
            {t('options.showingChats', { count: sessions.length })}
          </div>
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors
                  ${selected.has(session.id) ? 'bg-blue-50' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(session.id)}
                  onChange={() => toggleSelect(session.id)}
                  className="rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">
                    {session.title}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {t('options.messages', { count: session.messageCount })}
                    {' · '}
                    {t('options.exportedAt', {
                      date: new Date(session.exportDate).toLocaleDateString(),
                    })}
                    {session.modelVersion && ` · ${session.modelVersion}`}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(session.id)}
                  className="text-gray-400 hover:text-red-500 text-sm px-2 py-1 transition-colors"
                  title={t('options.delete')}
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

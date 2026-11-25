(async function initPreviewPage() {
  const toolbar = document.getElementById('toolbar');
  const chatContainer = document.getElementById('chat-container');
  const exportBtn = document.getElementById('btn-export-pdf');

  if (!toolbar || !chatContainer || !exportBtn) {
    return;
  }

  const browserApi = globalThis.browser;
  if (!browserApi?.storage?.local?.get) {
    chatContainer.textContent = 'browser.storage.local 不可用，无法加载聊天内容。';
    return;
  }

  const data = await browserApi.storage.local.get('gemini_chat_html');
  const html = data?.gemini_chat_html;

  if (typeof html === 'string' && html.trim()) {
    chatContainer.innerHTML = html;
  } else {
    chatContainer.innerHTML = '<p>未找到聊天内容，请回到 Gemini 页面重新提取。</p>';
  }

  exportBtn.addEventListener('click', async () => {
    if (!browserApi?.tabs?.getCurrent || !browserApi?.tabs?.saveAsPDF) {
      alert('当前 Firefox 版本不支持 tabs.saveAsPDF。');
      return;
    }

    exportBtn.disabled = true;
    const prevDisplay = toolbar.style.display;

    try {
      toolbar.style.display = 'none';
      const currentTab = await browserApi.tabs.getCurrent();
      if (!currentTab?.id) {
        throw new Error('无法获取当前标签页 ID');
      }

      await browserApi.tabs.saveAsPDF({ tabId: currentTab.id });
    } catch (err) {
      console.error('[Gemini Chat Exporter] saveAsPDF failed:', err);
      alert('导出 PDF 失败：' + (err && err.message ? err.message : String(err)));
    } finally {
      toolbar.style.display = prevDisplay;
      exportBtn.disabled = false;
    }
  });
})();

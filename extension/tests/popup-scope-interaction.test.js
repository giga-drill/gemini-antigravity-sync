const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { act, fireEvent, render, screen, waitFor } = require('@testing-library/react');
const App = require('@/popup/App').default;
const StatusBar = require('@/popup/components/StatusBar').default;

const popupHtmlPath = path.resolve(process.cwd(), 'src/popup/index.html');

function getDefaultSettings() {
  return {
    language: 'en-US',
    defaultExportFormat: 'markdown',
    defaultOutputMode: 'download',
    userLabelMode: 'you',
    includeImages: false,
  };
}

function loadPopupHtml() {
  const html = fs.readFileSync(popupHtmlPath, 'utf8');
  const bodyMarkup = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '<div id="root"></div>';
  document.body.innerHTML = bodyMarkup;
}

function installBackgroundResponder(settings = getDefaultSettings()) {
  const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
  browserMock.runtime.sendMessage.mockImplementation(async (message) => {
    switch (message.action) {
      case 'PING':
        return { success: true };
      case 'GET_SETTINGS':
        return { success: true, data: settings };
      default:
        return { success: true };
    }
  });
}

function renderPopupApp() {
  return render(React.createElement(App));
}

beforeEach(() => {
  loadPopupHtml();
  installBackgroundResponder();
});

test('disables the All History scope option and falls back to Current Chat when clipboard mode is selected', async () => {
  renderPopupApp();

  const allHistoryButton = await screen.findByRole('button', { name: /all history/i });
  const currentChatButton = screen.getByRole('button', { name: /current chat/i });
  const clipboardButton = screen.getByRole('button', { name: /copy to clipboard/i });

  fireEvent.click(allHistoryButton);
  expect(allHistoryButton).toHaveClass('active');

  fireEvent.click(clipboardButton);

  await waitFor(() => {
    expect(allHistoryButton).toBeDisabled();
  });

  expect(allHistoryButton).toHaveClass('disabled-option');
  expect(allHistoryButton).toHaveAttribute('title', '剪贴板容量有限，批量导出历史记录请切换为「下载为文件」');
  expect(currentChatButton).toHaveClass('active');
});

test('re-enables the All History scope option when download mode is selected again', async () => {
  renderPopupApp();

  const allHistoryButton = await screen.findByRole('button', { name: /all history/i });
  const clipboardButton = screen.getByRole('button', { name: /copy to clipboard/i });
  const downloadButton = screen.getByRole('button', { name: /download as file/i });

  fireEvent.click(clipboardButton);
  await waitFor(() => {
    expect(allHistoryButton).toBeDisabled();
  });

  fireEvent.click(downloadButton);

  await waitFor(() => {
    expect(allHistoryButton).not.toBeDisabled();
  });

  expect(allHistoryButton).not.toHaveClass('disabled-option');
  expect(allHistoryButton).not.toHaveAttribute('title', '剪贴板容量有限，批量导出历史记录请切换为「下载为文件」');
});

test('falls back to download mode and disables clipboard when PDF format is selected', async () => {
  renderPopupApp();

  const pdfButton = await screen.findByRole('button', { name: /^📄\s*pdf$/i });
  const downloadButton = screen.getByRole('button', { name: /download as file/i });
  const clipboardButton = screen.getByRole('button', { name: /copy to clipboard/i });

  fireEvent.click(clipboardButton);
  expect(clipboardButton).toHaveClass('active');

  fireEvent.click(pdfButton);

  await waitFor(() => {
    expect(downloadButton).toHaveClass('active');
  });

  expect(clipboardButton).toBeDisabled();
  expect(clipboardButton).toHaveClass('disabled');
  expect(clipboardButton).not.toHaveClass('active');
});

test('re-enables clipboard when switching away from PDF format', async () => {
  renderPopupApp();

  const pdfButton = await screen.findByRole('button', { name: /^📄\s*pdf$/i });
  const markdownButton = screen.getByRole('button', { name: /^📝\s*markdown$/i });
  const clipboardButton = screen.getByRole('button', { name: /copy to clipboard/i });

  fireEvent.click(pdfButton);

  await waitFor(() => {
    expect(clipboardButton).toBeDisabled();
  });

  fireEvent.click(markdownButton);

  await waitFor(() => {
    expect(clipboardButton).not.toBeDisabled();
  });

  expect(clipboardButton).not.toHaveClass('disabled');
});

test('disables Send to NotebookLM until Copy to Clipboard is selected', async () => {
  renderPopupApp();
  await screen.findByRole('button', { name: /export and save/i });

  const notebookButton = screen.getByRole('button', { name: /send to notebooklm/i });

  expect(notebookButton).toBeDisabled();
  expect(notebookButton).toHaveClass('disabled');
  expect(notebookButton).toHaveAttribute('title', 'Switch Output Mode to Copy to Clipboard to use NotebookLM.');
});

test('enables Send to NotebookLM after Copy to Clipboard is selected', async () => {
  renderPopupApp();
  await screen.findByRole('button', { name: /export and save/i });

  const clipboardButton = screen.getByRole('button', { name: /copy to clipboard/i });
  const notebookButton = screen.getByRole('button', { name: /send to notebooklm/i });

  fireEvent.click(clipboardButton);

  await waitFor(() => {
    expect(notebookButton).not.toBeDisabled();
  });

  expect(notebookButton).not.toHaveClass('disabled');
  expect(notebookButton).not.toHaveAttribute('title', 'Switch Output Mode to Copy to Clipboard to use NotebookLM.');
});

test('disables Send to NotebookLM again when switching back to Download as File', async () => {
  renderPopupApp();
  await screen.findByRole('button', { name: /export and save/i });

  const clipboardButton = screen.getByRole('button', { name: /copy to clipboard/i });
  const downloadButton = screen.getByRole('button', { name: /download as file/i });
  const notebookButton = screen.getByRole('button', { name: /send to notebooklm/i });

  fireEvent.click(clipboardButton);

  await waitFor(() => {
    expect(notebookButton).not.toBeDisabled();
  });

  fireEvent.click(downloadButton);

  await waitFor(() => {
    expect(notebookButton).toBeDisabled();
  });

  expect(notebookButton).toHaveClass('disabled');
  expect(notebookButton).toHaveAttribute('title', 'Switch Output Mode to Copy to Clipboard to use NotebookLM.');
});

test('restores the latest popup selection when the popup is reopened in the same browser session', async () => {
  const firstRender = renderPopupApp();
  await screen.findByRole('button', { name: /export and save/i });

  fireEvent.click(screen.getByRole('button', { name: /^🌐\s*html$/i }));
  fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));
  fireEvent.click(screen.getByRole('button', { name: /selected content/i }));

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^🌐\s*html$/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /copy to clipboard/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /selected content/i })).toHaveClass('active');
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });

  firstRender.unmount();

  renderPopupApp();
  await screen.findByRole('button', { name: /export and save/i });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^🌐\s*html$/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /copy to clipboard/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /selected content/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /send to notebooklm/i })).not.toBeDisabled();
  });
});

test('switching from PDF back to Markdown stays responsive even if popup preference persistence is slow', async () => {
  const { storageSession } = globalThis.__EXTENSION_TEST_UTILS__;
  let releasePersist;

  storageSession.set.mockImplementation(async (items) => {
    if (items.gce_popup_session_selection) {
      await new Promise((resolve) => {
        releasePersist = resolve;
      });
    }
  });

  renderPopupApp();
  await screen.findByRole('button', { name: /export and save/i });

  const pdfButton = screen.getByRole('button', { name: /^📄\s*pdf$/i });
  const markdownButton = screen.getByRole('button', { name: /^📝\s*markdown$/i });

  fireEvent.click(pdfButton);

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });

  fireEvent.click(markdownButton);

  expect(markdownButton).toHaveClass('active');
  expect(pdfButton).not.toHaveClass('active');

  await act(async () => {
    releasePersist?.();
  });
});

test('shows detailed All History progress for current chat and overall status', () => {
  render(React.createElement(StatusBar, {
    state: 'exportingAll',
    error: '',
    exportAllProgress: {
      total: 4,
      exported: 1,
      processed: 1,
      currentIndex: 2,
      currentTitle: 'Chat 2',
      currentProgress: 50,
      phase: 'extracting-chat',
    },
  }));

  expect(screen.getByText('Extracting chat 2/4...')).toBeInTheDocument();
  expect(screen.getByText('Chat 2/4 · Exported 1')).toBeInTheDocument();
  expect(screen.getByText('38%')).toBeInTheDocument();
});

test('shows a friendly guidance card for non-Gemini pages and can open Gemini directly', () => {
  const onOpenGemini = jest.fn();

  render(React.createElement(StatusBar, {
    state: 'error',
    error: 'Please open a Gemini chat page on https://gemini.google.com/ and try again.',
    onOpenGemini,
  }));

  expect(screen.getByText('Quick setup')).toBeInTheDocument();
  expect(screen.getByText('Open a Gemini chat to start exporting')).toBeInTheDocument();
  expect(screen.getByText('This exporter works on Gemini conversation pages. Open any chat on gemini.google.com, then come back and try again.')).toBeInTheDocument();
  expect(screen.getByText('Tip: once the chat page is open, you can export the current chat, selected content, or your full history from here.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Open Gemini' }));
  expect(onOpenGemini).toHaveBeenCalledTimes(1);
});

test('opens a Gemini tab instead of showing only a red error when export starts on a non-Gemini page', async () => {
  const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;

  browserMock.runtime.sendMessage.mockImplementation(async (message) => {
    switch (message.action) {
      case 'PING':
        return { success: true };
      case 'GET_SETTINGS':
        return { success: true, data: getDefaultSettings() };
      case 'EXTRACT_CURRENT_CHAT':
        return {
          success: false,
          error: 'Please open a Gemini chat page on https://gemini.google.com/ and try again.',
        };
      default:
        return { success: true };
    }
  });

  renderPopupApp();

  fireEvent.click(await screen.findByRole('button', { name: /export and save/i }));

  expect(await screen.findByText('Open a Gemini chat to start exporting')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Open Gemini' }));

  await waitFor(() => {
    expect(browserMock.tabs.create).toHaveBeenCalledWith({ url: 'https://gemini.google.com' });
  });
});

test('current chat PDF export closes the popup instead of showing a premature success state', async () => {
  const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;

  browserMock.runtime.sendMessage.mockImplementation(async (message) => {
    switch (message.action) {
      case 'PING':
        return { success: true };
      case 'GET_SETTINGS':
        return { success: true, data: getDefaultSettings() };
      case 'EXTRACT_GEMINI_CHAT_HTML':
        return { success: true };
      default:
        return { success: true };
    }
  });

  renderPopupApp();

  fireEvent.click(await screen.findByRole('button', { name: /^📄\s*pdf$/i }));
  fireEvent.click(screen.getByRole('button', { name: /export and save/i }));

  await waitFor(() => {
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXTRACT_GEMINI_CHAT_HTML',
    }));
  });

  await waitFor(() => {
    expect(globalThis.close).toHaveBeenCalledTimes(1);
  });

  expect(screen.queryByText('Export Successful!')).not.toBeInTheDocument();
});

test('disables all popup buttons while Export and Save is running', async () => {
  const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
  let releaseExtract;

  browserMock.runtime.sendMessage.mockImplementation(async (message) => {
    switch (message.action) {
      case 'PING':
        return { success: true };
      case 'GET_SETTINGS':
        return { success: true, data: getDefaultSettings() };
      case 'EXTRACT_CURRENT_CHAT':
        await new Promise((resolve) => {
          releaseExtract = resolve;
        });
        return { cancelled: true };
      default:
        return { success: true };
    }
  });

  renderPopupApp();

  fireEvent.click(await screen.findByRole('button', { name: /export and save/i }));

  await waitFor(() => {
    expect(screen.getByText('Extracting data...')).toBeInTheDocument();
  });

  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled();
  }

  await act(async () => {
    releaseExtract?.();
  });
});

test('shows the exporting state immediately while the background wakes up', async () => {
  const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
  let releasePing;

  renderPopupApp();
  const exportButton = await screen.findByRole('button', { name: /export and save/i });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });

  browserMock.runtime.sendMessage.mockImplementation(async (message) => {
    switch (message.action) {
      case 'PING':
        await new Promise((resolve) => {
          releasePing = resolve;
        });
        return { success: true };
      case 'EXTRACT_CURRENT_CHAT':
        return { cancelled: true };
      default:
        return { success: true };
    }
  });

  fireEvent.click(exportButton);

  await waitFor(() => {
    expect(screen.getByText('Extracting data...')).toBeInTheDocument();
    expect(exportButton).toBeDisabled();
  });

  await act(async () => {
    releasePing?.();
  });
});

test('initializes popup only once when saved settings switch the language', async () => {
  const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
  globalThis.__TEST_I18N__.language = 'en-US';

  installBackgroundResponder({
    ...getDefaultSettings(),
    language: 'zh-CN',
  });

  renderPopupApp();

  await screen.findByRole('button', { name: /export and save/i });

  await waitFor(() => {
    expect(globalThis.__TEST_I18N__.changeLanguage).toHaveBeenCalledWith('zh-CN');
  });

  const actions = browserMock.runtime.sendMessage.mock.calls.map(([message]) => message.action);
  expect(actions.filter((action) => action === 'PING')).toHaveLength(1);
  expect(actions.filter((action) => action === 'GET_SETTINGS')).toHaveLength(1);
});

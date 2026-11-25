const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { fireEvent, render, screen, waitFor } = require('@testing-library/react');
const App = require('@/popup/App').default;

const popupHtmlPath = path.resolve(process.cwd(), 'src/popup/index.html');

function getDefaultSettings() {
  return {
    language: 'en-US',
    defaultExportFormat: 'markdown',
    defaultOutputMode: 'download',
    userLabelMode: 'you',
    includeImages: false,
    imageQuality: 0.8,
    maxImageWidth: 1200,
  };
}

function loadPopupHtml() {
  const html = fs.readFileSync(popupHtmlPath, 'utf8');
  const bodyMarkup = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '<div id="root"></div>';
  document.body.innerHTML = bodyMarkup;
}

function installBackgroundResponder({ extractCurrentChat, cleanHtml = '' } = {}) {
  const { browserMock, storageLocal } = globalThis.__EXTENSION_TEST_UTILS__;
  storageLocal.__setStore({ gemini_clean_html: cleanHtml });
  browserMock.runtime.sendMessage.mockImplementation(async (message) => {
    switch (message.action) {
      case 'PING':
        return { success: true };
      case 'GET_SETTINGS':
        return { success: true, data: getDefaultSettings() };
      case 'EXTRACT_CURRENT_CHAT':
        return extractCurrentChat?.(message) ?? { success: false, error: 'missing extract mock' };
      default:
        return { success: true };
    }
  });
}

function renderPopupApp() {
  return render(React.createElement(App));
}

test('builds NotebookLM text from extracted session messages with YOU and GEMINI prefixes', async () => {
  loadPopupHtml();
  installBackgroundResponder({
    extractCurrentChat: () => ({
      success: true,
      data: {
        id: 'chat-1',
        title: 'Test Chat',
        author: 'Tester',
        url: 'https://gemini.google.com/test',
        exportDate: Date.now(),
        messages: [
          { role: 'user', content: 'Hello\nWorld', images: [] },
          { role: 'model', content: 'Hi there', images: [] },
        ],
      },
    }),
  });

  renderPopupApp();

  fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));
  fireEvent.click(await screen.findByRole('button', { name: /send to notebooklm/i }));

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('**YOU**:\nHello\nWorld\n\n**GEMINI**:\nHi there');
  });

  expect(globalThis.__EXTENSION_TEST_UTILS__.chromeMock.tabs.create).toHaveBeenCalledTimes(1);
});

test('falls back to parsing chat HTML into NotebookLM text with role-based prefixes', async () => {
  loadPopupHtml();
  installBackgroundResponder({
    cleanHtml: `
      <div class="chat-turn role-user"><div class="turn-content">  Hello from HTML  </div></div>
      <div class="chat-turn role-ai"><div class="turn-content">Reply from HTML</div></div>
    `,
    extractCurrentChat: () => ({
      success: true,
      data: {
        id: 'chat-2',
        title: 'HTML Chat',
        author: 'Tester',
        url: 'https://gemini.google.com/test',
        exportDate: Date.now(),
        messages: [],
      },
    }),
  });

  renderPopupApp();

  fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));
  fireEvent.click(await screen.findByRole('button', { name: /send to notebooklm/i }));

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('**YOU**:\nHello from HTML\n\n**GEMINI**:\nReply from HTML');
  });
});

test('tolerates incomplete chat-turn DOM and keeps unlabeled text instead of crashing', async () => {
  loadPopupHtml();
  installBackgroundResponder({
    cleanHtml: `
      <div class="chat-turn role-user"></div>
      <div class="chat-turn"><div class="turn-content">Unlabeled note</div></div>
    `,
    extractCurrentChat: () => ({
      success: true,
      data: {
        id: 'chat-3',
        title: 'Broken HTML Chat',
        author: 'Tester',
        url: 'https://gemini.google.com/test',
        exportDate: Date.now(),
        messages: [],
      },
    }),
  });

  renderPopupApp();

  fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));
  fireEvent.click(await screen.findByRole('button', { name: /send to notebooklm/i }));

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Unlabeled note');
  });
});

const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { render, screen } = require('@testing-library/react');
const App = require('@/popup/App').default;

const popupHtmlPath = path.resolve(process.cwd(), 'src/popup/index.html');
const globalCssPath = path.resolve(process.cwd(), 'src/styles/global.css');

function getDefaultSettings() {
  return {
    language: 'en-US',
    defaultExportFormat: 'markdown',
    defaultOutputMode: 'download',
    userLabelMode: 'you',
    imageQuality: 0.8,
    maxImageWidth: 1200,
  };
}

function loadPopupHtml() {
  const html = fs.readFileSync(popupHtmlPath, 'utf8');
  const bodyMarkup = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '<div id="root"></div>';
  document.body.innerHTML = bodyMarkup;
}

function installBackgroundResponder() {
  const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
  browserMock.runtime.sendMessage.mockImplementation(async (message) => {
    switch (message.action) {
      case 'PING':
        return { success: true };
      case 'GET_SETTINGS':
        return { success: true, data: getDefaultSettings() };
      default:
        return { success: true };
    }
  });
}

beforeEach(() => {
  loadPopupHtml();
  installBackgroundResponder();
});

test('renders popup action buttons with dedicated label wrappers for overflow control', async () => {
  render(React.createElement(App));

  const exportButton = await screen.findByRole('button', { name: /export and save/i });
  const notebookButton = screen.getByRole('button', { name: /send to notebooklm/i });

  const exportLabel = exportButton.querySelector('.action-btn__label');
  const notebookLabel = notebookButton.querySelector('.action-btn__label');

  expect(exportLabel).not.toBeNull();
  expect(notebookLabel).not.toBeNull();
  expect(exportLabel).toHaveTextContent('🚀 Export and Save');
  expect(notebookLabel).toHaveTextContent('🧠 Send to NotebookLM');
});

test('defines CSS overflow guards for popup action button labels', () => {
  const css = fs.readFileSync(globalCssPath, 'utf8');

  expect(css).toMatch(/\.action-btn\s*\{[\s\S]*display:\s*flex;[\s\S]*justify-content:\s*center;[\s\S]*min-width:\s*0;[\s\S]*\}/);
  expect(css).toMatch(/\.action-btn__label\s*\{[\s\S]*max-width:\s*100%;[\s\S]*white-space:\s*nowrap;[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*\}/);
});
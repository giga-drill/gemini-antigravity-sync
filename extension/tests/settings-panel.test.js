const React = require('react');
const { fireEvent, render, screen, waitFor } = require('@testing-library/react');
const SettingsPanel = require('@/options/components/SettingsPanel').default;

describe('settings panel save state', () => {
  test('shows localized saved text in English after saving settings', async () => {
    const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;
    globalThis.__TEST_I18N__.language = 'en-US';

    browserMock.runtime.sendMessage.mockImplementation(async (message) => {
      switch (message.action) {
        case 'GET_SETTINGS':
          return {
            success: true,
            data: {
              language: 'en-US',
              defaultExportFormat: 'markdown',
              defaultOutputMode: 'download',
              userLabelMode: 'you',
              includeImages: false,
            },
          };
        case 'SAVE_SETTINGS':
          return { success: true };
        default:
          return { success: true };
      }
    });

    render(React.createElement(SettingsPanel));

    const button = await screen.findByRole('button', { name: 'Save Settings' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '✅ Settings Saved' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: '✅ 已保存！' })).not.toBeInTheDocument();
    expect(screen.getByText('Only user-uploaded/input images can be exported in this build.')).toBeInTheDocument();
    expect(screen.queryByText('Image Quality')).not.toBeInTheDocument();
    expect(screen.queryByText('Max Image Width (px)')).not.toBeInTheDocument();
  });
});
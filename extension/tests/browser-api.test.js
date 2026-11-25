const { sendMessageToBackground } = require('@/shared/browser-api');

test('sendMessageToBackground retries a transient missing receiver error', async () => {
  const { browserMock } = globalThis.__EXTENSION_TEST_UTILS__;

  browserMock.runtime.sendMessage
    .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ success: true, data: { ok: true } });

  const result = await sendMessageToBackground({ action: 'GET_SETTINGS' });

  expect(result).toEqual({ success: true, data: { ok: true } });
  expect(browserMock.runtime.sendMessage.mock.calls).toEqual([
    [{ action: 'GET_SETTINGS' }],
    [{ action: 'PING' }],
    [{ action: 'GET_SETTINGS' }],
  ]);
});

describe('content image extraction', () => {
  let originalFetch;
  let originalFileReader;
  let browserMock;

  beforeEach(() => {
    jest.resetModules();
    originalFetch = global.fetch;
    originalFileReader = global.FileReader;
    browserMock = globalThis.__EXTENSION_TEST_UTILS__.browserMock;
    browserMock.runtime.sendMessage.mockReset();
    browserMock.runtime.sendMessage.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.FileReader = originalFileReader;
  });

  test('converts uploaded blob images into data URLs for export', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['uploaded-image'], { type: 'image/png' }),
    }));

    class MockFileReader {
      constructor() {
        this.onload = null;
        this.onerror = null;
        this.result = null;
      }

      readAsDataURL() {
        this.result = 'data:image/png;base64,UPLOADED';
        this.onload?.();
      }
    }

    global.FileReader = MockFileReader;

    const { extractImages } = require('@/content/image-extractor');

    document.body.innerHTML = `
      <div id="message">
        <img data-test-id="uploaded-img" alt="Uploaded image preview" class="preview-image" src="blob:https://gemini.google.com/uploaded" />
      </div>
    `;

    const container = document.getElementById('message');
    const images = await extractImages(container);

    expect(images).toEqual(['data:image/png;base64,UPLOADED']);
    expect(global.fetch).toHaveBeenCalledWith('blob:https://gemini.google.com/uploaded');
  });

  test('ignores Gemini generated images because only user-input images are exported now', async () => {
    global.fetch = jest.fn();
    const { extractImages } = require('@/content/image-extractor');

    document.body.innerHTML = `
      <div id="message">
        <img loading="lazy" class="image animate loaded" alt=", AI generated" src="https://lh3.googleusercontent.com/generated-image=s1024-rj" />
      </div>
    `;

    const container = document.getElementById('message');
    const images = await extractImages(container);

    expect(images).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('exports same-origin user-input images when they can be fetched directly', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['same-origin-image'], { type: 'image/png' }),
    }));

    class MockFileReader {
      constructor() {
        this.onload = null;
        this.onerror = null;
        this.result = null;
      }

      readAsDataURL() {
        this.result = 'data:image/png;base64,SAME_ORIGIN';
        this.onload?.();
      }
    }

    global.FileReader = MockFileReader;
    const { extractImages } = require('@/content/image-extractor');

    document.body.innerHTML = `
      <div id="message">
        <img data-test-id="uploaded-img" alt="uploaded attachment" class="preview-image" src="http://localhost/uploaded.png" />
      </div>
    `;

    const container = document.getElementById('message');
    const images = await extractImages(container);

    expect(images).toEqual(['data:image/png;base64,SAME_ORIGIN']);
    expect(global.fetch).toHaveBeenCalledWith('http://localhost/uploaded.png', expect.objectContaining({
      cache: 'force-cache',
      credentials: 'include',
      referrer: 'http://localhost/',
    }));
  });
});

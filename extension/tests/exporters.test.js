const { MarkdownExporter } = require('@/exporters/markdown-exporter');
const { HtmlExporter } = require('@/exporters/html-exporter');
const { TxtExporter } = require('@/exporters/txt-exporter');

function createSettings(overrides = {}) {
  return {
    language: 'en-US',
    defaultExportFormat: 'markdown',
    defaultOutputMode: 'download',
    userLabelMode: 'you',
    includeImages: false,
    ...overrides,
  };
}

function createSession(overrides = {}) {
  return {
    id: 'session-1',
    title: 'Quarterly "Review"\nChat',
    author: 'Ada Lovelace',
    url: 'https://gemini.google.com/share/123',
    exportDate: Date.UTC(2026, 2, 20, 12, 0, 0),
    modelVersion: 'gemini-2.5-pro',
    messages: [
      {
        role: 'user',
        content: 'First line\nSecond line',
        images: ['data:image/png;base64,AAA'],
      },
      {
        role: 'model',
        content: 'Response body',
        images: [],
      },
    ],
    ...overrides,
  };
}

async function readBlob(blob) {
  if (typeof blob.text === 'function') {
    return blob.text();
  }

  if (typeof blob.arrayBuffer === 'function') {
    const buffer = await blob.arrayBuffer();
    return Buffer.from(buffer).toString('utf8');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(blob);
  });
}

test('MarkdownExporter emits frontmatter, normalized user label, and embedded image markup', async () => {
  const exporter = new MarkdownExporter();
  const blob = await exporter.export(
    createSession(),
    createSettings({ userLabelMode: 'account-name', includeImages: true }),
  );
  const markdown = await readBlob(blob);

  expect(markdown).toContain('title: "Quarterly \\"Review\\" Chat"');
  expect(markdown).toContain('author: "Ada Lovelace"');
  expect(markdown).toContain('model: "gemini-2.5-pro"');
  expect(markdown).toContain('### 🧑 **Ada Lovelace**');
  expect(markdown).toContain('First line\nSecond line');
  expect(markdown).toContain('<img src="data:image/png;base64,AAA" alt="conversation image" style="max-width:100%;" />');
  expect(markdown).toContain('### 🤖 **Gemini**');
});

test('TxtExporter falls back to You and reports omitted images in plain text mode', async () => {
  const exporter = new TxtExporter();
  const blob = await exporter.export(
    createSession({ author: 'Unknown User' }),
    createSettings({ userLabelMode: 'account-name', includeImages: true }),
  );
  const text = await readBlob(blob);

  expect(text).toContain('[You]');
  expect(text).toContain('First line\nSecond line');
  expect(text).toContain('[Image(s) omitted in text format: 1 image(s)]');
  expect(text).toContain('[Gemini]');
  expect(text).toContain('Response body');
});

test('HtmlExporter preserves rich contentHtml when plain text fallback is not preferred', async () => {
  const exporter = new HtmlExporter();
  const blob = await exporter.export(
    createSession({
      messages: [
        {
          role: 'user',
          content: 'Ignored plain text',
          contentHtml: '<h2>Rich Heading</h2><p><strong>Bold</strong> body</p>',
          images: ['data:image/png;base64,BBB'],
        },
      ],
    }),
    createSettings({ userLabelMode: 'account-name', includeImages: true }),
  );
  const html = await readBlob(blob);

  expect(html).toContain('<title>Quarterly &quot;Review&quot;\nChat</title>');
  expect(html).toContain('<div class="role">🧑 Ada Lovelace</div>');
  expect(html).toContain('<div class="content"><h2>Rich Heading</h2><p><strong>Bold</strong> body</p></div>');
  expect(html).toContain('<img src="data:image/png;base64,BBB" alt="conversation image" />');
  expect(html).not.toContain('style="white-space:pre-wrap"');
});

test('exporters omit image markup when includeImages is disabled', async () => {
  const markdownExporter = new MarkdownExporter();
  const htmlExporter = new HtmlExporter();

  const markdownBlob = await markdownExporter.export(createSession(), createSettings({ includeImages: false }));
  const htmlBlob = await htmlExporter.export(createSession(), createSettings({ includeImages: false }));

  const markdown = await readBlob(markdownBlob);
  const html = await readBlob(htmlBlob);

  expect(markdown).not.toContain('<img src="data:image/png;base64,AAA"');
  expect(html).not.toContain('<img src="data:image/png;base64,AAA"');
});

test('HtmlExporter can prefer normalized escaped plain text over raw contentHtml', async () => {
  const exporter = new HtmlExporter({ preferPlainText: true });
  const blob = await exporter.export(
    createSession({
      author: 'Unknown User',
      messages: [
        {
          role: 'user',
          content: 'Hello\u00A0\u00A0<script>alert(1)</script>\n\n\n世界 世界',
          contentHtml: '<p>Should not render</p>',
          images: [],
        },
      ],
    }),
    createSettings({ userLabelMode: 'account-name' }),
  );
  const html = await readBlob(blob);

  expect(html).toContain('<div class="role">🧑 You</div>');
  expect(html).toContain('<div class="content" style="white-space:pre-wrap">Hello &lt;script&gt;alert(1)&lt;/script&gt;\n\n世界世界</div>');
  expect(html).not.toContain('<p>Should not render</p>');
});
(function () {
  function postResult(payload) {
    window.parent.postMessage({ type: 'GCE_PDF_RESULT', ...payload }, '*');
  }

  function applyHtmlDocument(html) {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(html, 'text/html');

    // Remove previously injected source styles
    document.querySelectorAll('style[data-gce-source], link[data-gce-source]').forEach((n) => n.remove());

    // Copy styles from source document head
    parsed.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      const cloned = node.cloneNode(true);
      cloned.setAttribute('data-gce-source', '1');
      document.head.appendChild(cloned);
    });

    const target = document.getElementById('render-target');
    if (!target) throw new Error('Missing render target');
    target.innerHTML = parsed.body ? parsed.body.innerHTML : html;

    return target;
  }

  async function render(html) {
    const html2pdf = window.html2pdf;
    if (!html2pdf) {
      throw new Error('html2pdf is not available in renderer page');
    }

    const target = applyHtmlDocument(html);
    await new Promise((r) => setTimeout(r, 200));

    const opt = {
      margin: 10,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: {
        mode: ['css', 'legacy'],
        avoid: ['.message-attachments', '.message-attachment', '.message-attachment__image', 'figure', 'img'],
      },
    };

    const dataUri = await html2pdf().set(opt).from(target).output('datauristring');
    const base64 = dataUri && dataUri.includes('base64,') ? dataUri.split('base64,')[1] : dataUri;

    if (!base64 || base64.length < 3000) {
      throw new Error('Rendered PDF is empty or too small');
    }

    return base64;
  }

  window.addEventListener('message', async (event) => {
    const data = event.data || {};
    if (data.type !== 'GCE_RENDER_HTML_TO_PDF') return;

    try {
      const base64 = await render(String(data.html || ''));
      postResult({ success: true, pdfBase64: base64 });
    } catch (err) {
      postResult({ success: false, error: err && err.message ? err.message : String(err) });
    }
  });
})();

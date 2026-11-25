// src/content/image-extractor.ts — 用户输入图片提取与 Base64 转换

export interface ImageExtractionOptions {
  enabled?: boolean;
}

const IMAGE_LOG_PREFIX = '[GCE][images]';
const imageResolutionCache = new WeakMap<HTMLImageElement, { src: string; promise: Promise<string | null> }>();

function isLikelyUserInputImage(img: HTMLImageElement): boolean {
  const marker = [
    img.getAttribute('data-test-id') || '',
    img.alt || '',
    img.className || '',
    img.closest('[data-message-author-role="user"], user-query, .user-query') ? 'user-turn' : '',
  ].join(' ').toLowerCase();

  return /uploaded|upload|preview-image|attachment|pasted|user-turn/.test(marker);
}

function shouldIncludeImage(img: HTMLImageElement): boolean {
  if (img.closest('.avatar, .icon, .profile-picture, .user-avatar')) return false;

  const src = img.currentSrc || img.src || img.getAttribute('src') || '';
  if (!src || src.startsWith('data:image/svg')) return false;

  if (!isLikelyUserInputImage(img)) return false;

  return true;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read blob as data URL'));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob as data URL'));
    reader.readAsDataURL(blob);
  });
}

function buildFetchStrategies(src: string): Array<{ label: string; init?: RequestInit }> {
  const parsed = parseImageUrl(src);
  if (!parsed) {
    return [{ label: 'default' }];
  }

  if (parsed.protocol === 'blob:') {
    return [{ label: 'blob-default' }];
  }

  if (parsed.origin === window.location.origin) {
    return [
      {
        label: 'same-origin-authenticated',
        init: {
          credentials: 'include',
          cache: 'force-cache',
          referrer: window.location.href,
          referrerPolicy: 'strict-origin-when-cross-origin',
        },
      },
      {
        label: 'same-origin-default',
        init: {
          cache: 'force-cache',
        },
      },
    ];
  }

  return [];
}

async function fetchImageAsDataUrl(src: string): Promise<string | null> {
  const strategies = buildFetchStrategies(src);

  for (const strategy of strategies) {
    try {
      console.info(`${IMAGE_LOG_PREFIX} fetch attempt`, {
        src,
        strategy: strategy.label,
        init: strategy.init,
      });

      const response = strategy.init ? await fetch(src, strategy.init) : await fetch(src);
      if (!response.ok) {
        console.warn(`${IMAGE_LOG_PREFIX} fetch returned non-ok response`, {
          src,
          strategy: strategy.label,
          status: response.status,
          statusText: response.statusText,
        });
        continue;
      }

      console.info(`${IMAGE_LOG_PREFIX} fetched image successfully`, {
        src,
        strategy: strategy.label,
        status: response.status,
      });
      return await blobToDataUrl(await response.blob());
    } catch (error) {
      console.warn(`${IMAGE_LOG_PREFIX} fetch failed`, {
        src,
        strategy: strategy.label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

async function ensureImageReady(img: HTMLImageElement, timeoutMs = 1800): Promise<boolean> {
  if (img.complete && img.naturalWidth > 0) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
    };

    const handleLoad = () => {
      finish(img.naturalWidth > 0);
    };

    const handleError = () => {
      finish(false);
    };

    const timer = window.setTimeout(() => {
      console.warn(`${IMAGE_LOG_PREFIX} image did not become ready in time`, {
        src: img.currentSrc || img.src || img.getAttribute('src') || '',
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
      finish(false);
    }, timeoutMs);

    img.addEventListener('load', handleLoad, { once: true });
    img.addEventListener('error', handleError, { once: true });

    if (typeof img.decode === 'function') {
      img.decode()
        .then(() => {
          if (img.naturalWidth > 0) {
            finish(true);
          }
        })
        .catch(() => {
          // Some cross-origin images reject decode even though load events still fire.
        });
    }
  });
}

function parseImageUrl(src: string): URL | null {
  try {
    return new URL(src, window.location.href);
  } catch {
    return null;
  }
}

function shouldFetchImageUrl(src: string): boolean {
  const parsed = parseImageUrl(src);
  if (!parsed) return false;

  if (parsed.protocol === 'blob:') return true;
  if (!/^https?:$/i.test(parsed.protocol)) return false;

  return parsed.origin === window.location.origin;
}

async function resolveImageSource(img: HTMLImageElement): Promise<string | null> {
  const src = img.currentSrc || img.src || img.getAttribute('src') || '';
  if (!src) return null;

  if (src.startsWith('data:image/')) {
    return src;
  }

  const cached = imageResolutionCache.get(img);
  if (cached && cached.src === src) {
    return cached.promise;
  }

  const resolutionPromise = (async () => {
    const ready = await ensureImageReady(img);

    if (src.startsWith('blob:')) {
      const blobDataUrl = await fetchImageAsDataUrl(src);
      if (blobDataUrl) return blobDataUrl;
    }

    if (ready && img.naturalWidth > 0) {
      const dataUrl = imageToBase64(img);
      if (dataUrl) {
        console.info(`${IMAGE_LOG_PREFIX} converted image from DOM pixels`, {
          src,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
        return dataUrl;
      }
    }

    if (/^https?:/i.test(src)) {
      if (shouldFetchImageUrl(src)) {
        console.info(`${IMAGE_LOG_PREFIX} attempting remote fetch fallback`, {
          src,
          hostname: parseImageUrl(src)?.hostname,
        });
        const remoteDataUrl = await fetchImageAsDataUrl(src);
        if (remoteDataUrl) return remoteDataUrl;
      }
      console.info(`${IMAGE_LOG_PREFIX} skipping unsupported remote image`, { src });
      return null;
    }

    return src;
  })();

  imageResolutionCache.set(img, { src, promise: resolutionPromise });

  try {
    const resolved = await resolutionPromise;
    if (!resolved && imageResolutionCache.get(img)?.promise === resolutionPromise) {
      imageResolutionCache.delete(img);
    }
    return resolved;
  } catch (error) {
    if (imageResolutionCache.get(img)?.promise === resolutionPromise) {
      imageResolutionCache.delete(img);
    }
    throw error;
  }
}

/**
 * 遍历容器内所有 <img> 标签, 通过 Canvas 转为 Base64 data URL。
 * 跳过装饰性图片 (图标、头像等), 仅保留对话内容图片。
 */
export async function extractImages(container: Element, options: ImageExtractionOptions = {}): Promise<string[]> {
  if (options.enabled === false) {
    return [];
  }

  const images: string[] = [];
  const imgElements = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
  const seen = new Set<string>();

  for (const img of imgElements) {
    if (!shouldIncludeImage(img)) continue;

    const dataUrl = await resolveImageSource(img);
    if (dataUrl && !seen.has(dataUrl)) {
      seen.add(dataUrl);
      images.push(dataUrl);
    }
  }

  return images;
}

/**
 * 将 HTMLImageElement 通过 Canvas 转换为 Base64 data URL。
 * 对大尺寸图片进行压缩, 控制内存占用。
 */
function imageToBase64(img: HTMLImageElement): string | null {
  try {
    if (!img.complete || img.naturalWidth === 0) return null;

    const { naturalWidth: w, naturalHeight: h } = img;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, w, h);

    return canvas.toDataURL('image/png');
  } catch {
    // 跨域图片无法通过 Canvas 读取
    return null;
  }
}

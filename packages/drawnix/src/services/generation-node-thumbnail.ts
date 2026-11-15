import { isVirtualMediaUrl } from '../utils/virtual-media-url';

/** SVG thumbnails need the same local-cache fallback as the canvas image renderer. */
export function bindGenerationThumbnail(
  image: Element,
  originalUrl: string
): () => void {
  let url = originalUrl;
  let disposed = false;
  let objectUrl: string | undefined;
  const fallback = () => {
    if (!disposed) image.setAttribute('visibility', 'hidden');
  };
  const loaded = () => {
    if (!disposed) image.removeAttribute('visibility');
  };
  image.addEventListener('error', fallback);
  image.addEventListener('load', loaded);
  const load = async () => {
    try {
      const { normalizeImageDataUrl } = await import('@aitu/utils');
      if (disposed) return;
      url = normalizeImageDataUrl(originalUrl);
      if (!url.startsWith('data:') && !url.startsWith('blob:')) {
        const { unifiedCacheService } = await import('./unified-cache-service');
        const blob = await unifiedCacheService.getCachedBlob(url, {
          allowNetwork: false,
        });
        if (disposed) return;
        if (blob) objectUrl = URL.createObjectURL(blob);
      }
      if (!disposed) image.setAttribute('href', objectUrl || url);
    } catch {
      if (!disposed) image.setAttribute('href', url);
    }
  };
  if (!isVirtualMediaUrl(url)) image.setAttribute('href', url);
  void load();
  return () => {
    disposed = true;
    image.removeEventListener('error', fallback);
    image.removeEventListener('load', loaded);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}

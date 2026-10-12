import { useEffect, useMemo, useState } from 'react';

const pending = new Map<string, Promise<Blob | null>>();
const waiting: Array<() => void> = [];
let activeReads = 0;

function schedulePreview(source: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const start = () => {
      activeReads++;
      void readPreview(source)
        .then(resolve, () => resolve(null))
        .finally(() => {
          activeReads--;
          waiting.shift()?.();
        });
    };
    if (activeReads < 2) start();
    else waiting.push(start);
  });
}

async function readPreview(source: string): Promise<Blob | null> {
  if (typeof caches === 'undefined') return null;
  const url = new URL(source, window.location.origin);
  if (
    !url.pathname.startsWith('/__aitu_cache__/') &&
    !url.pathname.startsWith('/asset-library/')
  )
    return null;
  const originalCache = await caches.open('drawnix-images');
  const original =
    (await originalCache.match(source)) ||
    (await originalCache.match(url.pathname));
  // Animated and vector media must keep their original rendering behavior.
  if (
    !['image/png', 'image/jpeg'].includes(
      original?.headers.get('Content-Type')?.split(';')[0] || ''
    )
  )
    return null;
  const cache = await caches.open('drawnix-images-thumb');
  url.searchParams.set('_thumb', 'large');
  const response =
    (await cache.match(url.href)) ||
    (await cache.match(`${url.pathname}${url.search}`));
  return response ? response.blob() : null;
}

export function useCanvasImagePreview(source: string, enabled: boolean) {
  const owner = useMemo(() => ({ source, enabled }), [source, enabled]);
  const [preview, setPreview] = useState<{
    owner: typeof owner;
    url?: string;
  }>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let objectUrl: string | undefined;
    let request = pending.get(source);
    if (!request) {
      request = schedulePreview(source);
      pending.set(source, request);
      void request.finally(() => {
        if (pending.get(source) === request) pending.delete(source);
      });
    }
    void request.then((blob) => {
      if (!active) return;
      objectUrl = blob ? URL.createObjectURL(blob) : undefined;
      setPreview({ owner, url: objectUrl });
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, enabled, owner]);
  return {
    url: enabled && preview?.owner === owner ? preview.url : undefined,
    pending: enabled && preview?.owner !== owner,
  };
}

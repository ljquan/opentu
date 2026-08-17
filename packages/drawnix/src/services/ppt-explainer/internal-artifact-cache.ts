const CACHE_NAME = 'aitu-ppt-explainer-internal-v1';
const CACHE_PATH_PREFIX = '/__aitu_internal__/ppt-explainer';

function requireCacheStorage(): CacheStorage {
  if (typeof caches === 'undefined') {
    throw new Error('当前浏览器环境不支持 PPT 讲解任务的持久化缓存');
  }
  return caches;
}

function sanitizeSegment(value: string): string {
  return encodeURIComponent(value.replace(/[\r\n\0]/g, '').slice(0, 180));
}

export function createPptExplainerArtifactUrl(
  jobId: string,
  artifactName: string
): string {
  return `${CACHE_PATH_PREFIX}/${sanitizeSegment(jobId)}/${sanitizeSegment(
    artifactName
  )}`;
}

export async function putPptExplainerArtifact(
  jobId: string,
  artifactName: string,
  blob: Blob
): Promise<string> {
  const url = createPptExplainerArtifactUrl(jobId, artifactName);
  const cache = await requireCacheStorage().open(CACHE_NAME);
  await cache.put(
    url,
    new Response(blob, {
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
        'Content-Length': String(blob.size),
        'X-OpenTu-Visibility': 'internal',
      },
    })
  );
  return url;
}

export async function getPptExplainerArtifact(
  url: string
): Promise<Blob | null> {
  const cache = await requireCacheStorage().open(CACHE_NAME);
  const response = await cache.match(url);
  return response ? response.blob() : null;
}

export async function deletePptExplainerArtifacts(
  jobId: string
): Promise<void> {
  const cacheStorage = requireCacheStorage();
  const cache = await cacheStorage.open(CACHE_NAME);
  const prefix = `${CACHE_PATH_PREFIX}/${sanitizeSegment(jobId)}/`;
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter((request) => new URL(request.url).pathname.startsWith(prefix))
      .map((request) => cache.delete(request))
  );
}

export function isPptExplainerArtifactUrl(url: string): boolean {
  try {
    return new URL(
      url,
      globalThis.location?.origin || 'https://opentu.invalid'
    ).pathname.startsWith(`${CACHE_PATH_PREFIX}/`);
  } catch {
    return false;
  }
}

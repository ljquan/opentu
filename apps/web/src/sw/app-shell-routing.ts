function isRootPathname(pathname: string): boolean {
  return pathname === '/' || pathname === '/index.html';
}

const ORIGIN_FIRST_PRELOAD_SUFFIXES = [
  '/version.json',
  '/manifest.json',
  '/sw.js',
  '/precache-manifest.json',
  '/idle-prefetch-manifest.json',
] as const;
const LAZY_CHUNK_RETRY_PARAM = '_lazy_chunk_retry';
const LAZY_CHUNK_RETRY_TS_PARAM = '_t';
const LAZY_CHUNK_RETRY_MAX_AGE_MS = 10 * 60 * 1000;

export function shouldUseAppShellStrategy(
  requestMode: string,
  pathname: string
): boolean {
  // 只有根壳页走 SPA fallback；目录下的 index.html 属于真实静态文档。
  if (isRootPathname(pathname)) {
    return true;
  }

  return requestMode === 'navigate' && !pathname.endsWith('.html');
}

export function shouldUseOriginFirstPreload(pathname: string): boolean {
  if (isRootPathname(pathname)) {
    return true;
  }

  return ORIGIN_FIRST_PRELOAD_SUFFIXES.some((suffix) =>
    pathname.endsWith(suffix)
  );
}

export function shouldBypassAppShellCacheForLazyChunkRecovery(
  search: string,
  now = Date.now()
): boolean {
  const params = new URLSearchParams(search);
  if (params.get(LAZY_CHUNK_RETRY_PARAM) !== '1') {
    return false;
  }

  const retryAt = Number(params.get(LAZY_CHUNK_RETRY_TS_PARAM));
  if (!Number.isFinite(retryAt) || retryAt <= 0) {
    return true;
  }

  return now - retryAt <= LAZY_CHUNK_RETRY_MAX_AGE_MS;
}

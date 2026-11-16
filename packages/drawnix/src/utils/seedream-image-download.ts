export const SEEDREAM_IMAGE_ORIGIN =
  'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com';
export const SEEDREAM_IMAGE_PATH = '/doubao-seedream-5-5/';
export const SEEDREAM_IMAGE_PROXY_PATH = '/__opentu_seedream_images__/';

/** Keep signed paths/query bytes intact; the proxy has one fixed upstream. */
export function resolveSeedreamImageDownloadUrl(url: string): string {
  try {
    const target = new URL(url);
    if (
      target.origin !== SEEDREAM_IMAGE_ORIGIN ||
      target.username ||
      target.password ||
      !target.pathname.startsWith(SEEDREAM_IMAGE_PATH)
    )
      return url;
    return `${SEEDREAM_IMAGE_PROXY_PATH}${target.pathname.slice(
      SEEDREAM_IMAGE_PATH.length
    )}${target.search}`;
  } catch {
    return url;
  }
}

export async function fetchImageForCache(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const downloadUrl = resolveSeedreamImageDownloadUrl(url);
  if (downloadUrl === url) return fetch(url, options);
  const headers = new Headers(options?.headers);
  for (const name of ['Authorization', 'Cookie', 'Origin', 'Referer'])
    headers.delete(name);
  const response = await fetch(downloadUrl, {
    ...options,
    headers,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  const contentType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (
    response.ok &&
    contentType &&
    !contentType.startsWith('image/') &&
    contentType !== 'application/octet-stream'
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('图片下载返回了无效内容');
  }
  return response;
}

import { unifiedCacheService } from './unified-cache-service';
import {
  inspectSvgSource,
  SVG_SOURCE_MAX_BYTES,
  type SvgSource,
} from '../utils/svg-source';

export async function readSvgCanvasSource(
  url: string,
  signal?: AbortSignal
): Promise<SvgSource> {
  signal?.throwIfAborted();
  // SVG tooling must use original bytes, never a PNG thumbnail fallback.
  let blob = await unifiedCacheService.getCachedBlob(url, {
    allowNetwork: false,
  });
  signal?.throwIfAborted();
  if (!blob) {
    if (
      /^\/(?:__aitu_cache__|asset-library)\//.test(url) ||
      !/^(?:https?:|blob:|data:image\/svg\+xml|\/(?!\/))/i.test(url)
    )
      throw new Error('SVG 原文件缓存缺失，请重新导入原文件');
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
      });
      if (!response.ok) throw new Error(`SVG 读取失败（${response.status}）`);
      if (Number(response.headers.get('content-length')) > SVG_SOURCE_MAX_BYTES)
        throw new Error('SVG 超过 2 MB');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('SVG 原文件不可读');
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > SVG_SOURCE_MAX_BYTES) throw new Error('SVG 超过 2 MB');
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      blob = new Blob(chunks, { type: 'image/svg+xml' });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  if (blob.size > SVG_SOURCE_MAX_BYTES) throw new Error('SVG 超过 2 MB');
  const sourceBlob = blob;
  const text =
    typeof sourceBlob.text === 'function'
      ? await sourceBlob.text()
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            typeof reader.result === 'string'
              ? resolve(reader.result)
              : reject(new Error('SVG 原文件不可读'));
          reader.onerror = () => reject(new Error('SVG 原文件读取失败'));
          reader.readAsText(sourceBlob);
        });
  signal?.throwIfAborted();
  return inspectSvgSource(text);
}

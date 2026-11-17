import { readKeepOriginalImageEnabled } from './reference-image-settings';
import { encodeTuziVideoBlob, parseVideoMediaData } from './tuzi-video-media';

// This channel limits the serialized request, not the decoded image file.
export const GEMINI_OMNI_REQUEST_MAX_BYTES = 1024 * 1024;
const REQUEST_HEADROOM_BYTES = 16 * 1024;
const budgetError = () =>
  new Error(
    'Gemini Omni 视频请求超过 1 MiB 限制，请减少参考素材、缩短提示词，或使用供应商可访问的图片/视频 URL'
  );
const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

async function compressReference(blob: Blob, maxBytes: number): Promise<Blob> {
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let cleanup: () => void;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    cleanup = () => bitmap.close();
  } else {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('参考图片解码失败'));
        image.src = url;
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
    cleanup = () => URL.revokeObjectURL(url);
  }
  try {
    // Re-encode only the submission copy. Keep aspect ratio and never crop.
    for (let round = 0; round < 10; round++) {
      const scale = Math.pow(0.8, round);
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      if (round > 0 && Math.max(w, h) < 256) break;
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement('canvas'), {
              width: w,
              height: h,
            });
      const ctx = canvas.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) throw new Error('当前环境无法压缩参考图片');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(source, 0, 0, w, h);
      for (const quality of [0.9, 0.75, 0.6]) {
        const output =
          'convertToBlob' in canvas
            ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
            : await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(
                  (value) =>
                    value
                      ? resolve(value)
                      : reject(new Error('参考图片压缩失败')),
                  'image/jpeg',
                  quality
                )
              );
        if (output.size <= maxBytes) return output;
      }
    }
    throw budgetError();
  } finally {
    cleanup();
  }
}

/** Enforce the aggregate UTF-8 JSON budget after all references are resolved. */
export async function fitGeminiOmniRequest(
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (jsonBytes(body) <= GEMINI_OMNI_REQUEST_MAX_BYTES) return body;
  const input = Array.isArray(body.input)
    ? body.input.map((part: Record<string, unknown>) => ({ ...part }))
    : [];
  const images = input.filter(
    (part) => part.type === 'image' && typeof part.data === 'string'
  );
  if (!images.length) throw budgetError();
  if (readKeepOriginalImageEnabled()) {
    throw new Error(
      'Gemini Omni 视频请求超过 1 MiB；请关闭“保留原图”以压缩提交副本，或使用供应商可访问的参考图 URL'
    );
  }
  const result = { ...body, input };
  // Text, URLs, videos and all other fields consume the same request budget.
  const imageData = images.map((part) => ({ part, data: String(part.data) }));
  images.forEach((part) => {
    part.data = '';
  });
  let remaining =
    GEMINI_OMNI_REQUEST_MAX_BYTES - REQUEST_HEADROOM_BYTES - jsonBytes(result);
  if (remaining <= 0) throw budgetError();
  imageData.sort((a, b) => a.data.length - b.data.length);
  for (const [index, { part, data }] of imageData.entries()) {
    const allowance =
      Math.floor(remaining / (imageData.length - index) / 4) * 4;
    if (data.length <= allowance) {
      part.data = data;
    } else {
      if (allowance < 4) throw budgetError();
      const parsed = parseVideoMediaData(data, String(part.mime_type));
      const output = await compressReference(
        new Blob([parsed.bytes], { type: parsed.mime }),
        (allowance / 4) * 3
      );
      const encoded = await encodeTuziVideoBlob(output);
      const compressed = parseVideoMediaData(encoded);
      part.data = compressed.data;
      part.mime_type = compressed.mime;
    }
    remaining -= String(part.data).length;
  }
  if (jsonBytes(result) > GEMINI_OMNI_REQUEST_MAX_BYTES) throw budgetError();
  return result;
}

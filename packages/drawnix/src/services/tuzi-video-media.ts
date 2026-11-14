import { isVirtualMediaUrl } from '../utils/virtual-media-url';

export function isPublicVideoMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !/\/(?:v1\/videos\/[^/]+\/content|api\/content-assets\/[^/]+)(?:\/|$)/.test(
        url.pathname
      ) &&
      !isVirtualMediaUrl(value) &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function mediaMimeFromUrl(value: string): string | undefined {
  const extension = value.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return (
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      bmp: 'image/bmp',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
    } as Record<string, string>
  )[extension || ''];
}

export function parseVideoMediaData(
  value: string,
  fallbackMime?: string
): {
  mime: string;
  data: string;
  bytes: Uint8Array;
} {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  const data = match?.[2] ?? value;
  if (data.length > 4 * Math.ceil((30 * 1024 * 1024) / 3))
    throw new Error('本地参考素材大小超限，请使用公网 URL');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 === 1)
    throw new Error('参考素材 Base64 无效');
  let decoded: string;
  try {
    decoded = atob(data);
  } catch {
    throw new Error('参考素材 Base64 无效');
  }
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  if (!bytes.length) throw new Error('参考素材不能为空');
  const signature = String.fromCharCode(...bytes.subarray(0, 12));
  const detected =
    bytes[0] === 0xff && bytes[1] === 0xd8
      ? 'image/jpeg'
      : signature.startsWith('\x89PNG\r\n\x1a\n')
      ? 'image/png'
      : signature.startsWith('RIFF') && signature.slice(8) === 'WEBP'
      ? 'image/webp'
      : signature.startsWith('BM')
      ? 'image/bmp'
      : undefined;
  const declared = match?.[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  const mime =
    declared && declared !== 'application/octet-stream'
      ? declared
      : detected || fallbackMime;
  if (!mime) throw new Error('参考素材需要明确的 MIME 类型');
  if (
    (detected && detected !== mime) ||
    (mime.startsWith('image/') && detected !== mime)
  )
    throw new Error('图片内容与格式不符');
  return { mime, data, bytes };
}

/** Read image headers without DOM so the same constraints also run in the worker. */
function imageDimensions(bytes: Uint8Array, mime: string): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png' && bytes.length >= 24)
    return [view.getUint32(16), view.getUint32(20)];
  if (mime === 'image/jpeg') {
    for (let offset = 2; offset + 8 < bytes.length; ) {
      if (bytes[offset] !== 0xff) break;
      if (bytes[offset + 1] === 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
      }
      const size = view.getUint16(offset + 2);
      if (size < 2) break;
      offset += size + 2;
    }
  }
  if (mime === 'image/webp' && bytes.length >= 25) {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === 'VP8X' && bytes.length >= 30)
      return [
        1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      ];
    if (kind === 'VP8 ' && bytes.length >= 30)
      return [
        view.getUint16(26, true) & 0x3fff,
        view.getUint16(28, true) & 0x3fff,
      ];
    if (kind === 'VP8L' && bytes[20] === 0x2f)
      return [
        1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0xf) << 10),
      ];
  }
  throw new Error('无法读取参考图片尺寸');
}

export function validateHappyHorseImage(
  bytes: Uint8Array,
  mime: string,
  i2v: boolean
): void {
  const [width, height] = imageDimensions(bytes, mime);
  if (
    i2v &&
    (Math.min(width, height) < 300 ||
      width / height < 0.4 ||
      width / height > 2.5)
  ) {
    throw new Error(
      'HappyHorse I2V 图片宽高至少 300 像素，宽高比须为 1:2.5–2.5:1'
    );
  }
  if (!i2v && Math.min(width, height) < 400)
    throw new Error('HappyHorse R2V 参考图短边至少 400 像素');
}

export type TuziMediaResolver = (url: string) => Promise<string>;

export async function encodeTuziVideoBlob(blob: Blob): Promise<string> {
  if (blob.size > 30 * 1024 * 1024)
    throw new Error('本地参考素材大小超限，请使用公网 URL');
  return encodeTuziVideoBytes(
    new Uint8Array(await blob.arrayBuffer()),
    blob.type
  );
}

export function encodeTuziVideoBytes(bytes: Uint8Array, mime: string): string {
  if (bytes.length > 30 * 1024 * 1024)
    throw new Error('本地参考素材大小超限，请使用公网 URL');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${mime || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export async function resolveTuziVideoMedia(
  value: unknown,
  resolve?: TuziMediaResolver
): Promise<string> {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('参考素材不能为空');
  if (isPublicVideoMediaUrl(value) || value.startsWith('data:')) return value;
  // Bare Base64 is supported by the native image contracts.
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length >= 16) return value;
  const result = await resolve?.(value);
  if (!result) throw new Error('本地参考素材读取失败，请重新选择文件');
  return result;
}

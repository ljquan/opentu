/**
 * Blob 工具模块
 *
 * 提供 Blob 和 Base64 之间的转换工具函数
 */

/**
 * 将 Blob 转换为 Base64 字符串
 *
 * @param blob 要转换的 Blob
 * @returns Promise<string> 纯 Base64 字符串（不含 data URL 前缀）
 *
 * @example
 * ```typescript
 * const blob = new Blob(['Hello'], { type: 'text/plain' });
 * const base64 = await blobToBase64(blob);
 * console.log(base64); // "SGVsbG8="
 * ```
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      const result = reader.result as string;
      // 移除 data URL 前缀 (e.g., "data:image/png;base64,")
      const base64Data = result.split(',')[1] || '';
      resolve(base64Data);
    };

    reader.onerror = () => {
      reject(new Error('Failed to read blob as base64'));
    };

    reader.readAsDataURL(blob);
  });
}

/**
 * 将纯 Base64 字符串转换为 Blob
 *
 * 注意：此函数接受纯 base64 字符串（不含 data URL 前缀）。
 * 如果你有 data URL 格式的字符串，请使用 `@aitu/utils` 的 `base64ToBlob`（来自 encoding 模块）。
 *
 * @param base64 纯 Base64 字符串（不含 data URL 前缀）
 * @param mimeType MIME 类型
 * @returns Blob
 *
 * @example
 * ```typescript
 * const blob = pureBase64ToBlob('SGVsbG8=', 'text/plain');
 * console.log(blob.size); // 5
 * console.log(blob.type); // "text/plain"
 * ```
 */
export function pureBase64ToBlob(base64: string, mimeType: string): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

/**
 * 将 Data URL 转换为 Blob
 *
 * @param dataUrl Data URL 字符串 (e.g., "data:image/png;base64,...")
 * @returns Blob
 *
 * @example
 * ```typescript
 * const blob = dataUrlToBlob('data:text/plain;base64,SGVsbG8=');
 * console.log(blob.type); // "text/plain"
 * ```
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeType = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
  return pureBase64ToBlob(base64, mimeType);
}

/**
 * 将 Blob 转换为 Data URL
 *
 * @param blob 要转换的 Blob
 * @returns Promise<string> Data URL 字符串
 *
 * @example
 * ```typescript
 * const blob = new Blob(['Hello'], { type: 'text/plain' });
 * const dataUrl = await blobToDataUrl(blob);
 * console.log(dataUrl); // "data:text/plain;base64,SGVsbG8="
 * ```
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      resolve(reader.result as string);
    };

    reader.onerror = () => {
      reject(new Error('Failed to read blob as data URL'));
    };

    reader.readAsDataURL(blob);
  });
}

/**
 * 计算 Blob 的 MD5 校验和（使用 SubtleCrypto）
 *
 * 注意：浏览器 SubtleCrypto 不支持 MD5，这里使用 SHA-256 代替
 *
 * @param blob 要计算校验和的 Blob
 * @returns Promise<string> 十六进制格式的校验和
 *
 * @example
 * ```typescript
 * const blob = new Blob(['Hello'], { type: 'text/plain' });
 * const checksum = await calculateBlobChecksum(blob);
 * ```
 */
const SHA256_INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const SHA256_BLOCK_SIZE = 64;
const SHA256_STREAM_CHUNK_SIZE = 1024 * 1024;

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function processSha256Block(
  hash: number[],
  block: Uint8Array,
  offset: number,
  schedule: Uint32Array
): void {
  for (let i = 0; i < 16; i++) {
    const position = offset + i * 4;
    schedule[i] =
      ((block[position] << 24) |
        (block[position + 1] << 16) |
        (block[position + 2] << 8) |
        block[position + 3]) >>>
      0;
  }

  for (let i = 16; i < 64; i++) {
    const value15 = schedule[i - 15];
    const value2 = schedule[i - 2];
    const sigma0 =
      rotateRight(value15, 7) ^ rotateRight(value15, 18) ^ (value15 >>> 3);
    const sigma1 =
      rotateRight(value2, 17) ^ rotateRight(value2, 19) ^ (value2 >>> 10);
    schedule[i] = (schedule[i - 16] + sigma0 + schedule[i - 7] + sigma1) >>> 0;
  }

  let [a, b, c, d, e, f, g, h] = hash;

  for (let i = 0; i < 64; i++) {
    const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const choice = (e & f) ^ (~e & g);
    const temp1 =
      (h + sum1 + choice + SHA256_ROUND_CONSTANTS[i] + schedule[i]) >>> 0;
    const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (sum0 + majority) >>> 0;

    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  hash[0] = (hash[0] + a) >>> 0;
  hash[1] = (hash[1] + b) >>> 0;
  hash[2] = (hash[2] + c) >>> 0;
  hash[3] = (hash[3] + d) >>> 0;
  hash[4] = (hash[4] + e) >>> 0;
  hash[5] = (hash[5] + f) >>> 0;
  hash[6] = (hash[6] + g) >>> 0;
  hash[7] = (hash[7] + h) >>> 0;
}

async function calculateBlobChecksumWithoutSubtleCrypto(
  blob: Blob
): Promise<string> {
  const hash = [...SHA256_INITIAL_HASH];
  const schedule = new Uint32Array(64);
  let pending = new Uint8Array(0);

  for (let offset = 0; offset < blob.size; offset += SHA256_STREAM_CHUNK_SIZE) {
    const chunk = new Uint8Array(
      await readBlobAsArrayBuffer(
        blob.slice(
          offset,
          Math.min(offset + SHA256_STREAM_CHUNK_SIZE, blob.size)
        )
      )
    );
    const combined = new Uint8Array(pending.length + chunk.length);
    combined.set(pending);
    combined.set(chunk, pending.length);

    let blockOffset = 0;
    while (blockOffset + SHA256_BLOCK_SIZE <= combined.length) {
      processSha256Block(hash, combined, blockOffset, schedule);
      blockOffset += SHA256_BLOCK_SIZE;
    }
    pending = combined.slice(blockOffset);
  }

  const finalLength = pending.length < 56 ? 64 : 128;
  const finalBlock = new Uint8Array(finalLength);
  finalBlock.set(pending);
  finalBlock[pending.length] = 0x80;

  const lengthView = new DataView(finalBlock.buffer);
  lengthView.setUint32(finalLength - 8, Math.floor(blob.size / 0x20000000));
  lengthView.setUint32(finalLength - 4, (blob.size * 8) >>> 0);

  for (
    let offset = 0;
    offset < finalBlock.length;
    offset += SHA256_BLOCK_SIZE
  ) {
    processSha256Block(hash, finalBlock, offset, schedule);
  }

  return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
}

export async function calculateBlobChecksum(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const arrayBuffer = await readBlobAsArrayBuffer(blob);
    const hashBuffer = await subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  return calculateBlobChecksumWithoutSubtleCrypto(blob);
}

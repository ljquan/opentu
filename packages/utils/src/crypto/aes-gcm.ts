/**
 * AES-GCM Encryption Utilities
 *
 * 使用 Web Crypto API 提供安全的 AES-GCM 加密/解密功能。
 * 支持自定义密码或基于设备 ID 的密码生成。
 *
 * 注意：
 * - 需要 HTTPS 环境（或 localhost）
 * - 在非安全环境下会降级为 Base64 编码（仅用于开发）
 */

import type { EncryptedData, AesGcmOptions } from './types';

// ==================== 常量 ====================

const ALGORITHM = 'AES-GCM';
const DEFAULT_KEY_LENGTH = 256;
const DEFAULT_ITERATIONS = 100000;
const IV_LENGTH = 12; // 96 bits for AES-GCM
const SALT_LENGTH = 16;
const FALLBACK_PREFIX = 'OPENTU_FB:';
const LEGACY_FALLBACK_PREFIX = 'AITU_FB:';

// ==================== 辅助函数 ====================

/**
 * 检查 Web Crypto API 是否可用
 */
function isCryptoAvailable(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    crypto.subtle !== undefined &&
    typeof crypto.subtle.importKey === 'function'
  );
}

/**
 * ArrayBuffer 转 Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return globalThis.btoa(binary);
}

/**
 * Base64 转 ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = globalThis.atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

/**
 * 生成密钥材料
 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
  options: AesGcmOptions = {}
): Promise<CryptoKey> {
  const { iterations = DEFAULT_ITERATIONS, keyLength = DEFAULT_KEY_LENGTH } =
    options;

  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: keyLength },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Fallback 编码 - Base64（非安全，仅用于开发环境）
 */
function fallbackEncode(plaintext: string): string {
  const encoded = globalThis.btoa(encodeURIComponent(plaintext));
  return FALLBACK_PREFIX + encoded;
}

/**
 * Fallback 解码
 */
function fallbackDecode(encoded: string): string {
  const prefix = encoded.startsWith(FALLBACK_PREFIX)
    ? FALLBACK_PREFIX
    : LEGACY_FALLBACK_PREFIX;
  const data = encoded.slice(prefix.length);
  return decodeURIComponent(globalThis.atob(data));
}

/**
 * 检查是否是 fallback 编码的数据
 */
function isFallbackEncoded(data: string): boolean {
  return data.startsWith(FALLBACK_PREFIX) || data.startsWith(LEGACY_FALLBACK_PREFIX);
}

// ==================== 公共 API ====================

/**
 * 检查 Web Crypto API 是否可用
 *
 * @returns 是否支持加密
 *
 * @example
 * ```typescript
 * if (isCryptoSupported()) {
 *   // 可以使用加密功能
 * } else {
 *   // 降级到其他方案
 * }
 * ```
 */
export function isCryptoSupported(): boolean {
  return isCryptoAvailable();
}

/**
 * 加密数据
 *
 * 使用 AES-GCM 加密字符串。如果 Web Crypto API 不可用，
 * 将降级为 Base64 编码（仅用于开发环境）。
 *
 * @param plaintext - 要加密的明文
 * @param password - 加密密码（如果不提供，需要后续通过 createCryptoUtils 配置）
 * @param options - 加密选项
 * @returns 加密后的 JSON 字符串
 *
 * @example
 * ```typescript
 * const encrypted = await encrypt('sensitive data', 'my-secret-password');
 * // 存储 encrypted 字符串
 * ```
 */
export async function encrypt(
  plaintext: string,
  password: string,
  options: AesGcmOptions = {}
): Promise<string> {
  if (!isCryptoAvailable()) {
    console.warn('Web Crypto API not available, using fallback encoding');
    return fallbackEncode(plaintext);
  }

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    const key = await deriveKey(password, salt, options);

    const encrypted = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      data
    );

    const result: EncryptedData = {
      data: arrayBufferToBase64(encrypted),
      iv: arrayBufferToBase64(iv.buffer),
      salt: arrayBufferToBase64(salt.buffer),
    };

    return JSON.stringify(result);
  } catch (error) {
    console.error('Encryption failed:', error);
    console.warn('Falling back to simple encoding');
    return fallbackEncode(plaintext);
  }
}

/**
 * 解密数据
 *
 * @param encryptedData - 加密后的 JSON 字符串
 * @param password - 解密密码
 * @param options - 解密选项
 * @returns 解密后的明文
 *
 * @example
 * ```typescript
 * const decrypted = await decrypt(encrypted, 'my-secret-password');
 * console.log(decrypted); // 'sensitive data'
 * ```
 */
export async function decrypt(
  encryptedData: string,
  password: string,
  options: AesGcmOptions = {}
): Promise<string> {
  if (isFallbackEncoded(encryptedData)) {
    return fallbackDecode(encryptedData);
  }

  if (!isCryptoAvailable()) {
    console.warn('Web Crypto API not available for decryption');
    throw new Error('Cannot decrypt: Web Crypto API not available');
  }

  try {
    const parsed: EncryptedData = JSON.parse(encryptedData);

    const data = base64ToArrayBuffer(parsed.data);
    const iv = base64ToArrayBuffer(parsed.iv);
    const salt = base64ToArrayBuffer(parsed.salt);

    const key = await deriveKey(password, new Uint8Array(salt), options);

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv as BufferSource },
      key,
      data
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * 检查数据是否已加密
 *
 * @param data - 要检查的数据
 * @returns 是否为加密数据格式
 */
export function isEncrypted(data: string): boolean {
  if (isFallbackEncoded(data)) {
    return true;
  }

  try {
    const parsed = JSON.parse(data);
    return (
      parsed &&
      typeof parsed.data === 'string' &&
      typeof parsed.iv === 'string' &&
      typeof parsed.salt === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * 测试加密功能是否可用
 *
 * @param password - 测试用密码
 * @returns 加密功能是否正常工作
 */
export async function testCrypto(password: string): Promise<boolean> {
  try {
    const testData = 'test-encryption-data';
    const encrypted = await encrypt(testData, password);
    const decrypted = await decrypt(encrypted, password);
    return testData === decrypted;
  } catch {
    return false;
  }
}

// ==================== 工厂函数 ====================

/**
 * 创建带有预配置密码的加密工具
 *
 * 适用于应用程序中需要使用固定密码的场景。
 *
 * @param getPassword - 获取密码的函数
 * @param options - 加密选项
 * @returns 加密工具对象
 *
 * @example
 * ```typescript
 * // 使用设备 ID 作为密码种子
 * const crypto = createCryptoUtils(() => {
 *   const deviceId = localStorage.getItem('deviceId') || generateId();
 *   return `app-v1-${deviceId}`;
 * });
 *
 * const encrypted = await crypto.encrypt('sensitive data');
 * const decrypted = await crypto.decrypt(encrypted);
 * ```
 */
export function createCryptoUtils(
  getPassword: () => string,
  options: AesGcmOptions = {}
) {
  return {
    /**
     * 加密数据
     */
    encrypt: (plaintext: string) => encrypt(plaintext, getPassword(), options),

    /**
     * 解密数据
     */
    decrypt: (encryptedData: string) =>
      decrypt(encryptedData, getPassword(), options),

    /**
     * 检查是否加密
     */
    isEncrypted,

    /**
     * 测试加密功能
     */
    testCrypto: () => testCrypto(getPassword()),

    /**
     * 检查是否支持加密
     */
    isCryptoSupported,
  };
}

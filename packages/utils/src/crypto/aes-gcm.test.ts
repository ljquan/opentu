/**
 * AES-GCM Crypto Utilities Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isEncrypted, isCryptoSupported } from './aes-gcm';

describe('isEncrypted', () => {
  it('should return true for valid encrypted data format', () => {
    const encryptedData = JSON.stringify({
      data: 'base64data',
      iv: 'base64iv',
      salt: 'base64salt',
    });
    expect(isEncrypted(encryptedData)).toBe(true);
  });

  it('should return true for fallback encoded data', () => {
    expect(isEncrypted('OPENTU_FB:SGVsbG8gV29ybGQ=')).toBe(true);
    expect(isEncrypted('AITU_FB:SGVsbG8gV29ybGQ=')).toBe(true);
  });

  it('should return false for plain text', () => {
    expect(isEncrypted('plain text')).toBe(false);
    expect(isEncrypted('{"key": "value"}')).toBe(false);
  });

  it('should return false for incomplete encrypted format', () => {
    expect(isEncrypted(JSON.stringify({ data: 'only' }))).toBe(false);
    expect(isEncrypted(JSON.stringify({ data: 'a', iv: 'b' }))).toBe(false);
  });

  it('should return false for invalid JSON', () => {
    expect(isEncrypted('not json')).toBe(false);
    expect(isEncrypted('{invalid json}')).toBe(false);
  });
});

describe('isCryptoSupported', () => {
  it('should return a boolean', () => {
    const result = isCryptoSupported();
    expect(typeof result).toBe('boolean');
  });
});

// Note: encrypt/decrypt tests require Web Crypto API which may not be available
// in all test environments. These are better tested in integration tests.
// 
// In a real browser environment with HTTPS, you would test:
// - encrypt('test', 'password') returns valid encrypted format
// - decrypt(encrypted, 'password') returns original text
// - decrypt with wrong password throws error
// - testCrypto('password') returns true

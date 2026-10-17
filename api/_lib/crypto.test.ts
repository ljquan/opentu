import { describe, expect, it, afterEach } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';

describe('provider secret encryption', () => {
  afterEach(() => {
    delete process.env.OPENTU_PROVIDER_ENCRYPTION_KEY;
  });

  it('round-trips with a base64 deployment key', () => {
    process.env.OPENTU_PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const encrypted = encryptSecret('provider-secret');

    expect(encrypted).not.toContain('provider-secret');
    expect(decryptSecret(encrypted)).toBe('provider-secret');
  });

  it('rejects a deployment key with the wrong length', () => {
    process.env.OPENTU_PROVIDER_ENCRYPTION_KEY = 'too-short';
    expect(() => encryptSecret('secret')).toThrow(/32-byte/);
  });
});

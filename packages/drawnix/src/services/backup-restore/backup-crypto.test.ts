// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptBackupJson, encryptBackupJson } from './backup-crypto';

describe('backup-crypto', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encrypts and decrypts backup secrets with a password', async () => {
    const encrypted = await encryptBackupJson(
      { apiKey: 'secret-key', providerProfiles: [{ id: 'p1' }] },
      'backup-password'
    );

    expect(encrypted.algorithm).toBe('AES-GCM');
    expect(JSON.stringify(encrypted)).not.toContain('secret-key');

    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await expect(
      decryptBackupJson(encrypted, 'wrong-password')
    ).rejects.toThrow();
    errorSpy.mockRestore();

    await expect(
      decryptBackupJson(encrypted, 'backup-password')
    ).resolves.toMatchObject({ apiKey: 'secret-key' });
  });
});

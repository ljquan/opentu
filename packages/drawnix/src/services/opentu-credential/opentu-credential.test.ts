import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateJwkThumbprint,
  createDpopProof,
  generateCredentialKeyMaterial,
  normalizeDpopHtu,
} from './dpop-crypto';
import {
  OPENTU_CREDENTIAL_DB_NAME,
  OPENTU_CREDENTIAL_STORE_NAME,
  OpenTuCredentialVault,
} from './credential-vault';
import { OpenTuCredentialSession } from './credential-session';

const cryptoProvider = webcrypto as unknown as Crypto;

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
}

async function createVaultWithCredential() {
  const idb = new IDBFactory();
  const vault = new OpenTuCredentialVault(idb, cryptoProvider);
  const material = await generateCredentialKeyMaterial(cryptoProvider);
  await vault.save({
    credentialId: 'credential-1',
    userId: 7,
    deviceId: 'device-1',
    refreshToken: 'refresh-1',
    publicJwk: material.publicJwk,
    privateKey: material.privateKey,
  });
  return { idb, vault, material };
}

describe('OpenTu DPoP crypto', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', cryptoProvider);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calculates an RFC 7638 P-256 thumbprint from public members only', async () => {
    await expect(
      calculateJwkThumbprint({
        kty: 'EC',
        crv: 'P-256',
        x: 'dj1HF7YFBqbqHORv2ymoTvYl2f4PJXsZbDG7hlpmIsM',
        y: 'CJ5UguHqCg4uLYqAnxeC8SzHs3lBpXX8fmA11PNvNtc',
        key_ops: ['verify'],
      })
    ).resolves.toBe('80aCL-opRNEPhZGd4wvr86j3WIk86q2geXyMhbImyq8');
  });

  it('normalizes htu without query or fragment and preserves trailing slash', () => {
    expect(
      normalizeDpopHtu('HTTPS://Example.COM:443/a/../b/%7eitem?secret=1#part')
    ).toBe('https://example.com/b/~item');
    expect(normalizeDpopHtu('https://example.com/a/')).toBe(
      'https://example.com/a/'
    );
    expect(normalizeDpopHtu('https://example.com/a')).toBe(
      'https://example.com/a'
    );
  });

  it('creates a verifiable token-bound ES256 DPoP proof', async () => {
    const material = await generateCredentialKeyMaterial(cryptoProvider);
    const proof = await createDpopProof(
      {
        privateKey: material.privateKey,
        publicJwk: material.publicJwk,
        method: 'post',
        url: 'http://127.0.0.1:5173/opentu/v1/relay?ignored=true',
        accessToken: 'access-token',
        nonce: 'server-nonce',
        issuedAt: 1_700_000_000,
        jti: 'proof-id',
      },
      cryptoProvider
    );
    const [encodedHeader, encodedPayload, encodedSignature] = proof.split('.');
    const header = decodeJwtPart<Record<string, unknown>>(encodedHeader);
    const payload = decodeJwtPart<Record<string, unknown>>(encodedPayload);
    const publicKey = await cryptoProvider.subtle.importKey(
      'jwk',
      material.publicJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    expect(header).toEqual({
      typ: 'dpop+jwt',
      alg: 'ES256',
      jwk: material.publicJwk,
    });
    expect(payload).toEqual({
      jti: 'proof-id',
      htm: 'POST',
      htu: 'http://127.0.0.1:5173/opentu/v1/relay',
      iat: 1_700_000_000,
      ath: 'Pxa-1wifRlPl7yG_0oJNfzqq7MelmOfonFgOFgapzFI',
      nonce: 'server-nonce',
    });
    await expect(
      cryptoProvider.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        Buffer.from(encodedSignature, 'base64url'),
        new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
      )
    ).resolves.toBe(true);
  });
});

describe('OpenTu credential vault', () => {
  it('round-trips a non-exportable key and keeps only credential material', async () => {
    const { idb, vault, material } = await createVaultWithCredential();
    const restored = await vault.load();

    expect(restored).toMatchObject({
      credentialId: 'credential-1',
      userId: 7,
      deviceId: 'device-1',
      refreshToken: 'refresh-1',
      publicJwk: material.publicJwk,
      jkt: material.jkt,
    });
    expect(restored?.privateKey.extractable).toBe(false);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open(OPENTU_CREDENTIAL_DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<Array<Record<string, unknown>>>(
      (resolve, reject) => {
        const request = db
          .transaction(OPENTU_CREDENTIAL_STORE_NAME, 'readonly')
          .objectStore(OPENTU_CREDENTIAL_STORE_NAME)
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    db.close();
    expect(records).not.toHaveLength(0);
    for (const record of records) {
      expect(record).not.toHaveProperty('accessToken');
      expect(record).not.toHaveProperty('nonce');
    }
  });

  it('keeps multiple credentials and switches with a separate active pointer', async () => {
    const idb = new IDBFactory();
    const vault = new OpenTuCredentialVault(idb, cryptoProvider);
    const first = await generateCredentialKeyMaterial(cryptoProvider);
    const second = await generateCredentialKeyMaterial(cryptoProvider);
    await vault.save({
      credentialId: 'credential-1',
      userId: 7,
      refreshToken: 'refresh-1',
      publicJwk: first.publicJwk,
      privateKey: first.privateKey,
    });
    await vault.save({
      credentialId: 'credential-2',
      userId: 8,
      refreshToken: 'refresh-2',
      publicJwk: second.publicJwk,
      privateKey: second.privateKey,
    });

    expect(await vault.load()).toMatchObject({ credentialId: 'credential-2' });
    expect(await vault.list()).toHaveLength(2);
    await vault.activateForUser(7);
    expect(await vault.load()).toMatchObject({
      credentialId: 'credential-1',
      refreshToken: 'refresh-1',
      userId: 7,
    });

    await vault.remove('credential-1');
    await expect(vault.load()).resolves.toBeNull();
    await expect(vault.findByUserId(7)).resolves.toBeNull();
    await expect(vault.activateForUser(8)).resolves.toMatchObject({
      credentialId: 'credential-2',
      userId: 8,
    });
  });

  it('performs a real IndexedDB key persistence probe', async () => {
    const vault = new OpenTuCredentialVault(new IDBFactory(), cryptoProvider);
    await expect(vault.probeNonExportableKeyPersistence()).resolves.toEqual({
      supported: true,
    });
    await expect(vault.load()).resolves.toBeNull();
  });

  it('reports an unsupported key probe without weakening extractability', async () => {
    const generateKey = vi
      .fn()
      .mockRejectedValue(new Error('clone unsupported'));
    const unsupportedCrypto = {
      subtle: { generateKey },
    } as unknown as Crypto;
    const vault = new OpenTuCredentialVault(
      new IDBFactory(),
      unsupportedCrypto
    );

    await expect(vault.probeNonExportableKeyPersistence()).resolves.toEqual({
      supported: false,
      reason: 'clone unsupported',
    });
    expect(generateKey).toHaveBeenCalledTimes(1);
    expect(generateKey).toHaveBeenCalledWith(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify']
    );
  });

  it('rejects an exportable private key', async () => {
    const vault = new OpenTuCredentialVault(new IDBFactory(), cryptoProvider);
    const keyPair = (await cryptoProvider.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const publicJwk = await cryptoProvider.subtle.exportKey(
      'jwk',
      keyPair.publicKey
    );

    await expect(
      vault.save({
        credentialId: 'credential-1',
        refreshToken: 'refresh-1',
        privateKey: keyPair.privateKey,
        publicJwk,
      })
    ).rejects.toThrow('non-exportable');
  });

  it('rejects a public JWK that does not match the private key', async () => {
    const vault = new OpenTuCredentialVault(new IDBFactory(), cryptoProvider);
    const first = await generateCredentialKeyMaterial(cryptoProvider);
    const second = await generateCredentialKeyMaterial(cryptoProvider);
    await expect(
      vault.save({
        credentialId: 'credential-1',
        refreshToken: 'refresh-1',
        privateKey: first.privateKey,
        publicJwk: second.publicJwk,
      })
    ).rejects.toThrow('does not match');
  });
});

describe('OpenTu credential session', () => {
  it('keeps access tokens and one-time nonces in memory only', async () => {
    const { vault } = await createVaultWithCredential();
    const session = new OpenTuCredentialSession(vault);
    session.setAccessToken('access-1', 2_000);
    session.setNonce('relay', 'nonce-1', 2_000);

    expect(session.getAccessToken(1_000)).toBe('access-1');
    expect(session.getAccessToken(2_000)).toBeNull();
    expect(session.consumeNonce('relay', 1_000)).toBe('nonce-1');
    expect(session.consumeNonce('relay', 1_000)).toBeNull();

    const restored = await vault.load();
    expect(restored).not.toHaveProperty('accessToken');
    expect(restored).not.toHaveProperty('nonce');
  });

  it('coalesces concurrent refresh and persists rotation before exposing access', async () => {
    const { vault } = await createVaultWithCredential();
    const session = new OpenTuCredentialSession(vault);
    let seenRefreshToken: string | undefined;
    let resolveRefresh!: (value: {
      accessToken: string;
      accessTokenExpiresAt: number;
      refreshToken: string;
    }) => void;
    const handler = vi.fn((credential: { refreshToken: string }) => {
      seenRefreshToken = credential.refreshToken;
      return new Promise<{
        accessToken: string;
        accessTokenExpiresAt: number;
        refreshToken: string;
      }>((resolve) => {
        resolveRefresh = resolve;
      });
    });

    const first = session.refresh(handler);
    const second = session.refresh(handler);
    expect(first).toBe(second);
    expect(handler).toHaveBeenCalledTimes(0);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(seenRefreshToken).toBe('refresh-1');

    resolveRefresh({
      accessToken: 'access-2',
      accessTokenExpiresAt: 5_000,
      refreshToken: 'refresh-2',
    });
    await expect(first).resolves.toMatchObject({ accessToken: 'access-2' });
    await expect(second).resolves.toMatchObject({ accessToken: 'access-2' });
    expect((await vault.load())?.refreshToken).toBe('refresh-2');
    expect((await vault.load())?.userId).toBe(7);
    expect(session.getAccessToken(1_000)).toBe('access-2');
  });

  it('clears a failed flight so a later refresh can retry', async () => {
    const { vault } = await createVaultWithCredential();
    const session = new OpenTuCredentialSession(vault);
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce({
        accessToken: 'access-2',
        accessTokenExpiresAt: 5_000,
        refreshToken: 'refresh-2',
      });

    await expect(session.refresh(handler)).rejects.toThrow('network failed');
    await expect(session.refresh(handler)).resolves.toMatchObject({
      accessToken: 'access-2',
    });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

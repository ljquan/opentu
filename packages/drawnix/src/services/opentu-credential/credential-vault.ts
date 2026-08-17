import {
  calculateJwkThumbprint,
  generateCredentialKeyMaterial,
  normalizeP256PublicJwk,
} from './dpop-crypto';
import type {
  CredentialVaultProbeResult,
  OpenTuCredentialInput,
  StoredOpenTuCredential,
} from './types';

export const OPENTU_CREDENTIAL_DB_NAME = 'opentu-credential-v1';
export const OPENTU_CREDENTIAL_STORE_NAME = 'credentials';
const DATABASE_VERSION = 1;
const ACTIVE_CREDENTIAL_KEY = 'active';
const ACTIVE_POINTER_KEY = '__active_credential__';
const CREDENTIAL_KEY_PREFIX = 'credential:';
const PROBE_CREDENTIAL_KEY = '__crypto_key_probe__';

interface CredentialRecord extends StoredOpenTuCredential {
  id: string;
}

interface ActiveCredentialPointer {
  id: typeof ACTIVE_POINTER_KEY;
  activeCredentialId: string;
}

type VaultRecord = CredentialRecord | ActiveCredentialPointer;

function credentialRecordKey(credentialId: string): string {
  return `${CREDENTIAL_KEY_PREFIX}${credentialId}`;
}

function isCredentialRecord(
  record: VaultRecord | undefined
): record is CredentialRecord {
  return Boolean(record && 'privateKey' in record && 'refreshToken' in record);
}

function assertUserId(userId: number | undefined): void {
  if (userId !== undefined && (!Number.isSafeInteger(userId) || userId <= 0)) {
    throw new Error('OpenTu credential user ID must be a positive integer');
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('IndexedDB request failed'));
  });
}

async function assertKeyPair(
  privateKey: CryptoKey,
  publicJwk: JsonWebKey,
  cryptoProvider: Crypto
): Promise<void> {
  const message = new TextEncoder().encode('opentu-credential-key-check');
  const signature = await cryptoProvider.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    message
  );
  const publicKey = await cryptoProvider.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const verified = await cryptoProvider.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    signature,
    message
  );
  if (!verified) throw new Error('Public JWK does not match the private key');
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

function assertPrivateKey(privateKey: CryptoKey): void {
  const algorithm = privateKey.algorithm as EcKeyAlgorithm;
  if (
    privateKey.type !== 'private' ||
    privateKey.extractable ||
    algorithm.name !== 'ECDSA' ||
    algorithm.namedCurve !== 'P-256' ||
    !privateKey.usages.includes('sign')
  ) {
    throw new Error(
      'Credential vault only accepts a non-exportable P-256 signing key'
    );
  }
}

export class OpenTuCredentialVault {
  constructor(
    private readonly idb: IDBFactory = indexedDB,
    private readonly cryptoProvider: Crypto = crypto
  ) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.idb.open(
        OPENTU_CREDENTIAL_DB_NAME,
        DATABASE_VERSION
      );
      request.onerror = () =>
        reject(request.error || new Error('Unable to open credential vault'));
      request.onblocked = () =>
        reject(new Error('Credential vault open was blocked'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OPENTU_CREDENTIAL_STORE_NAME)) {
          db.createObjectStore(OPENTU_CREDENTIAL_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  private async readRecord(id: string): Promise<VaultRecord | undefined> {
    const db = await this.open();
    try {
      const transaction = db.transaction(
        OPENTU_CREDENTIAL_STORE_NAME,
        'readonly'
      );
      return await requestResult<VaultRecord | undefined>(
        transaction.objectStore(OPENTU_CREDENTIAL_STORE_NAME).get(id)
      );
    } finally {
      db.close();
    }
  }

  private async writeRecord(record: CredentialRecord): Promise<void> {
    const db = await this.open();
    try {
      const transaction = db.transaction(
        OPENTU_CREDENTIAL_STORE_NAME,
        'readwrite'
      );
      transaction.objectStore(OPENTU_CREDENTIAL_STORE_NAME).put(record);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  private async writeCredentialAndActivate(
    record: CredentialRecord
  ): Promise<void> {
    const db = await this.open();
    try {
      const transaction = db.transaction(
        OPENTU_CREDENTIAL_STORE_NAME,
        'readwrite'
      );
      const store = transaction.objectStore(OPENTU_CREDENTIAL_STORE_NAME);
      store.put(record);
      store.put({
        id: ACTIVE_POINTER_KEY,
        activeCredentialId: record.credentialId,
      } satisfies ActiveCredentialPointer);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  private async deleteRecord(id: string): Promise<void> {
    const db = await this.open();
    try {
      const transaction = db.transaction(
        OPENTU_CREDENTIAL_STORE_NAME,
        'readwrite'
      );
      transaction.objectStore(OPENTU_CREDENTIAL_STORE_NAME).delete(id);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  private async hydrateCredential(
    record: CredentialRecord
  ): Promise<StoredOpenTuCredential> {
    assertPrivateKey(record.privateKey);
    assertUserId(record.userId);
    const publicJwk = normalizeP256PublicJwk(record.publicJwk);
    const jkt = await calculateJwkThumbprint(
      publicJwk,
      this.cryptoProvider.subtle
    );
    if (jkt !== record.jkt) {
      throw new Error('Stored credential thumbprint is invalid');
    }
    await assertKeyPair(record.privateKey, publicJwk, this.cryptoProvider);
    return {
      credentialId: record.credentialId,
      userId: record.userId,
      deviceId: record.deviceId,
      refreshToken: record.refreshToken,
      publicJwk,
      jkt,
      privateKey: record.privateKey,
      updatedAt: record.updatedAt,
    };
  }

  private async readCredentialRecords(): Promise<CredentialRecord[]> {
    const db = await this.open();
    try {
      const transaction = db.transaction(
        OPENTU_CREDENTIAL_STORE_NAME,
        'readonly'
      );
      const records = await requestResult<VaultRecord[]>(
        transaction.objectStore(OPENTU_CREDENTIAL_STORE_NAME).getAll()
      );
      return records
        .filter(isCredentialRecord)
        .filter((record) => record.id.startsWith(CREDENTIAL_KEY_PREFIX));
    } finally {
      db.close();
    }
  }

  async load(): Promise<StoredOpenTuCredential | null> {
    const pointer = await this.readRecord(ACTIVE_POINTER_KEY);
    let record =
      pointer && 'activeCredentialId' in pointer
        ? await this.readRecord(credentialRecordKey(pointer.activeCredentialId))
        : undefined;

    // Migrate the original single-record vault without exporting key material.
    if (!isCredentialRecord(record)) {
      const legacy = await this.readRecord(ACTIVE_CREDENTIAL_KEY);
      if (isCredentialRecord(legacy)) {
        record = {
          ...legacy,
          id: credentialRecordKey(legacy.credentialId),
        };
        await this.writeCredentialAndActivate(record);
        await this.deleteRecord(ACTIVE_CREDENTIAL_KEY);
      }
    }
    if (!isCredentialRecord(record)) return null;
    return this.hydrateCredential(record);
  }

  async save(input: OpenTuCredentialInput): Promise<StoredOpenTuCredential> {
    assertPrivateKey(input.privateKey);
    assertUserId(input.userId);
    if (!input.credentialId.trim() || !input.refreshToken) {
      throw new Error('Credential ID and refresh token are required');
    }

    const publicJwk = normalizeP256PublicJwk(input.publicJwk);
    await assertKeyPair(input.privateKey, publicJwk, this.cryptoProvider);
    const jkt = await calculateJwkThumbprint(
      publicJwk,
      this.cryptoProvider.subtle
    );
    const credential: StoredOpenTuCredential = {
      credentialId: input.credentialId,
      userId: input.userId,
      deviceId: input.deviceId,
      refreshToken: input.refreshToken,
      publicJwk,
      jkt,
      privateKey: input.privateKey,
      updatedAt: Date.now(),
    };
    await this.writeCredentialAndActivate({
      id: credentialRecordKey(credential.credentialId),
      ...credential,
    });
    return credential;
  }

  async clear(): Promise<void> {
    const current = await this.load();
    const db = await this.open();
    try {
      const transaction = db.transaction(
        OPENTU_CREDENTIAL_STORE_NAME,
        'readwrite'
      );
      const store = transaction.objectStore(OPENTU_CREDENTIAL_STORE_NAME);
      if (current) store.delete(credentialRecordKey(current.credentialId));
      store.delete(ACTIVE_POINTER_KEY);
      store.delete(ACTIVE_CREDENTIAL_KEY);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  async activate(credentialId: string): Promise<StoredOpenTuCredential> {
    const normalizedId = credentialId.trim();
    const record = await this.readRecord(credentialRecordKey(normalizedId));
    if (!normalizedId || !isCredentialRecord(record)) {
      throw new Error('OpenTu credential is not available');
    }
    await this.writeCredentialAndActivate(record);
    const active = await this.load();
    if (!active) throw new Error('OpenTu credential activation failed');
    return active;
  }

  async findByUserId(userId: number): Promise<StoredOpenTuCredential | null> {
    assertUserId(userId);
    const matches = (await this.readCredentialRecords())
      .filter((record) => record.userId === userId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    if (matches.length === 0) return null;
    return this.hydrateCredential(matches[0]);
  }

  async activateForUser(
    userId: number
  ): Promise<StoredOpenTuCredential | null> {
    assertUserId(userId);
    const record = (await this.readCredentialRecords())
      .filter((candidate) => candidate.userId === userId)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (!record) return null;
    try {
      await this.writeCredentialAndActivate(record);
      return await this.hydrateCredential(record);
    } catch {
      await this.remove(record.credentialId);
      return null;
    }
  }

  async setUserId(
    credentialId: string,
    userId: number
  ): Promise<StoredOpenTuCredential> {
    assertUserId(userId);
    const normalizedId = credentialId.trim();
    const record = await this.readRecord(credentialRecordKey(normalizedId));
    if (!normalizedId || !isCredentialRecord(record)) {
      throw new Error('OpenTu credential is not available');
    }
    const updated = { ...record, userId, updatedAt: Date.now() };
    await this.writeCredentialAndActivate(updated);
    return this.hydrateCredential(updated);
  }

  async remove(credentialId: string): Promise<void> {
    const normalizedId = credentialId.trim();
    if (!normalizedId) return;
    const pointer = await this.readRecord(ACTIVE_POINTER_KEY);
    const db = await this.open();
    try {
      const transaction = db.transaction(
        OPENTU_CREDENTIAL_STORE_NAME,
        'readwrite'
      );
      const store = transaction.objectStore(OPENTU_CREDENTIAL_STORE_NAME);
      store.delete(credentialRecordKey(normalizedId));
      if (
        pointer &&
        'activeCredentialId' in pointer &&
        pointer.activeCredentialId === normalizedId
      ) {
        store.delete(ACTIVE_POINTER_KEY);
      }
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  async list(): Promise<
    Array<
      Pick<
        StoredOpenTuCredential,
        'credentialId' | 'userId' | 'deviceId' | 'updatedAt'
      >
    >
  > {
    const db = await this.open();
    try {
      const transaction = db.transaction(
        OPENTU_CREDENTIAL_STORE_NAME,
        'readonly'
      );
      const records = await requestResult<VaultRecord[]>(
        transaction.objectStore(OPENTU_CREDENTIAL_STORE_NAME).getAll()
      );
      return records
        .filter(isCredentialRecord)
        .filter((record) => record.id.startsWith(CREDENTIAL_KEY_PREFIX))
        .map(({ credentialId, userId, deviceId, updatedAt }) => ({
          credentialId,
          userId,
          deviceId,
          updatedAt,
        }));
    } finally {
      db.close();
    }
  }

  async probeNonExportableKeyPersistence(): Promise<CredentialVaultProbeResult> {
    try {
      const material = await generateCredentialKeyMaterial(this.cryptoProvider);
      await this.writeRecord({
        id: PROBE_CREDENTIAL_KEY,
        credentialId: PROBE_CREDENTIAL_KEY,
        refreshToken: PROBE_CREDENTIAL_KEY,
        publicJwk: material.publicJwk,
        jkt: material.jkt,
        privateKey: material.privateKey,
        updatedAt: Date.now(),
      });

      const restored = await this.readRecord(PROBE_CREDENTIAL_KEY);
      if (!isCredentialRecord(restored)) {
        throw new Error('Persisted key was not found');
      }
      assertPrivateKey(restored.privateKey);

      await assertKeyPair(
        restored.privateKey,
        restored.publicJwk,
        this.cryptoProvider
      );
      return { supported: true };
    } catch (error) {
      return {
        supported: false,
        reason:
          error instanceof Error
            ? error.message
            : 'Credential key probe failed',
      };
    } finally {
      try {
        await this.deleteRecord(PROBE_CREDENTIAL_KEY);
      } catch {
        // A failed capability probe must not mask its original result.
      }
    }
  }
}

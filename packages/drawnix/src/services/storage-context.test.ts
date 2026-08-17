import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyIndexedDB } from './indexeddb-namespace-migration';
import {
  activateStorageNamespace,
  createStorageNamespace,
  getNamespacedDatabaseName,
} from './storage-context';

function openDatabase(
  idb: IDBFactory,
  name: string,
  stores: string[],
  version = 1
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(name, version);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      for (const store of stores) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function put(
  db: IDBDatabase,
  storeName: string,
  value: { id: string; value: string }
): Promise<void> {
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
}

async function get(
  db: IDBDatabase,
  storeName: string,
  id: string
): Promise<{ id: string; value: string } | undefined> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(storeName, 'readonly')
      .objectStore(storeName)
      .get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('credential-scoped storage context', () => {
  afterEach(() => {
    activateStorageNamespace(createStorageNamespace(null));
  });

  it('uses an explicit anonymous namespace and safely encodes credentials', () => {
    expect(getNamespacedDatabaseName('aitu-app')).toBe('aitu-app--anonymous');
    const namespace = createStorageNamespace(' user/张三? ');
    expect(namespace.kind).toBe('credential');
    expect(namespace.key).toMatch(/^credential-[A-Za-z0-9_-]+$/);
    activateStorageNamespace(namespace);
    expect(getNamespacedDatabaseName('aitu-workspace')).toBe(
      `aitu-workspace--${namespace.key}`
    );
  });

  it('rejects empty, control-character, and oversized credential IDs', () => {
    expect(() => createStorageNamespace('   ')).toThrow('Invalid credential');
    expect(() => createStorageNamespace('bad\u0000id')).toThrow(
      'Invalid credential'
    );
    expect(() => createStorageNamespace('x'.repeat(257))).toThrow(
      'Invalid credential'
    );
  });
});

describe('legacy IndexedDB namespace migration', () => {
  it('copies and verifies stores, remains idempotent, and preserves source', async () => {
    const idb = new IDBFactory();
    const source = await openDatabase(idb, 'legacy', ['tasks', 'state']);
    const target = await openDatabase(idb, 'target', ['tasks', 'state']);
    await put(source, 'tasks', { id: 'task-1', value: 'legacy-task' });
    await put(source, 'state', { id: 'state-1', value: 'legacy-state' });
    source.close();
    target.close();

    const options = {
      idb,
      sourceDatabaseName: 'legacy',
      targetDatabaseName: 'target',
      stores: ['tasks', 'state'],
    } as const;
    await migrateLegacyIndexedDB(options);

    const migrated = await openDatabase(idb, 'target', ['tasks', 'state']);
    expect(await get(migrated, 'tasks', 'task-1')).toEqual({
      id: 'task-1',
      value: 'legacy-task',
    });
    expect(await get(migrated, 'state', 'state-1')).toEqual({
      id: 'state-1',
      value: 'legacy-state',
    });
    migrated.close();

    const reopenedSource = await openDatabase(idb, 'legacy', [
      'tasks',
      'state',
    ]);
    expect(await get(reopenedSource, 'tasks', 'task-1')).toEqual({
      id: 'task-1',
      value: 'legacy-task',
    });
    await put(reopenedSource, 'tasks', {
      id: 'task-1',
      value: 'changed-after-migration',
    });
    reopenedSource.close();

    await migrateLegacyIndexedDB(options);
    const idempotentTarget = await openDatabase(idb, 'target', [
      'tasks',
      'state',
    ]);
    expect(await get(idempotentTarget, 'tasks', 'task-1')).toEqual({
      id: 'task-1',
      value: 'legacy-task',
    });
    idempotentTarget.close();
  });

  it('preserves out-of-line keys used by localForage stores', async () => {
    const idb = new IDBFactory();
    const openKeyValueDatabase = (name: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = idb.open(name, 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('keyvaluepairs');
        request.onsuccess = () => resolve(request.result);
      });
    const source = await openKeyValueDatabase('legacy-out-of-line');
    const target = await openKeyValueDatabase('target-out-of-line');
    const write = source.transaction('keyvaluepairs', 'readwrite');
    write.objectStore('keyvaluepairs').put({ value: 'board' }, 'board-1');
    await transactionDone(write);
    source.close();
    target.close();

    await migrateLegacyIndexedDB({
      idb,
      sourceDatabaseName: 'legacy-out-of-line',
      targetDatabaseName: 'target-out-of-line',
      stores: ['keyvaluepairs'],
    });

    const migrated = await openKeyValueDatabase('target-out-of-line');
    const read = migrated.transaction('keyvaluepairs', 'readonly');
    await expect(
      new Promise((resolve, reject) => {
        const request = read.objectStore('keyvaluepairs').get('board-1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
    ).resolves.toEqual({ value: 'board' });
    migrated.close();
  });

  it('resumes after a target schema failure without recopying completed stores', async () => {
    const idb = new IDBFactory();
    const source = await openDatabase(idb, 'legacy-resume', ['tasks', 'state']);
    const target = await openDatabase(idb, 'target-resume', ['tasks']);
    await put(source, 'tasks', { id: 'task-1', value: 'first-copy' });
    await put(source, 'state', { id: 'state-1', value: 'resumed-copy' });
    source.close();
    target.close();

    const options = {
      idb,
      sourceDatabaseName: 'legacy-resume',
      targetDatabaseName: 'target-resume',
      stores: ['tasks', 'state'],
    } as const;
    await expect(migrateLegacyIndexedDB(options)).rejects.toThrow(
      'missing store state'
    );

    const changedSource = await openDatabase(idb, 'legacy-resume', [
      'tasks',
      'state',
    ]);
    await put(changedSource, 'tasks', {
      id: 'task-1',
      value: 'must-not-recopy',
    });
    changedSource.close();

    const repairedTarget = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open('target-resume', 2);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('state', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
    });
    repairedTarget.close();

    await migrateLegacyIndexedDB(options);
    const migrated = await openDatabase(
      idb,
      'target-resume',
      ['tasks', 'state'],
      2
    );
    expect(await get(migrated, 'tasks', 'task-1')).toMatchObject({
      value: 'first-copy',
    });
    expect(await get(migrated, 'state', 'state-1')).toMatchObject({
      value: 'resumed-copy',
    });
    migrated.close();
  });

  it('claims each legacy source once and never copies it to another credential', async () => {
    const idb = new IDBFactory();
    const source = await openDatabase(idb, 'legacy-claimed', ['tasks']);
    const firstTarget = await openDatabase(idb, 'credential-one', ['tasks']);
    const secondTarget = await openDatabase(idb, 'credential-two', ['tasks']);
    await put(source, 'tasks', { id: 'task-1', value: 'legacy-task' });
    source.close();
    firstTarget.close();
    secondTarget.close();

    await migrateLegacyIndexedDB({
      idb,
      sourceDatabaseName: 'legacy-claimed',
      targetDatabaseName: 'credential-one',
      stores: ['tasks'],
    });
    await migrateLegacyIndexedDB({
      idb,
      sourceDatabaseName: 'legacy-claimed',
      targetDatabaseName: 'credential-two',
      stores: ['tasks'],
    });

    const migratedFirst = await openDatabase(idb, 'credential-one', ['tasks']);
    const untouchedSecond = await openDatabase(idb, 'credential-two', [
      'tasks',
    ]);
    expect(await get(migratedFirst, 'tasks', 'task-1')).toMatchObject({
      value: 'legacy-task',
    });
    expect(await get(untouchedSecond, 'tasks', 'task-1')).toBeUndefined();
    migratedFirst.close();
    untouchedSecond.close();
  });
});

const MIGRATION_DB_NAME = 'opentu-storage-migrations-v1';
const MIGRATION_STORE_NAME = 'markers';

interface MigrationMarker {
  id: string;
  targetDatabaseName: string;
  completedStores: string[];
  completed: boolean;
  updatedAt: number;
}

export interface NamespaceMigrationOptions {
  sourceDatabaseName: string;
  targetDatabaseName: string;
  stores: readonly string[];
  idb?: IDBFactory;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('IndexedDB request failed'));
  });
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

function openMigrationDatabase(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(MIGRATION_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MIGRATION_STORE_NAME)) {
        request.result.createObjectStore(MIGRATION_STORE_NAME, {
          keyPath: 'id',
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function openExistingDatabase(
  idb: IDBFactory,
  name: string
): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = idb.open(name);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      finish(null);
    };
    request.onerror = () => finish(null);
    request.onsuccess = () => finish(request.result);
  });
}

async function claimMarker(
  db: IDBDatabase,
  id: string,
  targetDatabaseName: string
): Promise<MigrationMarker> {
  const transaction = db.transaction(MIGRATION_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(MIGRATION_STORE_NAME);
  let marker = await requestResult<MigrationMarker | undefined>(store.get(id));
  if (!marker) {
    marker = {
      id,
      targetDatabaseName,
      completedStores: [],
      completed: false,
      updatedAt: Date.now(),
    };
    store.put(marker);
  }
  await transactionDone(transaction);
  return marker;
}

async function writeMarker(
  db: IDBDatabase,
  marker: MigrationMarker
): Promise<void> {
  const transaction = db.transaction(MIGRATION_STORE_NAME, 'readwrite');
  transaction.objectStore(MIGRATION_STORE_NAME).put(marker);
  await transactionDone(transaction);
}

async function copyAndVerifyStore(
  source: IDBDatabase,
  target: IDBDatabase,
  storeName: string
): Promise<void> {
  const sourceTransaction = source.transaction(storeName, 'readonly');
  const sourceStore = sourceTransaction.objectStore(storeName);
  const [records, keys] = await Promise.all([
    requestResult(sourceStore.getAll()),
    requestResult(sourceStore.getAllKeys()),
  ]);

  if (records.length > 0) {
    if (records.length !== keys.length) {
      throw new Error(`Migration source changed while copying ${storeName}`);
    }
    const targetTransaction = target.transaction(storeName, 'readwrite');
    const targetStore = targetTransaction.objectStore(storeName);
    records.forEach((record, index) => {
      if (targetStore.keyPath === null) {
        targetStore.put(record, keys[index]);
      } else {
        targetStore.put(record);
      }
    });
    await transactionDone(targetTransaction);
  }

  const verificationTransaction = target.transaction(storeName, 'readonly');
  const verificationStore = verificationTransaction.objectStore(storeName);
  const migratedKeys = await Promise.all(
    keys.map((key) => requestResult(verificationStore.getKey(key)))
  );
  if (migratedKeys.some((key) => key === undefined)) {
    throw new Error(`Migration verification failed for ${storeName}`);
  }
}

/** Copy legacy content into a namespace without ever deleting the source. */
export async function migrateLegacyIndexedDB(
  options: NamespaceMigrationOptions
): Promise<void> {
  const idb = options.idb ?? indexedDB;
  if (options.sourceDatabaseName === options.targetDatabaseName) return;

  const markerDb = await openMigrationDatabase(idb);
  try {
    const source = await openExistingDatabase(idb, options.sourceDatabaseName);
    if (!source) return;
    const target = await openExistingDatabase(idb, options.targetDatabaseName);
    if (!target) {
      source.close();
      throw new Error('Namespaced target database must exist before migration');
    }

    try {
      const markerId = `legacy-source:${options.sourceDatabaseName}`;
      let marker = await claimMarker(
        markerDb,
        markerId,
        options.targetDatabaseName
      );
      if (marker.targetDatabaseName !== options.targetDatabaseName) {
        if (marker.completed) return;
        throw new Error(
          `Legacy database ${options.sourceDatabaseName} is already claimed by an incomplete migration`
        );
      }
      if (marker.completed) return;

      for (const storeName of options.stores) {
        if (marker.completedStores.includes(storeName)) continue;
        if (
          source.objectStoreNames.contains(storeName) &&
          !target.objectStoreNames.contains(storeName)
        ) {
          throw new Error(`Migration target is missing store ${storeName}`);
        }
        if (source.objectStoreNames.contains(storeName)) {
          await copyAndVerifyStore(source, target, storeName);
        }
        marker = {
          ...marker,
          completedStores: [...marker.completedStores, storeName],
          updatedAt: Date.now(),
        };
        await writeMarker(markerDb, marker);
      }
      await writeMarker(markerDb, {
        ...marker,
        completed: true,
        updatedAt: Date.now(),
      });
    } finally {
      source.close();
      target.close();
    }
  } finally {
    markerDb.close();
  }
}

const CACHE_NAME = 'aitu-ppt-explainer-internal-v1';
const CACHE_PATH_PREFIX = '/__aitu_internal__/ppt-explainer';
const FALLBACK_DB_NAME = 'aitu-ppt-explainer-internal';
const FALLBACK_DB_VERSION = 1;
const FALLBACK_STORE_NAME = 'artifacts';
const FALLBACK_JOB_INDEX = 'jobId';

interface PptExplainerArtifactRecord {
  url: string;
  jobId: string;
  blob: Blob;
}

function sanitizeSegment(value: string): string {
  return encodeURIComponent(value.replace(/[\r\n\0]/g, '').slice(0, 180));
}

function normalizeArtifactUrl(url: string): string {
  try {
    return new URL(url, globalThis.location?.origin || 'https://opentu.invalid')
      .pathname;
  } catch {
    return url;
  }
}

function openFallbackDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(
      new Error('当前浏览器环境不支持 PPT 讲解任务的持久化缓存')
    );
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FALLBACK_DB_NAME, FALLBACK_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(FALLBACK_STORE_NAME)
        ? request.transaction!.objectStore(FALLBACK_STORE_NAME)
        : database.createObjectStore(FALLBACK_STORE_NAME, { keyPath: 'url' });
      if (!store.indexNames.contains(FALLBACK_JOB_INDEX)) {
        store.createIndex(FALLBACK_JOB_INDEX, 'jobId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('PPT 讲解任务 IndexedDB 打开失败'));
    request.onblocked = () =>
      reject(new Error('PPT 讲解任务 IndexedDB 升级被其他页面阻塞'));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error('PPT 讲解缓存写入失败'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('PPT 讲解缓存事务已中止'));
  });
}

async function putFallbackArtifact(
  record: PptExplainerArtifactRecord
): Promise<void> {
  const database = await openFallbackDatabase();
  try {
    const transaction = database.transaction(FALLBACK_STORE_NAME, 'readwrite');
    transaction.objectStore(FALLBACK_STORE_NAME).put(record);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

async function getFallbackArtifact(url: string): Promise<Blob | null> {
  const database = await openFallbackDatabase();
  try {
    const transaction = database.transaction(FALLBACK_STORE_NAME, 'readonly');
    const transactionDone = waitForTransaction(transaction);
    const request = transaction
      .objectStore(FALLBACK_STORE_NAME)
      .get(normalizeArtifactUrl(url));
    const result = await new Promise<PptExplainerArtifactRecord | undefined>(
      (resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    await transactionDone;
    return result?.blob || null;
  } finally {
    database.close();
  }
}

async function deleteFallbackArtifact(url: string): Promise<void> {
  const database = await openFallbackDatabase();
  try {
    const transaction = database.transaction(FALLBACK_STORE_NAME, 'readwrite');
    transaction
      .objectStore(FALLBACK_STORE_NAME)
      .delete(normalizeArtifactUrl(url));
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

async function deleteFallbackArtifactsByJobId(jobId: string): Promise<void> {
  const database = await openFallbackDatabase();
  try {
    const transaction = database.transaction(FALLBACK_STORE_NAME, 'readwrite');
    const transactionDone = waitForTransaction(transaction);
    const request = transaction
      .objectStore(FALLBACK_STORE_NAME)
      .index(FALLBACK_JOB_INDEX)
      .openCursor(IDBKeyRange.only(jobId));
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    await transactionDone;
  } finally {
    database.close();
  }
}

export function createPptExplainerArtifactUrl(
  jobId: string,
  artifactName: string
): string {
  return `${CACHE_PATH_PREFIX}/${sanitizeSegment(jobId)}/${sanitizeSegment(
    artifactName
  )}`;
}

export async function putPptExplainerArtifact(
  jobId: string,
  artifactName: string,
  blob: Blob
): Promise<string> {
  const url = createPptExplainerArtifactUrl(jobId, artifactName);
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(
        url,
        new Response(blob, {
          headers: {
            'Content-Type': blob.type || 'application/octet-stream',
            'Content-Length': String(blob.size),
            'X-OpenTu-Visibility': 'internal',
          },
        })
      );
      return url;
    } catch {
      // LAN HTTP and privacy modes may expose Cache Storage but reject writes.
    }
  }
  await putFallbackArtifact({
    url: normalizeArtifactUrl(url),
    jobId,
    blob,
  });
  return url;
}

export async function getPptExplainerArtifact(
  url: string
): Promise<Blob | null> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(url);
      if (response) return response.blob();
    } catch {
      // Continue with the IndexedDB fallback.
    }
  }
  return getFallbackArtifact(url).catch(() => null);
}

export async function deletePptExplainerArtifact(url: string): Promise<void> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.delete(url);
    } catch {
      // Continue with the IndexedDB fallback.
    }
  }
  await deleteFallbackArtifact(url).catch(() => undefined);
}

export async function deletePptExplainerArtifacts(
  jobId: string
): Promise<void> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const prefix = `${CACHE_PATH_PREFIX}/${sanitizeSegment(jobId)}/`;
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((request) => new URL(request.url).pathname.startsWith(prefix))
          .map((request) => cache.delete(request))
      );
    } catch {
      // Continue with the IndexedDB fallback.
    }
  }
  await deleteFallbackArtifactsByJobId(jobId).catch(() => undefined);
}

export function isPptExplainerArtifactUrl(url: string): boolean {
  try {
    return new URL(
      url,
      globalThis.location?.origin || 'https://opentu.invalid'
    ).pathname.startsWith(`${CACHE_PATH_PREFIX}/`);
  } catch {
    return false;
  }
}

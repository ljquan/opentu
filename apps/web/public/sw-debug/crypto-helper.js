/**
 * Crypto Helper for SW Debug Panel
 * Simplified version of drawnix/src/utils/crypto-utils.ts and related services
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const DRAWNIX_DEVICE_ID_KEY = 'drawnix_device_id';
const FALLBACK_PREFIX = 'DRAWNIX_FB:';

// Sync Config Constants
const FIXED_SALT = 'opentu-sync-v1';
const PBKDF2_ITERATIONS = 100000;
const KV_DB_NAME = 'aitu-storage';
const KV_STORE_NAME = 'data';
const SYNC_CONFIG_KEY = 'github_sync_config';
const SYNC_PASSWORD_KEY = 'github_sync_password';
const MASTER_INDEX_KEY = 'github_sync_master_index';
const SHARD_ENABLED_KEY = 'github_sync_shard_enabled';

// Other IndexedDB databases
const SW_TASK_QUEUE_DB = 'sw-task-queue';
const WORKSPACE_DB = 'aitu-workspace';
const CACHE_STORAGE_NAME = 'drawnix-images';

/**
 * Check if Web Crypto API is available
 */
function isCryptoAvailable() {
  return (
    typeof crypto !== 'undefined' &&
    crypto.subtle !== undefined &&
    typeof crypto.subtle.importKey === 'function'
  );
}

/**
 * ArrayBuffer to Base64
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
}

/**
 * Base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
  const binary = globalThis.atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

/**
 * Get device ID from local storage
 */
function getDeviceId() {
  let deviceId = localStorage.getItem(DRAWNIX_DEVICE_ID_KEY);
  if (!deviceId) {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2);
    deviceId = `${timestamp}-${random}`;
  }
  return deviceId;
}

/**
 * Generate password seed for Token Encryption
 */
function generatePasswordSeed() {
  const deviceId = getDeviceId();
  const stableInfo = [
    deviceId,
    navigator.language || 'en-US',
    'drawnix-crypto-key',
  ].join('-');

  return `drawnix-v2-${stableInfo}`;
}

/**
 * Derive key from password and salt
 */
async function deriveKey(password, salt) {
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
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Decrypt Token (localStorage)
 * @param {string} encryptedData
 */
export async function decryptToken(encryptedData) {
  if (encryptedData.startsWith(FALLBACK_PREFIX)) {
    const data = encryptedData.slice(FALLBACK_PREFIX.length);
    return decodeURIComponent(globalThis.atob(data));
  }

  if (!isCryptoAvailable()) {
    throw new Error('Web Crypto API not available');
  }

  try {
    const parsed = JSON.parse(encryptedData);

    const data = base64ToArrayBuffer(parsed.data);
    const iv = base64ToArrayBuffer(parsed.iv);
    const salt = base64ToArrayBuffer(parsed.salt);

    const password = generatePasswordSeed();
    const key = await deriveKey(password, new Uint8Array(salt));

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv },
      key,
      data
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error('Token Decryption failed:', error);
    throw new Error('Failed to decrypt token');
  }
}

/**
 * Get Device Key for Custom Password Encryption (XOR)
 */
function getDeviceKey() {
  const features = [
    navigator.userAgent,
    navigator.language,
    screen.width.toString(),
    screen.height.toString(),
    new Date().getTimezoneOffset().toString(),
  ];
  return features.join('|');
}

/**
 * Decrypt Custom Password (Simple XOR)
 */
function decryptCustomPassword(encrypted) {
  try {
    const key = getDeviceKey();
    const decoded = atob(encrypted);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch (e) {
    console.error('Custom password decryption failed', e);
    return null;
  }
}

/**
 * Read from IndexedDB KV Store
 */
function getFromKVStore(key) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KV_DB_NAME);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV_STORE_NAME)) {
        db.close();
        resolve(null);
        return;
      }

      const transaction = db.transaction(KV_STORE_NAME, 'readonly');
      const store = transaction.objectStore(KV_STORE_NAME);
      const getReq = store.get(key);

      getReq.onsuccess = () => {
        resolve(getReq.result ? getReq.result.value : null);
      };

      getReq.onerror = () => reject(getReq.error);

      transaction.oncomplete = () => db.close();
    };
  });
}

/**
 * Get Gist Config and Credentials
 */
export async function getGistCredentials() {
  try {
    const config = await getFromKVStore(SYNC_CONFIG_KEY);
    const storedPassword = await getFromKVStore(SYNC_PASSWORD_KEY);

    let customPassword = null;
    if (storedPassword && storedPassword.encrypted) {
      customPassword = decryptCustomPassword(storedPassword.encrypted);
    }

    return {
      gistId: config ? config.gistId : null,
      customPassword,
    };
  } catch (error) {
    console.error('Failed to get gist credentials:', error);
    return { gistId: null, customPassword: null };
  }
}

/**
 * Derive Key for Gist Data (CryptoService)
 */
async function deriveGistKey(secret) {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(secret + FIXED_SALT);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordData,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const salt = encoder.encode(FIXED_SALT);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Decrypt Gist File Content
 */
export async function decryptGistFile(content, gistId, customPassword) {
  try {
    const data = JSON.parse(content);

    // Check if it's encrypted data
    if (data.encrypted !== true || !data.iv || !data.data) {
      return content; // Return as is if not encrypted
    }

    // Determine secret to use
    let secret = gistId;
    if (data.customPassword && customPassword) {
      secret = customPassword;
    } else if (data.customPassword && !customPassword) {
      throw new Error('File encrypted with custom password but none provided');
    }

    const key = await deriveGistKey(secret);
    const iv = base64ToArrayBuffer(data.iv);
    const encryptedData = base64ToArrayBuffer(data.data);

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv },
      key,
      encryptedData
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    // If it's not JSON, it might be plain text
    if (error instanceof SyntaxError) {
      return content;
    }
    console.error('Gist file decryption failed:', error);
    throw error;
  }
}

// ====================================
// Extended Functions for Gist Debug Panel
// ====================================

/**
 * Get full sync config from IndexedDB
 */
export async function getSyncConfig() {
  try {
    const config = await getFromKVStore(SYNC_CONFIG_KEY);
    return config || null;
  } catch (error) {
    console.error('Failed to get sync config:', error);
    return null;
  }
}

/**
 * Get shard system enabled status
 */
export async function getShardEnabledStatus() {
  try {
    const enabled = await getFromKVStore(SHARD_ENABLED_KEY);
    return enabled === true;
  } catch (error) {
    console.error('Failed to get shard enabled status:', error);
    return false;
  }
}

/**
 * Get local master index from IndexedDB cache
 */
export async function getLocalMasterIndex() {
  try {
    const masterIndex = await getFromKVStore(MASTER_INDEX_KEY);
    return masterIndex || null;
  } catch (error) {
    console.error('Failed to get local master index:', error);
    return null;
  }
}

/**
 * Check if sync password is set
 */
export async function hasCustomPassword() {
  try {
    const storedPassword = await getFromKVStore(SYNC_PASSWORD_KEY);
    return !!(storedPassword && storedPassword.encrypted);
  } catch (error) {
    console.error('Failed to check password status:', error);
    return false;
  }
}

/**
 * Get device ID
 */
export function getDeviceIdExported() {
  return getDeviceId();
}

/**
 * Read all items from an IndexedDB store
 * Handles both regular IndexedDB and localforage data formats
 */
function getAllFromStore(dbName, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve([]);
        return;
      }

      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const getAllReq = store.getAll();

      getAllReq.onsuccess = () => {
        const results = getAllReq.result || [];
        resolve(results);
      };

      getAllReq.onerror = () => reject(getAllReq.error);

      transaction.oncomplete = () => db.close();
    };
  });
}

/**
 * Diagnose IndexedDB structure for debugging
 */
export async function diagnoseDatabase(dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onerror = () => reject(request.error);

    request.onsuccess = async () => {
      const db = request.result;
      const result = {
        name: db.name,
        version: db.version,
        stores: {},
      };

      const storeNames = [...db.objectStoreNames];

      for (const storeName of storeNames) {
        try {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);

          const countReq = store.count();
          const count = await new Promise((res) => {
            countReq.onsuccess = () => res(countReq.result);
            countReq.onerror = () => res(-1);
          });

          // Get sample item
          const getAllReq = store.getAll(null, 1);
          const samples = await new Promise((res) => {
            getAllReq.onsuccess = () => res(getAllReq.result || []);
            getAllReq.onerror = () => res([]);
          });

          result.stores[storeName] = {
            count,
            keyPath: store.keyPath,
            indexNames: [...store.indexNames],
            sampleKeys:
              samples.length > 0 ? Object.keys(samples[0]).slice(0, 8) : [],
          };
        } catch (e) {
          result.stores[storeName] = { error: e.message };
        }
      }

      db.close();
      resolve(result);
    };
  });
}

/**
 * Get local tasks from SW task queue IndexedDB
 */
export async function getLocalTasks() {
  try {
    const tasks = await getAllFromStore(SW_TASK_QUEUE_DB, 'tasks');
    return tasks;
  } catch (error) {
    console.error('Failed to get local tasks:', error);
    return [];
  }
}

/**
 * Get local boards from workspace IndexedDB
 */
export async function getLocalBoards() {
  try {
    const boards = await getAllFromStore(WORKSPACE_DB, 'boards');
    return boards;
  } catch (error) {
    console.error('Failed to get local boards:', error);
    return [];
  }
}

/**
 * List all media URLs from Cache Storage
 */
export async function listCacheStorageMedia() {
  try {
    const cache = await caches.open(CACHE_STORAGE_NAME);
    const keys = await cache.keys();

    const mediaList = keys.map((request) => {
      const url = request.url;
      return {
        url,
        // Extract filename from URL
        filename: url.split('/').pop() || url,
      };
    });

    return mediaList;
  } catch (error) {
    console.error('Failed to list cache storage media:', error);
    return [];
  }
}

/**
 * Get Cache Storage statistics
 */
export async function getCacheStorageStats() {
  try {
    const cache = await caches.open(CACHE_STORAGE_NAME);
    const keys = await cache.keys();

    let totalSize = 0;
    let imageCount = 0;
    let videoCount = 0;

    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.clone().blob();
        totalSize += blob.size;

        const contentType = response.headers.get('content-type') || '';
        if (contentType.startsWith('image/')) {
          imageCount++;
        } else if (contentType.startsWith('video/')) {
          videoCount++;
        }
      }
    }

    return {
      totalFiles: keys.length,
      totalSize,
      imageCount,
      videoCount,
    };
  } catch (error) {
    console.error('Failed to get cache storage stats:', error);
    return { totalFiles: 0, totalSize: 0, imageCount: 0, videoCount: 0 };
  }
}

// ====================================
// Unified Log Functions
// ====================================

const UNIFIED_LOG_DB = 'aitu-unified-logs';
const UNIFIED_LOG_STORE = 'logs';

/**
 * Open unified log database
 */
async function openUnifiedLogDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(UNIFIED_LOG_DB, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(UNIFIED_LOG_STORE)) {
        const store = db.createObjectStore(UNIFIED_LOG_STORE, {
          keyPath: 'id',
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('level', 'level', { unique: false });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        store.createIndex('category_timestamp', ['category', 'timestamp'], {
          unique: false,
        });
      }
    };
  });
}

/**
 * Query sync logs from IndexedDB (unified log database)
 * @param {Object} query - Query parameters
 * @returns {Promise<Array>} - Log entries
 */
export async function querySyncLogs(query = {}) {
  try {
    const db = await openUnifiedLogDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(UNIFIED_LOG_STORE, 'readonly');
      const store = tx.objectStore(UNIFIED_LOG_STORE);
      const index = store.index('timestamp');

      const results = [];
      const request = index.openCursor(null, 'prev'); // Descending by timestamp

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          db.close();
          resolve(results);
          return;
        }

        const entry = cursor.value;

        // Only include 'sync' category logs
        if (entry.category !== 'sync') {
          cursor.continue();
          return;
        }

        // Apply filters
        if (query.level && entry.level !== query.level) {
          cursor.continue();
          return;
        }

        if (query.sessionId && entry.sessionId !== query.sessionId) {
          cursor.continue();
          return;
        }

        if (query.search) {
          const searchLower = query.search.toLowerCase();
          const matchesMessage = entry.message
            ?.toLowerCase()
            .includes(searchLower);
          const matchesData =
            entry.data &&
            JSON.stringify(entry.data).toLowerCase().includes(searchLower);
          if (!matchesMessage && !matchesData) {
            cursor.continue();
            return;
          }
        }

        results.push(entry);

        // Apply limit
        if (query.limit && results.length >= query.limit) {
          db.close();
          resolve(results);
          return;
        }

        cursor.continue();
      };

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to query sync logs:', error);
    return [];
  }
}

/**
 * Get sync log statistics
 * @returns {Promise<Object>} - Log statistics
 */
export async function getSyncLogStats() {
  try {
    const db = await openUnifiedLogDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(UNIFIED_LOG_STORE, 'readonly');
      const store = tx.objectStore(UNIFIED_LOG_STORE);

      const stats = {
        total: 0,
        byLevel: { info: 0, success: 0, warning: 0, error: 0, debug: 0 },
        sessions: new Set(),
      };

      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          db.close();
          stats.sessionCount = stats.sessions.size;
          delete stats.sessions;
          resolve(stats);
          return;
        }

        const entry = cursor.value;

        // Only count 'sync' category logs
        if (entry.category !== 'sync') {
          cursor.continue();
          return;
        }

        stats.total++;

        if (stats.byLevel[entry.level] !== undefined) {
          stats.byLevel[entry.level]++;
        }

        if (entry.sessionId) {
          stats.sessions.add(entry.sessionId);
        }

        cursor.continue();
      };

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to get sync log stats:', error);
    return { total: 0, byLevel: {}, byCategory: {}, sessionCount: 0 };
  }
}

/**
 * Get all sync sessions
 * @returns {Promise<Array>} - Session list
 */
export async function getSyncSessions() {
  try {
    const db = await openUnifiedLogDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(UNIFIED_LOG_STORE, 'readonly');
      const store = tx.objectStore(UNIFIED_LOG_STORE);

      const sessionsMap = new Map();
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          db.close();
          const sessions = Array.from(sessionsMap.values()).sort(
            (a, b) => b.startTime - a.startTime
          );
          resolve(sessions);
          return;
        }

        const entry = cursor.value;

        // Only include 'sync' category logs
        if (entry.category !== 'sync') {
          cursor.continue();
          return;
        }

        if (entry.sessionId) {
          const existing = sessionsMap.get(entry.sessionId);
          if (existing) {
            existing.logCount++;
            existing.startTime = Math.min(existing.startTime, entry.timestamp);
            existing.endTime = Math.max(existing.endTime, entry.timestamp);
            if (entry.level === 'error') existing.hasErrors = true;
          } else {
            sessionsMap.set(entry.sessionId, {
              sessionId: entry.sessionId,
              startTime: entry.timestamp,
              endTime: entry.timestamp,
              logCount: 1,
              hasErrors: entry.level === 'error',
            });
          }
        }

        cursor.continue();
      };

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to get sync sessions:', error);
    return [];
  }
}

/**
 * Clear sync logs
 * @param {Object} options - Clear options
 * @returns {Promise<number>} - Number of deleted entries
 */
export async function clearSyncLogs(options = {}) {
  try {
    const db = await openUnifiedLogDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(UNIFIED_LOG_STORE, 'readwrite');
      const store = tx.objectStore(UNIFIED_LOG_STORE);

      let deletedCount = 0;
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          db.close();
          resolve(deletedCount);
          return;
        }

        const entry = cursor.value;

        // Only delete 'sync' category logs
        if (entry.category !== 'sync') {
          cursor.continue();
          return;
        }

        let shouldDelete = false;

        // Clear all sync logs if no options
        if (!options.olderThan && !options.sessionId) {
          shouldDelete = true;
        } else {
          if (options.olderThan && entry.timestamp < options.olderThan) {
            shouldDelete = true;
          }

          if (options.sessionId && entry.sessionId === options.sessionId) {
            shouldDelete = true;
          }
        }

        if (shouldDelete) {
          cursor.delete();
          deletedCount++;
        }

        cursor.continue();
      };

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to clear sync logs:', error);
    return 0;
  }
}

/**
 * Export sync logs as JSON
 * @param {Object} query - Query parameters
 * @returns {Promise<string>} - JSON string
 */
export async function exportSyncLogs(query = {}) {
  const logs = await querySyncLogs({ ...query, limit: 10000 });
  return JSON.stringify(logs, null, 2);
}

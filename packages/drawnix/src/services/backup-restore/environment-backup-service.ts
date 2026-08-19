import localforage from 'localforage';
import { LS_KEYS, LS_KEYS_TO_MIGRATE } from '../../constants/storage-keys';
import {
  DRAWNIX_SETTINGS_KEY,
  SENSITIVE_STORAGE_KEYS,
} from '../../constants/storage';
import { APP_DB_NAME, APP_DB_STORES } from '../app-database';
import { kvStorageService } from '../kv-storage-service';
import { settingsManager, type AppSettings } from '../../utils/settings-manager';
import { tokenService } from '../github-sync/token-service';
import { syncPasswordService } from '../github-sync/sync-password-service';
import { audioPlaylistService } from '../audio-playlist-service';
import { characterStorageService } from '../character-storage-service';
import { characterAvatarCacheService } from '../character-avatar-cache-service';
import { checksumJson } from './backup-checksum';
import {
  clearStore,
  deleteStoreRecord,
  readStoreRecords,
  StoreRecord,
  writeStoreRecords,
} from './idb-store-backup';
import type { BackupDomainStats, ImportMode } from './types';

type KeyValueRecord = { key: string; value: unknown };
type LocalForageRecord<T = unknown> = { key: string; value: T };

export interface EnvironmentBackupData {
  version: 1;
  exportedAt: number;
  settings?: Partial<AppSettings>;
  localStorage: Record<string, string>;
  kv: KeyValueRecord[];
  appDb: {
    config: StoreRecord[];
    workflows: StoreRecord[];
  };
  localForage: {
    chatSessions: LocalForageRecord[];
    chatMessages: LocalForageRecord[];
    audioPlaylists: LocalForageRecord[];
    audioPlaylistItems: LocalForageRecord[];
    characters: unknown[];
    characterAvatars: LocalForageRecord[];
  };
}

export interface EnvironmentSecretsData {
  version: 1;
  exportedAt: number;
  settings?: SettingsSecrets;
  githubToken?: string | null;
  syncPassword?: string | null;
  appConfigRecords?: StoreRecord[];
}

interface SettingsSecrets {
  geminiApiKey?: string;
  providerProfiles?: Array<{
    id: string;
    apiKey?: string;
    extraHeaders?: Record<string, string>;
  }>;
}

export interface EnvironmentExportResult {
  data: EnvironmentBackupData;
  secrets?: EnvironmentSecretsData;
  stats: BackupDomainStats;
}

export interface EnvironmentImportResult {
  imported: number;
  skipped: number;
  warnings: string[];
}

const CHAT_DB_NAME = 'aitu-chat';
const AUDIO_PLAYLIST_DB_NAME = 'aitu-audio-playlists';
const CHARACTER_DB_NAME = 'drawnix';
const CHARACTER_STORAGE_KEY = 'sora-characters';
const CHARACTER_AVATAR_PREFIX = 'avatar-';

const localStorageExactKeys = new Set<string>([
  ...Object.values(LS_KEYS),
  'ai_model_selection_cache',
  'project-drawer-width',
  'project-drawer-active-tab',
  'ppt-frame-layout-columns',
  'aitu:ppt-editor-view-mode',
  'aitu-pinned-tools',
  'aitu-tool-pin-preferences',
  'toolbar-left',
  'kb-sidebar-width',
  'kb-right-sidebar-width',
  'media-library-grid-size',
  'workflow:model',
  'freehand-settings',
  'pen-settings',
]);

const localStorageDeniedKeys = new Set<string>([
  DRAWNIX_SETTINGS_KEY,
  ...SENSITIVE_STORAGE_KEYS,
  LS_KEYS.AI_IMAGE_PREVIEW_CACHE,
  LS_KEYS.AI_VIDEO_PREVIEW_CACHE,
  LS_KEYS.OLD_LOCAL_DATA,
  LS_KEYS.OLD_IMAGE_HISTORY,
  LS_KEYS.OLD_VIDEO_HISTORY,
  LS_KEYS.DB_CLEANUP_DONE,
  LS_KEYS.CACHE_MIGRATED,
  LS_KEYS.ASSET_MIGRATION_V3,
  LS_KEYS.LS_TO_IDB_MIGRATION_DONE,
  'github_sync_token',
  'github_token_validated',
  'aitu_safe_mode',
  'aitu_crash_count',
  'aitu_crash_history',
  'aitu_last_crash_snapshot',
]);

const localStorageAllowedPrefixes = [
  'drawer-pin:',
  'resizable-divider:',
  'music-analyzer:',
  'aitu:',
  'workflow:',
];

const promptKvKeys = new Set<string>([
  LS_KEYS_TO_MIGRATE.PROMPT_HISTORY,
  LS_KEYS_TO_MIGRATE.VIDEO_PROMPT_HISTORY,
  LS_KEYS_TO_MIGRATE.IMAGE_PROMPT_HISTORY,
  LS_KEYS_TO_MIGRATE.PRESET_SETTINGS,
  LS_KEYS_TO_MIGRATE.PROMPT_DELETED_CONTENTS,
  LS_KEYS_TO_MIGRATE.PROMPT_HISTORY_OVERRIDES,
]);

const kvExactKeys = new Set<string>([
  LS_KEYS_TO_MIGRATE.RECENT_TEXT_COLORS,
  LS_KEYS_TO_MIGRATE.CUSTOM_GRADIENTS,
  LS_KEYS_TO_MIGRATE.CUSTOM_FONTS,
  LS_KEYS_TO_MIGRATE.TOOLBAR_CONFIG,
  'external-skill-packages',
  'github_sync_config',
  'github_sync_local_deletions_pending',
  'github_sync_shard_enabled',
  'github_sync_master_index',
  'github_sync_master_gist_id',
  'github_media_sync_status',
  'aitu:model-benchmark:sessions',
]);

const kvDeniedKeys = new Set<string>([
  ...promptKvKeys,
  LS_KEYS_TO_MIGRATE.BATCH_IMAGE_CACHE,
  'github_sync_password',
]);

const kvAllowedPrefixes = [
  'external-skill-data:',
  'github_sync_',
  'shard_',
  'workflow:',
  'aitu:workflow:',
];

export async function exportEnvironmentData(
  includeSecrets: boolean
): Promise<EnvironmentExportResult> {
  await Promise.all([
    settingsManager.waitForInitialization(),
    audioPlaylistService.initialize().catch(() => undefined),
    characterStorageService.init().catch(() => undefined),
  ]);

  const settings = settingsManager.getSettings();
  const data: EnvironmentBackupData = {
    version: 1,
    exportedAt: Date.now(),
    settings: sanitizeSettings(settings),
    localStorage: collectLocalStorage(),
    kv: await collectKV(),
    appDb: {
      config: await collectSafeAppConfig(),
      workflows: await readStoreRecords(APP_DB_NAME, APP_DB_STORES.WORKFLOWS),
    },
    localForage: {
      chatSessions: await readLocalForageRecords(CHAT_DB_NAME, 'sessions'),
      chatMessages: await readLocalForageRecords(CHAT_DB_NAME, 'messages'),
      audioPlaylists: await readLocalForageRecords(AUDIO_PLAYLIST_DB_NAME, 'audio_playlists'),
      audioPlaylistItems: await readLocalForageRecords(AUDIO_PLAYLIST_DB_NAME, 'audio_playlist_items'),
      characters: characterStorageService.getCharacters(),
      characterAvatars: await readAvatarRecords(),
    },
  };

  const secrets = includeSecrets
    ? await collectEnvironmentSecrets(settings)
    : undefined;
  const stats = {
    count: countEnvironmentItems(data) + (secrets ? countSecrets(secrets) : 0),
    checksum: await checksumJson(data),
  };

  return { data, secrets, stats };
}

export async function importEnvironmentData(
  data: EnvironmentBackupData | null,
  options: {
    mode: ImportMode;
    secrets?: EnvironmentSecretsData | null;
  }
): Promise<EnvironmentImportResult> {
  const warnings: string[] = [];
  if (!isEnvironmentBackupData(data)) {
    return { imported: 0, skipped: 1, warnings: ['环境数据缺失或格式无效，已跳过'] };
  }

  if (options.mode === 'replace') {
    await clearEnvironmentData(Boolean(options.secrets));
  }

  let imported = 0;
  imported += await restoreSettings(data.settings, options);
  imported += restoreLocalStorage(data.localStorage);
  imported += await restoreKV(data.kv);
  imported += await restoreAppDb(data.appDb, options.secrets);
  imported += await restoreEnvironmentSecrets(options.secrets, warnings);
  imported += await restoreChat(data.localForage);
  imported += await restoreAudio(data.localForage);
  imported += await restoreCharacters(data.localForage);

  if (!options.secrets) {
    warnings.push('敏感配置未恢复：备份未包含敏感配置或未输入密码');
  }

  return { imported, skipped: 0, warnings };
}

async function collectEnvironmentSecrets(
  settings: AppSettings
): Promise<EnvironmentSecretsData> {
  const [githubToken, syncPassword, appConfigRecords] = await Promise.all([
    tokenService.getToken().catch(() => null),
    syncPasswordService.getPassword().catch(() => null),
    collectSecretAppConfig(),
  ]);

  return {
    version: 1,
    exportedAt: Date.now(),
    settings: extractSettingsSecrets(settings),
    githubToken,
    syncPassword,
    appConfigRecords,
  };
}

function collectLocalStorage(): Record<string, string> {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  const result: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !isAllowedLocalStorageKey(key)) {
      continue;
    }
    const value = localStorage.getItem(key);
    if (value !== null) {
      result[key] = value;
    }
  }
  return result;
}

async function collectKV(): Promise<KeyValueRecord[]> {
  const keys = await kvStorageService.keys();
  const allowedKeys = keys.filter(isAllowedKVKey);
  const values = await kvStorageService.getMany(allowedKeys);
  return allowedKeys
    .map(key => ({ key, value: values.get(key) }))
    .filter(item => item.value !== null);
}

async function collectSafeAppConfig(): Promise<StoreRecord[]> {
  const records = await readStoreRecords<Record<string, unknown>>(
    APP_DB_NAME,
    APP_DB_STORES.CONFIG
  );
  return records.filter(record => record.value?.key === 'systemPrompt');
}

async function collectSecretAppConfig(): Promise<StoreRecord[]> {
  const records = await readStoreRecords<Record<string, unknown>>(
    APP_DB_NAME,
    APP_DB_STORES.CONFIG
  );
  return records.filter(record => record.value?.key !== 'systemPrompt');
}

async function readLocalForageRecords<T = unknown>(
  name: string,
  storeName: string
): Promise<LocalForageRecord<T>[]> {
  const store = localforage.createInstance({ name, storeName });
  const records: LocalForageRecord<T>[] = [];
  await store.iterate<T, void>((value, key) => {
    records.push({ key, value });
  });
  return records;
}

async function writeLocalForageRecords<T = unknown>(
  name: string,
  storeName: string,
  records: LocalForageRecord<T>[]
): Promise<number> {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }
  const store = localforage.createInstance({ name, storeName });
  for (const record of records) {
    if (record?.key) {
      await store.setItem(record.key, record.value);
    }
  }
  return records.length;
}

async function clearLocalForageStore(name: string, storeName: string): Promise<void> {
  const store = localforage.createInstance({ name, storeName });
  await store.clear();
}

async function readAvatarRecords(): Promise<LocalForageRecord[]> {
  const rawRecords = await readLocalForageRecords<any>(
    CHARACTER_DB_NAME,
    'character-avatars'
  );
  const records: LocalForageRecord[] = [];
  for (const record of rawRecords) {
    if (!record.key.startsWith(CHARACTER_AVATAR_PREFIX)) {
      continue;
    }
    const value = record.value;
    if (value?.blob instanceof Blob) {
      records.push({
        key: record.key,
        value: {
          ...value,
          blob: undefined,
          blobDataUrl: await blobToDataUrl(value.blob),
        },
      });
    } else {
      records.push(record);
    }
  }
  return records;
}

async function restoreAvatarRecords(records: LocalForageRecord[]): Promise<number> {
  const store = localforage.createInstance({
    name: CHARACTER_DB_NAME,
    storeName: 'character-avatars',
  });
  let imported = 0;
  for (const record of records || []) {
    if (!record?.key?.startsWith(CHARACTER_AVATAR_PREFIX)) {
      continue;
    }
    const value = record.value as any;
    if (typeof value?.blobDataUrl === 'string') {
      await store.setItem(record.key, {
        ...value,
        blobDataUrl: undefined,
        blob: dataUrlToBlob(value.blobDataUrl),
      });
      imported++;
    } else if (value?.blob instanceof Blob) {
      await store.setItem(record.key, value);
      imported++;
    }
  }
  return imported;
}

async function clearEnvironmentData(includeSecretConfig: boolean): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && isAllowedLocalStorageKey(key)) {
        localStorage.removeItem(key);
      }
    }
  }

  const kvKeys = await kvStorageService.keys();
  await Promise.all(
    kvKeys.filter(isAllowedKVKey).map(key => kvStorageService.remove(key))
  );

  await clearStore(APP_DB_NAME, APP_DB_STORES.WORKFLOWS);
  if (includeSecretConfig) {
    await clearStore(APP_DB_NAME, APP_DB_STORES.CONFIG);
  } else {
    await deleteStoreRecord(APP_DB_NAME, APP_DB_STORES.CONFIG, 'systemPrompt');
  }

  await Promise.all([
    clearLocalForageStore(CHAT_DB_NAME, 'sessions'),
    clearLocalForageStore(CHAT_DB_NAME, 'messages'),
    clearLocalForageStore(AUDIO_PLAYLIST_DB_NAME, 'audio_playlists'),
    clearLocalForageStore(AUDIO_PLAYLIST_DB_NAME, 'audio_playlist_items'),
    characterStorageService.clearAll(),
    characterAvatarCacheService.clearAll(),
  ]);
}

async function restoreSettings(
  settings: Partial<AppSettings> | undefined,
  options: { mode: ImportMode; secrets?: EnvironmentSecretsData | null }
): Promise<number> {
  if (!settings || typeof settings !== 'object') {
    return 0;
  }

  await settingsManager.waitForInitialization();
  const nextSettings = JSON.parse(JSON.stringify(settings)) as Partial<AppSettings>;
  if (options.secrets?.settings) {
    applySettingsSecrets(nextSettings, options.secrets.settings);
  } else if (options.mode === 'merge') {
    applySettingsSecrets(
      nextSettings,
      extractSettingsSecrets(settingsManager.getSettings())
    );
  }

  await settingsManager.updateSettings(nextSettings);
  return 1;
}

function restoreLocalStorage(entries: Record<string, string>): number {
  if (typeof localStorage === 'undefined' || !entries || typeof entries !== 'object') {
    return 0;
  }

  let imported = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (!isAllowedLocalStorageKey(key) || typeof value !== 'string') {
      continue;
    }
    localStorage.setItem(key, value);
    imported++;
  }
  return imported;
}

async function restoreKV(records: KeyValueRecord[]): Promise<number> {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }
  const items = records
    .filter(record => record?.key && isAllowedKVKey(record.key))
    .map(record => ({ key: record.key, value: record.value }));
  await kvStorageService.setMany(items);
  return items.length;
}

async function restoreAppDb(
  appDb: EnvironmentBackupData['appDb'],
  secrets?: EnvironmentSecretsData | null
): Promise<number> {
  let imported = 0;
  if (Array.isArray(appDb?.config)) {
    imported += await writeStoreRecords(APP_DB_NAME, APP_DB_STORES.CONFIG, appDb.config);
  }
  if (Array.isArray(secrets?.appConfigRecords)) {
    imported += await writeStoreRecords(
      APP_DB_NAME,
      APP_DB_STORES.CONFIG,
      secrets.appConfigRecords
    );
  }
  if (Array.isArray(appDb?.workflows)) {
    imported += await writeStoreRecords(
      APP_DB_NAME,
      APP_DB_STORES.WORKFLOWS,
      appDb.workflows
    );
  }
  return imported;
}

async function restoreEnvironmentSecrets(
  secrets: EnvironmentSecretsData | null | undefined,
  warnings: string[]
): Promise<number> {
  if (!secrets) {
    return 0;
  }

  let imported = 0;
  if (secrets.githubToken) {
    try {
      await tokenService.saveToken(secrets.githubToken);
      imported++;
    } catch (error) {
      warnings.push(
        `GitHub Token 未恢复：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (typeof secrets.syncPassword === 'string') {
    await syncPasswordService.savePassword(secrets.syncPassword);
    imported++;
  }
  return imported;
}

async function restoreChat(
  stores: EnvironmentBackupData['localForage']
): Promise<number> {
  return (
    await writeLocalForageRecords(CHAT_DB_NAME, 'sessions', stores.chatSessions || [])
  ) + (
    await writeLocalForageRecords(CHAT_DB_NAME, 'messages', stores.chatMessages || [])
  );
}

async function restoreAudio(
  stores: EnvironmentBackupData['localForage']
): Promise<number> {
  const imported = (
    await writeLocalForageRecords(
      AUDIO_PLAYLIST_DB_NAME,
      'audio_playlists',
      stores.audioPlaylists || []
    )
  ) + (
    await writeLocalForageRecords(
      AUDIO_PLAYLIST_DB_NAME,
      'audio_playlist_items',
      stores.audioPlaylistItems || []
    )
  );
  await audioPlaylistService.initialize().catch(() => undefined);
  return imported;
}

async function restoreCharacters(
  stores: EnvironmentBackupData['localForage']
): Promise<number> {
  let imported = 0;
  if (Array.isArray(stores.characters)) {
    for (const character of stores.characters as any[]) {
      if (character?.id) {
        await characterStorageService.saveCharacter(character);
        imported++;
      }
    }
  }
  imported += await restoreAvatarRecords(stores.characterAvatars || []);
  return imported;
}

function sanitizeSettings(settings: AppSettings): Partial<AppSettings> {
  const copy = JSON.parse(JSON.stringify(settings)) as AppSettings;
  if (copy.gemini) {
    copy.gemini.apiKey = '';
  }
  if (Array.isArray(copy.providerProfiles)) {
    copy.providerProfiles = copy.providerProfiles.map(profile => ({
      ...profile,
      apiKey: '',
      extraHeaders: undefined,
    }));
  }
  return copy;
}

function extractSettingsSecrets(settings: AppSettings): SettingsSecrets {
  return {
    geminiApiKey: settings.gemini?.apiKey || '',
    providerProfiles: (settings.providerProfiles || []).map(profile => ({
      id: profile.id,
      apiKey: profile.apiKey || '',
      extraHeaders: profile.extraHeaders,
    })),
  };
}

function applySettingsSecrets(
  settings: Partial<AppSettings>,
  secrets: SettingsSecrets
): void {
  if (settings.gemini && typeof secrets.geminiApiKey === 'string') {
    settings.gemini.apiKey = secrets.geminiApiKey;
  }

  if (!Array.isArray(settings.providerProfiles)) {
    return;
  }
  const secretById = new Map(
    (secrets.providerProfiles || []).map(profile => [profile.id, profile])
  );
  settings.providerProfiles = settings.providerProfiles.map(profile => {
    const secret = secretById.get(profile.id);
    return secret
      ? {
          ...profile,
          apiKey: secret.apiKey || '',
          extraHeaders: secret.extraHeaders,
        }
      : profile;
  });
}

function isAllowedLocalStorageKey(key: string): boolean {
  if (localStorageDeniedKeys.has(key)) {
    return false;
  }
  return (
    localStorageExactKeys.has(key) ||
    localStorageAllowedPrefixes.some(prefix => key.startsWith(prefix))
  );
}

function isAllowedKVKey(key: string): boolean {
  if (kvDeniedKeys.has(key)) {
    return false;
  }
  return (
    kvExactKeys.has(key) ||
    kvAllowedPrefixes.some(prefix => key.startsWith(prefix))
  );
}

function isEnvironmentBackupData(data: unknown): data is EnvironmentBackupData {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as EnvironmentBackupData).version === 1 &&
    typeof (data as EnvironmentBackupData).localStorage === 'object' &&
    Array.isArray((data as EnvironmentBackupData).kv)
  );
}

function countEnvironmentItems(data: EnvironmentBackupData): number {
  return (
    Object.keys(data.localStorage || {}).length +
    (data.kv?.length || 0) +
    (data.appDb?.config?.length || 0) +
    (data.appDb?.workflows?.length || 0) +
    (data.localForage?.chatSessions?.length || 0) +
    (data.localForage?.chatMessages?.length || 0) +
    (data.localForage?.audioPlaylists?.length || 0) +
    (data.localForage?.audioPlaylistItems?.length || 0) +
    (data.localForage?.characters?.length || 0) +
    (data.localForage?.characterAvatars?.length || 0) +
    (data.settings ? 1 : 0)
  );
}

function countSecrets(secrets: EnvironmentSecretsData): number {
  return (
    (secrets.githubToken ? 1 : 0) +
    (secrets.syncPassword ? 1 : 0) +
    (secrets.settings ? 1 : 0) +
    (secrets.appConfigRecords?.length || 0)
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = /data:([^;]+);base64/.exec(header || '')?.[1] || 'application/octet-stream';
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

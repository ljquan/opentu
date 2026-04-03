/**
 * 通用的全局设置管理器
 * 统一管理应用程序的所有配置设置
 * 支持敏感信息加密存储
 */

import { CryptoUtils } from './crypto-utils';
import { DRAWNIX_SETTINGS_KEY } from '../constants/storage';
import { configIndexedDBWriter } from './config-indexeddb-writer';
import type { GeminiConfig } from './gemini-api/types';
import type { VideoAPIConfig } from './config-indexeddb-writer';
import {
  getDefaultAudioModel,
  getDefaultImageModel,
  getDefaultTextModel,
  getDefaultVideoModel,
  type ModelConfig,
  type ModelType,
} from '../constants/model-config';

// ====================================
// 类型定义
// ====================================

export interface GeminiSettings {
  apiKey: string;
  baseUrl: string;
  chatModel?: string;
  audioModelName?: string;
  imageModelName?: string;
  videoModelName?: string;
  textModelName?: string;
}

export type ProviderType = 'openai-compatible' | 'gemini-compatible' | 'custom';
export type ProviderAuthType = 'bearer' | 'header' | 'query' | 'custom';

export interface ProviderCapabilities {
  supportsModelsEndpoint: boolean;
  supportsText: boolean;
  supportsImage: boolean;
  supportsVideo: boolean;
  supportsAudio: boolean;
  supportsTools: boolean;
}

export interface ProviderProfile {
  id: string;
  name: string;
  iconUrl?: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  authType: ProviderAuthType;
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  capabilities: ProviderCapabilities;
}

export interface ProviderCatalog {
  profileId: string;
  discoveredAt: number | null;
  discoveredModels: ModelConfig[];
  selectedModelIds: string[];
  sourceBaseUrl?: string;
  signature?: string;
  error?: string | null;
}

export interface ModelRef {
  profileId: string | null;
  modelId: string | null;
}

export interface RouteConfig {
  defaultModelRef: ModelRef | null;
}

export interface InvocationPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  text: RouteConfig;
  image: RouteConfig;
  video: RouteConfig;
  audio: RouteConfig;
}

export interface AppSettings {
  gemini: GeminiSettings;
  providerProfiles: ProviderProfile[];
  providerCatalogs: ProviderCatalog[];
  invocationPresets: InvocationPreset[];
  activePresetId: string;
}

export interface ResolvedInvocationRoute {
  routeType: ModelType;
  modelId: string;
  profileId: string | null;
  profileName: string | null;
  providerType: ProviderType | null;
  baseUrl: string;
  apiKey: string;
  source: 'preset' | 'legacy';
}

export const LEGACY_DEFAULT_PROVIDER_PROFILE_ID = 'legacy-default';
export const DEFAULT_INVOCATION_PRESET_ID = 'default';
export const TUZI_ORIGINAL_PROVIDER_PROFILE_ID = 'tuzi-origin';
export const TUZI_PROVIDER_ICON_URL = '/logo-tuzi.png';
export const TUZI_PROVIDER_DEFAULT_BASE_URL = 'https://api.tu-zi.com/v1';
export const TUZI_DEFAULT_PROVIDER_NAME = '兔子 AI';
export const TUZI_ORIGINAL_PROVIDER_NAME = '兔子 原价';

const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  supportsModelsEndpoint: true,
  supportsText: true,
  supportsImage: true,
  supportsVideo: true,
  supportsAudio: true,
  supportsTools: true,
};

// 默认设置
const DEFAULT_SETTINGS: AppSettings = {
  gemini: {
    apiKey: '',
    baseUrl: TUZI_PROVIDER_DEFAULT_BASE_URL,
    chatModel: 'gpt-5',
    audioModelName: 'suno_music',
    imageModelName: 'gemini-3-pro-image-preview-vip',
    videoModelName: 'veo3.1',
    textModelName: 'deepseek-v3.2',
  },
  providerProfiles: [],
  providerCatalogs: [],
  invocationPresets: [],
  activePresetId: DEFAULT_INVOCATION_PRESET_ID,
};

// 设置变更监听器类型
type SettingsListener<T = any> = (newValue: T, oldValue: T) => void;
type AnySettingsListener = SettingsListener<any>;

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function createModelRef(
  profileId?: string | null,
  modelId?: string | null
): ModelRef | null {
  const normalizedProfileId = normalizeNullableString(profileId);
  const normalizedModelId = normalizeNullableString(modelId);

  if (!normalizedProfileId && !normalizedModelId) {
    return null;
  }

  return {
    profileId: normalizedProfileId,
    modelId: normalizedModelId,
  };
}

export function createRouteConfig(modelRef?: ModelRef | null): RouteConfig {
  return {
    defaultModelRef: modelRef
      ? createModelRef(modelRef.profileId, modelRef.modelId)
      : null,
  };
}

export function getRouteModelRef(route?: RouteConfig | null): ModelRef | null {
  if (!route) {
    return null;
  }

  const modelRef = route.defaultModelRef;
  return modelRef ? createModelRef(modelRef.profileId, modelRef.modelId) : null;
}

export function getRouteProfileId(route?: RouteConfig | null): string | null {
  return getRouteModelRef(route)?.profileId || null;
}

export function getRouteModelId(route?: RouteConfig | null): string | null {
  return getRouteModelRef(route)?.modelId || null;
}

function areModelRefsEqual(
  left?: ModelRef | null,
  right?: ModelRef | null
): boolean {
  return (
    (left?.profileId || null) === (right?.profileId || null) &&
    (left?.modelId || null) === (right?.modelId || null)
  );
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name || 'Error';
  }
  return 'Unknown error';
}

// 需要加密存储的敏感字段列表
const SENSITIVE_FIELDS = new Set([
  'gemini.apiKey',
  // 可以在这里添加其他敏感字段
]);

const SENSITIVE_FIELD_PATTERNS = [/^providerProfiles\.\d+\.apiKey$/];

// ====================================
// 设置管理器类
// ====================================

/**
 * 全局设置管理器单例
 * 提供类型安全的设置管理，支持监听器模式
 */
class SettingsManager {
  private static instance: SettingsManager;
  private settings: AppSettings;
  private listeners: Map<string, Set<AnySettingsListener>> = new Map();
  private cryptoAvailable = false;
  private initializationPromise: Promise<void> | null = null;

  private constructor() {
    this.settings = this.loadSettings();
    this.initializationPromise = this.initializeAsync();
  }

  private cloneValue<T>(value: T): T {
    if (value && typeof value === 'object') {
      return JSON.parse(JSON.stringify(value)) as T;
    }
    return value;
  }

  private createDefaultSettings(): AppSettings {
    return this.cloneValue(DEFAULT_SETTINGS);
  }

  /**
   * 异步初始化
   */
  private async initializeAsync(): Promise<void> {
    try {
      await this.initializeCrypto();
      // 加密功能初始化完成后，解密已加载的敏感数据
      await this.decryptSensitiveDataForLoading(this.settings);
      this.initializeFromUrl();
      // 初始化完成后，同步配置到 IndexedDB，供 SW 读取
      await this.syncToIndexedDB();
      // console.log('SettingsManager initialization completed');
    } catch (error) {
      console.error('SettingsManager initialization failed:', error);
    }
  }

  /**
   * 等待初始化完成
   */
  public async waitForInitialization(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * 初始化加密功能
   */
  private async initializeCrypto(): Promise<void> {
    try {
      this.cryptoAvailable = await CryptoUtils.testCrypto();
      if (!this.cryptoAvailable) {
        console.warn(
          'Crypto functionality is not available, sensitive data will be stored as plain text'
        );
      }
    } catch (error) {
      console.error('Failed to initialize crypto:', error);
      this.cryptoAvailable = false;
    }
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  /**
   * 检查字段是否为敏感字段
   */
  private isSensitiveField(path: string): boolean {
    return (
      SENSITIVE_FIELDS.has(path) ||
      SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(path))
    );
  }

  private getSensitiveFieldPaths(settings: AppSettings): string[] {
    const fieldPaths = [...SENSITIVE_FIELDS];
    settings.providerProfiles.forEach((_, index) => {
      fieldPaths.push(`providerProfiles.${index}.apiKey`);
    });
    return fieldPaths;
  }

  private inferProviderType(baseUrl: string): ProviderType {
    const normalizedBaseUrl = baseUrl.trim().toLowerCase();
    if (
      normalizedBaseUrl.includes('generativelanguage.googleapis.com') ||
      normalizedBaseUrl.includes('vertex.googleapis.com')
    ) {
      return 'gemini-compatible';
    }
    if (
      normalizedBaseUrl.includes('/openai') ||
      normalizedBaseUrl.endsWith('/v1') ||
      normalizedBaseUrl.includes('api.openai.com') ||
      normalizedBaseUrl.includes('api.tu-zi.com')
    ) {
      return 'openai-compatible';
    }
    return 'custom';
  }

  private inferProviderAuthType(
    baseUrl: string,
    providerType?: ProviderType | null
  ): ProviderAuthType {
    return 'bearer';
  }

  private normalizeProviderType(
    baseUrl: string,
    providerType?: ProviderType | string | null
  ): ProviderType {
    if (
      providerType === 'openai-compatible' ||
      providerType === 'gemini-compatible' ||
      providerType === 'custom'
    ) {
      return providerType;
    }

    return this.inferProviderType(baseUrl);
  }

  private normalizeProviderAuthType(
    baseUrl: string,
    providerType: ProviderType,
    authType?: ProviderAuthType | string | null
  ): ProviderAuthType {
    if (
      authType === 'header' ||
      authType === 'query' ||
      authType === 'custom' ||
      authType === 'bearer'
    ) {
      return authType;
    }

    return this.inferProviderAuthType(baseUrl, providerType);
  }

  private normalizeCapabilities(value: unknown): ProviderCapabilities {
    const capabilities =
      value && typeof value === 'object'
        ? (value as Partial<ProviderCapabilities>)
        : {};
    return {
      ...DEFAULT_PROVIDER_CAPABILITIES,
      ...capabilities,
    };
  }

  private normalizeStringRecord(
    value: unknown
  ): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const result = Object.entries(value as Record<string, unknown>).reduce<
      Record<string, string>
    >((acc, [key, entry]) => {
      if (typeof entry === 'string' && key.trim()) {
        acc[key] = entry;
      }
      return acc;
    }, {});

    return Object.keys(result).length > 0 ? result : undefined;
  }

  private buildLegacyDefaultProfile(
    gemini: GeminiSettings,
    profile?: Partial<ProviderProfile>
  ): ProviderProfile {
    const baseUrl = gemini.baseUrl || DEFAULT_SETTINGS.gemini.baseUrl;
    const providerType = this.normalizeProviderType(
      baseUrl,
      profile?.providerType
    );
    return {
      id: LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
      name: TUZI_DEFAULT_PROVIDER_NAME,
      iconUrl: TUZI_PROVIDER_ICON_URL,
      providerType,
      baseUrl,
      apiKey: gemini.apiKey || '',
      authType: this.normalizeProviderAuthType(
        baseUrl,
        providerType,
        profile?.authType
      ),
      enabled: true,
      capabilities: { ...DEFAULT_PROVIDER_CAPABILITIES },
    };
  }

  private buildTuziOriginalProfile(
    profile?: Partial<ProviderProfile>
  ): ProviderProfile {
    const baseUrl =
      typeof profile?.baseUrl === 'string' && profile.baseUrl.trim()
        ? profile.baseUrl
        : TUZI_PROVIDER_DEFAULT_BASE_URL;
    const providerType = this.normalizeProviderType(
      baseUrl,
      profile?.providerType
    );

    return {
      id: TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
      name: TUZI_ORIGINAL_PROVIDER_NAME,
      iconUrl: TUZI_PROVIDER_ICON_URL,
      providerType,
      baseUrl,
      apiKey: typeof profile?.apiKey === 'string' ? profile.apiKey : '',
      authType: this.normalizeProviderAuthType(
        baseUrl,
        providerType,
        profile?.authType
      ),
      extraHeaders: this.normalizeStringRecord(profile?.extraHeaders),
      enabled: profile?.enabled !== false,
      capabilities: this.normalizeCapabilities(profile?.capabilities),
    };
  }

  private buildLegacyDefaultPreset(gemini: GeminiSettings): InvocationPreset {
    const profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID;
    return {
      id: DEFAULT_INVOCATION_PRESET_ID,
      name: '默认方案',
      isDefault: true,
      text: createRouteConfig(
        createModelRef(
          profileId,
          gemini.textModelName?.trim() || gemini.chatModel?.trim() || null
        )
      ),
      audio: createRouteConfig(
        createModelRef(profileId, gemini.audioModelName?.trim() || null)
      ),
      image: createRouteConfig(
        createModelRef(profileId, gemini.imageModelName?.trim() || null)
      ),
      video: createRouteConfig(
        createModelRef(profileId, gemini.videoModelName?.trim() || null)
      ),
    };
  }

  private normalizeProviderProfiles(profiles: unknown): ProviderProfile[] {
    if (!Array.isArray(profiles)) {
      return [];
    }

    const usedIds = new Set<string>();

    return profiles
      .filter(
        (profile): profile is Partial<ProviderProfile> =>
          !!profile && typeof profile === 'object'
      )
      .map((profile, index) => {
        const rawId =
          typeof profile.id === 'string' && profile.id.trim()
            ? profile.id.trim()
            : `provider-${index + 1}`;
        let id = rawId;
        let suffix = 1;
        while (usedIds.has(id)) {
          id = `${rawId}-${suffix}`;
          suffix += 1;
        }
        usedIds.add(id);

        const baseUrl =
          typeof profile.baseUrl === 'string' ? profile.baseUrl : '';
        const providerType = this.normalizeProviderType(
          baseUrl,
          profile.providerType
        );

        return {
          id,
          name:
            typeof profile.name === 'string' && profile.name.trim()
              ? profile.name.trim()
              : `供应商 ${index + 1}`,
          iconUrl: normalizeNullableString(profile.iconUrl) || undefined,
          providerType,
          baseUrl,
          apiKey: typeof profile.apiKey === 'string' ? profile.apiKey : '',
          authType: this.normalizeProviderAuthType(
            baseUrl,
            providerType,
            profile.authType
          ),
          extraHeaders: this.normalizeStringRecord(profile.extraHeaders),
          enabled: profile.enabled !== false,
          capabilities: this.normalizeCapabilities(profile.capabilities),
        };
      });
  }

  private normalizeProviderCatalogs(catalogs: unknown): ProviderCatalog[] {
    if (!Array.isArray(catalogs)) {
      return [];
    }

    const result = new Map<string, ProviderCatalog>();

    catalogs.forEach((catalog) => {
      if (!catalog || typeof catalog !== 'object') {
        return;
      }

      const draft = catalog as Partial<ProviderCatalog>;
      if (typeof draft.profileId !== 'string' || !draft.profileId.trim()) {
        return;
      }

      result.set(draft.profileId.trim(), {
        profileId: draft.profileId.trim(),
        discoveredAt:
          typeof draft.discoveredAt === 'number' ? draft.discoveredAt : null,
        discoveredModels: Array.isArray(draft.discoveredModels)
          ? draft.discoveredModels.filter(
              (item): item is ModelConfig => !!item && typeof item === 'object'
            )
          : [],
        selectedModelIds: Array.isArray(draft.selectedModelIds)
          ? draft.selectedModelIds.filter(
              (id): id is string => typeof id === 'string'
            )
          : [],
        sourceBaseUrl:
          typeof draft.sourceBaseUrl === 'string'
            ? draft.sourceBaseUrl
            : undefined,
        signature:
          typeof draft.signature === 'string' ? draft.signature : undefined,
        error: typeof draft.error === 'string' ? draft.error : null,
      });
    });

    return [...result.values()];
  }

  private normalizeModelRef(value: unknown): ModelRef | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const draft = value as Partial<ModelRef>;
    return createModelRef(
      typeof draft.profileId === 'string' ? draft.profileId : null,
      typeof draft.modelId === 'string' ? draft.modelId : null
    );
  }

  private normalizeRouteConfig(route: unknown): RouteConfig {
    const draft =
      route && typeof route === 'object'
        ? (route as Partial<RouteConfig> & {
            profileId?: unknown;
            defaultModelId?: unknown;
          })
        : {};

    const nextModelRef =
      this.normalizeModelRef(draft.defaultModelRef) ||
      createModelRef(
        typeof draft.profileId === 'string' ? draft.profileId : null,
        typeof draft.defaultModelId === 'string' ? draft.defaultModelId : null
      );

    return createRouteConfig(nextModelRef);
  }

  private normalizeInvocationPresets(presets: unknown): InvocationPreset[] {
    if (!Array.isArray(presets)) {
      return [];
    }

    const usedIds = new Set<string>();

    return presets
      .filter(
        (preset): preset is Partial<InvocationPreset> =>
          !!preset && typeof preset === 'object'
      )
      .map((preset, index) => {
        const rawId =
          typeof preset.id === 'string' && preset.id.trim()
            ? preset.id.trim()
            : `preset-${index + 1}`;
        let id = rawId;
        let suffix = 1;
        while (usedIds.has(id)) {
          id = `${rawId}-${suffix}`;
          suffix += 1;
        }
        usedIds.add(id);

        return {
          id,
          name:
            typeof preset.name === 'string' && preset.name.trim()
              ? preset.name.trim()
              : `方案 ${index + 1}`,
          isDefault: preset.isDefault === true,
          text: this.normalizeRouteConfig(preset.text),
          audio: this.normalizeRouteConfig(preset.audio),
          image: this.normalizeRouteConfig(preset.image),
          video: this.normalizeRouteConfig(preset.video),
        };
      });
  }

  private normalizeSettings(settings: Partial<AppSettings>): AppSettings {
    const mergedSettings = this.deepMerge(
      this.createDefaultSettings(),
      settings || {}
    ) as AppSettings;

    const normalizedSettings: AppSettings = {
      ...mergedSettings,
      gemini: {
        ...DEFAULT_SETTINGS.gemini,
        ...(mergedSettings.gemini || {}),
      },
      providerProfiles: this.normalizeProviderProfiles(
        mergedSettings.providerProfiles
      ),
      providerCatalogs: this.normalizeProviderCatalogs(
        mergedSettings.providerCatalogs
      ),
      invocationPresets: this.normalizeInvocationPresets(
        mergedSettings.invocationPresets
      ),
      activePresetId:
        typeof mergedSettings.activePresetId === 'string' &&
        mergedSettings.activePresetId.trim()
          ? mergedSettings.activePresetId.trim()
          : DEFAULT_INVOCATION_PRESET_ID,
    };

    return this.ensureLegacyCompatibility(normalizedSettings);
  }

  private ensureLegacyCompatibility(settings: AppSettings): AppSettings {
    const existingLegacyProfile = settings.providerProfiles.find(
      (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
    );
    const existingTuziOriginProfile = settings.providerProfiles.find(
      (profile) => profile.id === TUZI_ORIGINAL_PROVIDER_PROFILE_ID
    );

    const legacyProfile = {
      ...this.buildLegacyDefaultProfile(settings.gemini, existingLegacyProfile),
      extraHeaders: this.normalizeStringRecord(
        existingLegacyProfile?.extraHeaders
      ),
      capabilities: this.normalizeCapabilities(
        existingLegacyProfile?.capabilities
      ),
    };
    const tuziOriginProfile = this.buildTuziOriginalProfile(
      existingTuziOriginProfile
    );
    const legacyPreset = this.buildLegacyDefaultPreset(settings.gemini);

    const providerProfiles = [
      legacyProfile,
      tuziOriginProfile,
      ...settings.providerProfiles.filter(
        (profile) =>
          profile.id !== LEGACY_DEFAULT_PROVIDER_PROFILE_ID &&
          profile.id !== TUZI_ORIGINAL_PROVIDER_PROFILE_ID
      ),
    ];

    const validProfileIds = new Set(
      providerProfiles.map((profile) => profile.id)
    );

    const providerCatalogs = settings.providerCatalogs
      .filter((catalog) => validProfileIds.has(catalog.profileId))
      .map((catalog) => ({
        ...catalog,
        selectedModelIds: catalog.selectedModelIds.filter(
          (id) => typeof id === 'string'
        ),
      }));

    if (
      !providerCatalogs.some(
        (catalog) => catalog.profileId === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      )
    ) {
      providerCatalogs.unshift({
        profileId: LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
        discoveredAt: null,
        discoveredModels: [],
        selectedModelIds: [],
        sourceBaseUrl: legacyProfile.baseUrl,
        error: null,
      });
    }

    if (
      !providerCatalogs.some(
        (catalog) => catalog.profileId === TUZI_ORIGINAL_PROVIDER_PROFILE_ID
      )
    ) {
      providerCatalogs.push({
        profileId: TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
        discoveredAt: null,
        discoveredModels: [],
        selectedModelIds: [],
        sourceBaseUrl: tuziOriginProfile.baseUrl,
        error: null,
      });
    }

    const invocationPresets = [...settings.invocationPresets];
    const legacyPresetIndex = invocationPresets.findIndex(
      (preset) => preset.id === DEFAULT_INVOCATION_PRESET_ID
    );
    if (legacyPresetIndex >= 0) {
      const existingPreset = invocationPresets[legacyPresetIndex];
      const resolveLegacyRoute = (
        existingRoute: RouteConfig,
        legacyRoute: RouteConfig
      ): RouteConfig => {
        const existingProfileId = getRouteProfileId(existingRoute);
        return existingProfileId &&
          existingProfileId !== LEGACY_DEFAULT_PROVIDER_PROFILE_ID &&
          validProfileIds.has(existingProfileId)
          ? existingRoute
          : legacyRoute;
      };
      invocationPresets[legacyPresetIndex] = {
        ...existingPreset,
        ...legacyPreset,
        name: existingPreset.name || legacyPreset.name,
        isDefault: true,
        text: resolveLegacyRoute(existingPreset.text, legacyPreset.text),
        audio: resolveLegacyRoute(existingPreset.audio, legacyPreset.audio),
        image: resolveLegacyRoute(existingPreset.image, legacyPreset.image),
        video: resolveLegacyRoute(existingPreset.video, legacyPreset.video),
      };
    } else {
      invocationPresets.unshift(legacyPreset);
    }

    const normalizedPresets = invocationPresets.map((preset) => ({
      ...preset,
      text: validProfileIds.has(getRouteProfileId(preset.text) || '')
        ? preset.text
        : createRouteConfig(createModelRef(null, getRouteModelId(preset.text))),
      audio: validProfileIds.has(getRouteProfileId(preset.audio) || '')
        ? preset.audio
        : createRouteConfig(
            createModelRef(null, getRouteModelId(preset.audio))
          ),
      image: validProfileIds.has(getRouteProfileId(preset.image) || '')
        ? preset.image
        : createRouteConfig(
            createModelRef(null, getRouteModelId(preset.image))
          ),
      video: validProfileIds.has(getRouteProfileId(preset.video) || '')
        ? preset.video
        : createRouteConfig(
            createModelRef(null, getRouteModelId(preset.video))
          ),
    }));

    const presetIds = new Set(normalizedPresets.map((preset) => preset.id));
    const activePresetId = presetIds.has(settings.activePresetId)
      ? settings.activePresetId
      : DEFAULT_INVOCATION_PRESET_ID;

    return {
      ...settings,
      providerProfiles,
      providerCatalogs,
      invocationPresets: normalizedPresets,
      activePresetId,
    };
  }

  /**
   * 加密敏感数据
   */
  private async encryptSensitiveData(
    path: string,
    value: string
  ): Promise<string> {
    if (!this.isSensitiveField(path) || !this.cryptoAvailable) {
      return value;
    }

    try {
      return await CryptoUtils.encrypt(value);
    } catch (error) {
      console.warn(`Failed to encrypt sensitive data for ${path}:`, error);
      return value; // 加密失败时返回原值
    }
  }

  /**
   * 解密敏感数据
   */
  private async decryptSensitiveData(
    path: string,
    value: string
  ): Promise<string> {
    if (!this.isSensitiveField(path) || !this.cryptoAvailable) {
      return value;
    }

    try {
      // 检查数据是否已加密
      if (CryptoUtils.isEncrypted(value)) {
        return await CryptoUtils.decrypt(value);
      }
      return value; // 如果不是加密数据，返回原值
    } catch (error) {
      console.warn(`Failed to decrypt sensitive data for ${path}:`, error);
      return value; // 解密失败时返回原值
    }
  }

  /**
   * 从本地存储加载设置
   */
  private loadSettings(): AppSettings {
    if (typeof window === 'undefined') {
      return this.normalizeSettings(this.createDefaultSettings());
    }

    let settings = this.createDefaultSettings();

    try {
      const storedSettings = localStorage.getItem(DRAWNIX_SETTINGS_KEY);
      if (storedSettings) {
        const parsedSettings = JSON.parse(storedSettings);
        settings = this.normalizeSettings(
          this.deepMerge(settings, parsedSettings)
        );
      }
    } catch (error) {
      console.warn('Failed to load settings from localStorage:', error);
    }

    return this.normalizeSettings(settings);
  }

  /**
   * 为加载的设置解密敏感数据
   */
  private async decryptSensitiveDataForLoading(
    settings: AppSettings
  ): Promise<void> {
    for (const fieldPath of this.getSensitiveFieldPaths(settings)) {
      const value = this.getSetting.call({ settings }, fieldPath);
      if (value && typeof value === 'string') {
        try {
          const decryptedValue = await this.decryptSensitiveData(
            fieldPath,
            value
          );
          if (decryptedValue !== value) {
            // 只有当解密成功时才更新设置
            this.setNestedValue(settings, fieldPath, decryptedValue);
            // console.log(`Decrypted sensitive field: ${fieldPath}`);
          }
        } catch (error) {
          console.warn(
            `Failed to decrypt field ${fieldPath} during loading:`,
            error
          );
        }
      }
    }
  }

  /**
   * 设置嵌套对象的值
   */
  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let current = obj;

    for (const key of keys) {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    current[lastKey] = value;
  }

  /**
   * 从URL参数初始化设置
   */
  private initializeFromUrl(): void {
    if (typeof window === 'undefined') return;

    try {
      const urlParams = new URLSearchParams(window.location.search);

      // 处理settings参数
      const settingsParam = urlParams.get('settings');
      if (settingsParam) {
        const decoded = decodeURIComponent(settingsParam);
        const urlSettings = JSON.parse(decoded);

        // updateSetting 已有占位符检查，会自动忽略无效值
        if (urlSettings.key) {
          this.updateSetting('gemini.apiKey', urlSettings.key);
        }
        if (urlSettings.url) {
          this.updateSetting('gemini.baseUrl', urlSettings.url);
        }
      }

      // 处理apiKey参数
      // updateSetting 已有占位符检查，会自动忽略无效值
      const apiKey = urlParams.get('apiKey');
      if (apiKey) {
        this.updateSetting('gemini.apiKey', apiKey);
      }

      // 清除URL参数
      if (settingsParam || apiKey) {
        const url = new URL(window.location.href);
        url.searchParams.delete('settings');
        url.searchParams.delete('apiKey');
        window.history.replaceState({}, document.title, url.toString());
      }
    } catch (error) {
      console.warn('Failed to initialize settings from URL:', error);
    }
  }

  /**
   * 保存设置到本地存储
   */
  private async saveToStorage(): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      // 创建设置副本用于存储
      const settingsToSave = JSON.parse(JSON.stringify(this.settings));

      // 加密敏感数据
      await this.encryptSensitiveDataForStorage(settingsToSave);

      // 使用单个 key 存储序列化的设置
      const settingsJson = JSON.stringify(settingsToSave);
      localStorage.setItem(DRAWNIX_SETTINGS_KEY, settingsJson);

      // 同步到 IndexedDB，供 SW 读取（必须等待完成，确保首次输入 API Key 后 SW 能立即拿到配置）
      await this.syncToIndexedDB();
    } catch (error) {
      console.warn('Failed to save settings to localStorage:', error);
    }
  }

  /**
   * 同步配置到 IndexedDB
   * 将当前设置转换为 SW 需要的配置格式并写入 IndexedDB
   */
  private async syncToIndexedDB(): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const imageRoute = this.resolveInvocationRoute('image');
      const videoRoute = this.resolveInvocationRoute('video');

      // 构建 GeminiConfig（与 SW 期望的格式一致）
      const geminiConfig: GeminiConfig = {
        apiKey: imageRoute.apiKey,
        baseUrl: imageRoute.baseUrl,
        modelName: imageRoute.modelId,
      };

      // 构建 VideoAPIConfig（与 SW 期望的格式一致）
      const videoConfig: VideoAPIConfig = {
        apiKey: videoRoute.apiKey,
        baseUrl: videoRoute.baseUrl,
        model: videoRoute.modelId,
      };

      await configIndexedDBWriter.saveConfig(geminiConfig, videoConfig);
    } catch (error) {
      // IndexedDB 写入失败不影响正常流程
      console.warn(
        '[SettingsManager] Failed to sync config to IndexedDB:',
        error
      );
    }
  }

  /**
   * 为存储加密敏感数据
   */
  private async encryptSensitiveDataForStorage(
    settings: AppSettings
  ): Promise<void> {
    for (const fieldPath of this.getSensitiveFieldPaths(settings)) {
      const value = this.getSetting.call({ settings }, fieldPath);
      if (value && typeof value === 'string') {
        try {
          const encryptedValue = await this.encryptSensitiveData(
            fieldPath,
            value
          );
          if (encryptedValue !== value) {
            // 只有当加密成功时才更新存储副本
            this.setNestedValue(settings, fieldPath, encryptedValue);
            // console.log(`Encrypted sensitive field for storage: ${fieldPath}`);
          }
        } catch (error) {
          console.warn(
            `Failed to encrypt field ${fieldPath} for storage:`,
            error
          );
        }
      }
    }
  }

  /**
   * 获取完整设置
   */
  public getSettings(): AppSettings {
    return this.cloneValue(this.settings);
  }

  /**
   * 获取特定设置值（支持点记号法）
   * 返回深拷贝，防止外部修改影响原始设置
   */
  public getSetting<T = any>(path: string): T {
    const keys = path.split('.');
    let value: any = this.settings;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined as T;
      }
    }

    // 返回深拷贝，防止外部代码修改返回值影响原始设置
    // 这是防止脱敏函数或其他代码意外修改 apiKey 等敏感字段的关键
    if (value && typeof value === 'object') {
      return this.cloneValue(value) as T;
    }

    return value as T;
  }

  /**
   * 检查字符串是否是占位符格式
   * 如 {key}、${key}、{{key}}、{apiKey} 等
   */
  private isPlaceholderValue(value: unknown): boolean {
    if (!value || typeof value !== 'string') return false;
    // 匹配 {xxx}、${xxx}、{{xxx}} 等占位符格式
    return (
      /^[{$]*\{?\w+\}?\}*$/.test(value) ||
      value.includes('{key}') ||
      value.includes('${')
    );
  }

  /**
   * 更新特定设置值（支持点记号法）
   */
  public async updateSetting<T = any>(
    path: string,
    newValue: T
  ): Promise<void> {
    // 对 apiKey 相关字段进行占位符检查
    if (
      (path.endsWith('.apiKey') || path === 'apiKey') &&
      this.isPlaceholderValue(newValue)
    ) {
      console.warn(
        `[SettingsManager] Detected placeholder value for ${path}, ignoring:`,
        newValue
      );
      return;
    }

    const oldSettings = this.cloneValue(this.settings);
    const keys = path.split('.');
    const lastKey = keys.pop()!;

    let target: any = this.settings;
    for (const key of keys) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }

    target[lastKey] = newValue;

    this.settings = this.normalizeSettings(this.settings);
    await this.saveToStorage();
    this.notifySettingsChange(oldSettings, this.settings, '');
  }

  /**
   * 批量更新设置
   */
  public async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    const oldSettings = this.cloneValue(this.settings);
    this.settings = this.normalizeSettings(
      this.deepMerge(this.settings, updates)
    );
    await this.saveToStorage();
    this.notifySettingsChange(oldSettings, this.settings, '');
  }

  /**
   * 深度合并对象
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key])
      ) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * 递归通知设置变更
   */
  private notifySettingsChange(oldObj: any, newObj: any, path: string): void {
    for (const key in newObj) {
      const currentPath = path ? `${path}.${key}` : key;
      const oldValue = oldObj?.[key];
      const newValue = newObj[key];

      if (oldValue !== newValue) {
        this.notifyListeners(currentPath, newValue, oldValue);
        if (
          typeof newValue === 'object' &&
          !Array.isArray(newValue) &&
          newValue !== null
        ) {
          this.notifySettingsChange(oldValue || {}, newValue, currentPath);
        }
      }
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(path: string, newValue: any, oldValue: any): void {
    const listeners = this.listeners.get(path);
    if (listeners) {
      const safeNewValue = this.cloneValue(newValue);
      const safeOldValue = this.cloneValue(oldValue);
      listeners.forEach((listener) => {
        try {
          listener(safeNewValue, safeOldValue);
        } catch (error) {
          // 只记录错误类型，不记录详细信息（可能包含敏感设置值）
          console.error(
            `Error in settings listener for ${path}:`,
            getSafeErrorMessage(error)
          );
        }
      });
    }

    // 触发全局事件，用于画布中的工具 URL 模板刷新
    // 当 gemini 相关设置变化时（如 apiKey、baseUrl）
    if (path.startsWith('gemini') && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('gemini-settings-changed', {
          detail: { path, newValue, oldValue },
        })
      );
    }
  }

  /**
   * 添加设置变更监听器
   */
  public addListener<T = any>(
    path: string,
    listener: SettingsListener<T>
  ): void {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, new Set());
    }
    this.listeners.get(path)!.add(listener as AnySettingsListener);
  }

  /**
   * 移除设置变更监听器
   */
  public removeListener<T = any>(
    path: string,
    listener: SettingsListener<T>
  ): void {
    const listeners = this.listeners.get(path);
    if (listeners) {
      listeners.delete(listener as AnySettingsListener);
      if (listeners.size === 0) {
        this.listeners.delete(path);
      }
    }
  }

  /**
   * 重置设置为默认值
   */
  public async resetSettings(): Promise<void> {
    const oldSettings = this.cloneValue(this.settings);
    this.settings = this.normalizeSettings(this.createDefaultSettings());
    await this.saveToStorage();
    this.notifySettingsChange(oldSettings, this.settings, '');
    // console.log('Settings reset to default');
  }

  /**
   * 重置特定设置为默认值
   */
  public async resetSetting(path: string): Promise<void> {
    const defaultValue = this.getSetting.call(
      { settings: DEFAULT_SETTINGS },
      path
    );
    if (defaultValue !== undefined) {
      await this.updateSetting(path, defaultValue);
    }
  }

  private getActiveInvocationPresetInternal(): InvocationPreset | null {
    const presets = this.settings.invocationPresets;
    if (presets.length === 0) {
      return null;
    }

    const activePresetId =
      this.settings.activePresetId || DEFAULT_INVOCATION_PRESET_ID;

    return (
      presets.find((preset) => preset.id === activePresetId) ||
      presets.find((preset) => preset.isDefault) ||
      presets[0] ||
      null
    );
  }

  private getProviderProfileById(
    profileId?: string | null
  ): ProviderProfile | null {
    if (!profileId) {
      return null;
    }

    return (
      this.settings.providerProfiles.find(
        (profile) => profile.id === profileId
      ) || null
    );
  }

  private getProviderCatalogById(
    profileId?: string | null
  ): ProviderCatalog | null {
    if (!profileId) {
      return null;
    }

    return (
      this.settings.providerCatalogs.find(
        (catalog) => catalog.profileId === profileId
      ) || null
    );
  }

  private getLegacyModelId(routeType: ModelType): string {
    const gemini = this.settings.gemini;

    switch (routeType) {
      case 'image':
        return gemini.imageModelName || getDefaultImageModel();
      case 'video':
        return gemini.videoModelName || getDefaultVideoModel();
      case 'audio':
        return gemini.audioModelName || getDefaultAudioModel();
      case 'text':
        return (
          gemini.textModelName || gemini.chatModel || getDefaultTextModel()
        );
      default:
        return getDefaultTextModel();
    }
  }

  private getSelectedModelsForProfile(
    profileId: string,
    routeType: ModelType
  ): ModelConfig[] {
    const catalog = this.getProviderCatalogById(profileId);
    if (!catalog) {
      return [];
    }

    const selectedIds = new Set(catalog.selectedModelIds);
    return catalog.discoveredModels.filter(
      (model) => model.type === routeType && selectedIds.has(model.id)
    );
  }

  public getActiveInvocationPreset(): InvocationPreset | null {
    const preset = this.getActiveInvocationPresetInternal();
    return preset ? this.cloneValue(preset) : null;
  }

  public async updateActiveInvocationRouteModel(
    routeType: ModelType,
    modelRef?: ModelRef | null
  ): Promise<void> {
    const nextModelRef = createModelRef(
      modelRef?.profileId || null,
      modelRef?.modelId || null
    );
    const activePresetId =
      this.settings.activePresetId || DEFAULT_INVOCATION_PRESET_ID;
    const activePreset = this.getActiveInvocationPresetInternal();
    const currentModelRef = getRouteModelRef(activePreset?.[routeType]);
    const legacySettingKey =
      routeType === 'image'
        ? 'imageModelName'
        : routeType === 'video'
        ? 'videoModelName'
        : routeType === 'audio'
        ? 'audioModelName'
        : 'textModelName';
    const normalizedModelId = nextModelRef?.modelId || null;
    const currentLegacyModelId =
      this.settings.gemini[legacySettingKey] ||
      (routeType === 'text' ? this.settings.gemini.chatModel || '' : '');

    if (
      areModelRefsEqual(currentModelRef, nextModelRef) &&
      currentLegacyModelId === (normalizedModelId || '')
    ) {
      return;
    }

    const invocationPresets = [...this.settings.invocationPresets];
    const presetIndex = invocationPresets.findIndex(
      (preset) => preset.id === activePresetId
    );
    const basePreset =
      presetIndex >= 0
        ? invocationPresets[presetIndex]
        : this.buildLegacyDefaultPreset(this.settings.gemini);
    const nextPreset: InvocationPreset = {
      ...basePreset,
      [routeType]: createRouteConfig(nextModelRef),
    };

    if (presetIndex >= 0) {
      invocationPresets[presetIndex] = nextPreset;
    } else {
      invocationPresets.unshift(nextPreset);
    }

    const nextGeminiSettings: GeminiSettings = {
      ...this.settings.gemini,
      [legacySettingKey]: normalizedModelId || undefined,
    };
    if (routeType === 'text') {
      nextGeminiSettings.chatModel = normalizedModelId || undefined;
    }

    await this.updateSettings({
      gemini: nextGeminiSettings,
      invocationPresets,
      activePresetId,
    });
  }

  public resolveInvocationRoute(
    routeType: ModelType,
    requestedModelId?: string | ModelRef | null
  ): ResolvedInvocationRoute {
    const preset = this.getActiveInvocationPresetInternal();
    const presetRoute = preset?.[routeType];
    const presetModelRef = getRouteModelRef(presetRoute);
    const requestedModelRef =
      typeof requestedModelId === 'string'
        ? createModelRef(null, requestedModelId)
        : createModelRef(
            requestedModelId?.profileId || null,
            requestedModelId?.modelId || null
          );
    const profile = this.getProviderProfileById(
      requestedModelRef?.profileId || presetModelRef?.profileId || null
    );
    const profileModels = profile
      ? this.getSelectedModelsForProfile(profile.id, routeType)
      : [];
    const normalizedRequestedModelId = requestedModelRef?.modelId || null;
    const normalizedPresetModelId = presetModelRef?.modelId || null;
    const normalizedLegacyBaseUrl =
      this.settings.gemini.baseUrl?.trim() || DEFAULT_SETTINGS.gemini.baseUrl;
    const normalizedLegacyApiKey = this.settings.gemini.apiKey?.trim() || '';
    const normalizedProfileBaseUrl = profile?.baseUrl?.trim() || '';
    const normalizedProfileApiKey = profile?.apiKey?.trim() || '';
    const fallbackModelId =
      profileModels[0]?.id || this.getLegacyModelId(routeType);

    return {
      routeType,
      modelId:
        normalizedRequestedModelId ||
        normalizedPresetModelId ||
        fallbackModelId,
      profileId: profile?.id || null,
      profileName: profile?.name || null,
      providerType: profile?.providerType || null,
      baseUrl: normalizedProfileBaseUrl || normalizedLegacyBaseUrl,
      apiKey: normalizedProfileApiKey || normalizedLegacyApiKey,
      source: profile ? 'preset' : 'legacy',
    };
  }

  public hasInvocationRouteCredentials(
    routeType: ModelType,
    requestedModelId?: string | ModelRef | null
  ): boolean {
    const route = this.resolveInvocationRoute(routeType, requestedModelId);
    return Boolean(route.baseUrl && route.apiKey);
  }
}

// ====================================
// 导出
// ====================================

/**
 * 全局设置管理器实例
 */
export const settingsManager = SettingsManager.getInstance();

/**
 * 便捷的 Gemini 设置访问器
 */
export const geminiSettings = {
  get: () => settingsManager.getSetting<GeminiSettings>('gemini'),
  update: async (settings: Partial<GeminiSettings>) => {
    const currentGeminiSettings =
      settingsManager.getSetting<GeminiSettings>('gemini');
    const updatedSettings: GeminiSettings = {
      ...currentGeminiSettings,
      ...settings,
    };
    await settingsManager.updateSettings({ gemini: updatedSettings });
  },
  addListener: (listener: SettingsListener<GeminiSettings>) => {
    settingsManager.addListener('gemini', listener);
  },
  removeListener: (listener: SettingsListener<GeminiSettings>) => {
    settingsManager.removeListener('gemini', listener);
  },
};

export const getActiveInvocationPreset = (): InvocationPreset | null =>
  settingsManager.getActiveInvocationPreset();

export const resolveInvocationRoute = (
  routeType: ModelType,
  requestedModelId?: string | ModelRef | null
): ResolvedInvocationRoute =>
  settingsManager.resolveInvocationRoute(routeType, requestedModelId);

export const hasInvocationRouteCredentials = (
  routeType: ModelType,
  requestedModelId?: string | ModelRef | null
): boolean =>
  settingsManager.hasInvocationRouteCredentials(routeType, requestedModelId);

export const updateActiveInvocationRouteModel = (
  routeType: ModelType,
  modelRef?: ModelRef | null
): Promise<void> =>
  settingsManager.updateActiveInvocationRouteModel(routeType, modelRef);

export const providerProfilesSettings = {
  get: () => settingsManager.getSetting<ProviderProfile[]>('providerProfiles'),
  update: async (profiles: ProviderProfile[]) => {
    await settingsManager.updateSetting('providerProfiles', profiles);
  },
  addListener: (listener: SettingsListener<ProviderProfile[]>) => {
    settingsManager.addListener('providerProfiles', listener);
  },
  removeListener: (listener: SettingsListener<ProviderProfile[]>) => {
    settingsManager.removeListener('providerProfiles', listener);
  },
};

export const providerCatalogsSettings = {
  get: () => settingsManager.getSetting<ProviderCatalog[]>('providerCatalogs'),
  update: async (catalogs: ProviderCatalog[]) => {
    await settingsManager.updateSetting('providerCatalogs', catalogs);
  },
  addListener: (listener: SettingsListener<ProviderCatalog[]>) => {
    settingsManager.addListener('providerCatalogs', listener);
  },
  removeListener: (listener: SettingsListener<ProviderCatalog[]>) => {
    settingsManager.removeListener('providerCatalogs', listener);
  },
};

export const invocationPresetsSettings = {
  get: () =>
    settingsManager.getSetting<InvocationPreset[]>('invocationPresets'),
  update: async (presets: InvocationPreset[]) => {
    await settingsManager.updateSetting('invocationPresets', presets);
  },
  getActivePresetId: () => settingsManager.getSetting<string>('activePresetId'),
  setActivePresetId: async (presetId: string) => {
    await settingsManager.updateSetting('activePresetId', presetId);
  },
  addListener: (listener: SettingsListener<InvocationPreset[]>) => {
    settingsManager.addListener('invocationPresets', listener);
  },
  removeListener: (listener: SettingsListener<InvocationPreset[]>) => {
    settingsManager.removeListener('invocationPresets', listener);
  },
};

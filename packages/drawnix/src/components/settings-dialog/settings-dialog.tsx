import { useDrawnix } from '../../hooks/use-drawnix';
import { useDeviceType } from '../../hooks/useDeviceType';
import './settings-dialog.scss';
import {
  useDeferredValue,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { MessagePlugin, Tooltip, Switch } from 'tdesign-react';
import { InfoCircleIcon } from 'tdesign-icons-react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { LS_KEYS } from '../../constants/storage-keys';
import { ModelDiscoveryDialog } from './model-discovery-dialog';
import {
  getDefaultImageModel,
  getDefaultTextModel,
  getDefaultVideoModel,
  ModelVendor,
  type ModelConfig,
  type ModelType,
} from '../../constants/model-config';
import {
  useProfilePreferredModels,
  useRuntimeModelDiscoveryState,
} from '../../hooks/use-runtime-models';
import {
  normalizeModelApiBaseUrl,
  runtimeModelDiscovery,
} from '../../utils/runtime-model-discovery';
import {
  createModelRef,
  createRouteConfig,
  DEFAULT_INVOCATION_PRESET_ID,
  geminiSettings,
  getRouteModelId,
  getRouteProfileId,
  invocationPresetsSettings,
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  providerCatalogsSettings,
  providerProfilesSettings,
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
  TUZI_PROVIDER_DEFAULT_BASE_URL,
  type InvocationPreset,
  type ModelRef,
  type ProviderProfile,
  type RouteConfig,
} from '../../utils/settings-manager';
import {
  DISCOVERY_VENDOR_ORDER,
  getDiscoveryVendorLabel,
  getModelVendorPalette,
  ModelVendorMark,
} from '../shared/ModelVendorBrand';
import { WinBoxWindow } from '../winbox';

export { IMAGE_MODEL_GROUPED_SELECT_OPTIONS as IMAGE_MODEL_GROUPED_OPTIONS } from '../../constants/model-config';
export { VIDEO_MODEL_SELECT_OPTIONS as VIDEO_MODEL_OPTIONS } from '../../constants/model-config';

type SettingsView = 'providers' | 'presets' | 'canvas';
type CompactPanelMode = 'catalog' | 'detail';

const VIEW_SECTIONS: Array<{ value: SettingsView; label: string }> = [
  { value: 'providers', label: '供应商' },
  { value: 'presets', label: '模型预设' },
  { value: 'canvas', label: '画布显示' },
];

const PROVIDER_TYPE_OPTIONS: ProviderProfile['providerType'][] = [
  'openai-compatible',
  'gemini-compatible',
  'custom',
];

const AUTH_TYPE_OPTIONS: ProviderProfile['authType'][] = [
  'bearer',
  'header',
  'query',
  'custom',
];

const ROUTE_LABELS: Record<ModelType, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
};

const MODEL_GROUP_LABELS: Record<ModelType, string> = {
  image: '图片模型',
  video: '视频模型',
  text: '文本模型',
};

const MODEL_SUMMARY_GROUP_ORDER: ModelType[] = ['text', 'image', 'video'];

const PROVIDER_TYPE_META: Record<
  ProviderProfile['providerType'],
  { label: string }
> = {
  'openai-compatible': {
    label: 'OpenAI 兼容',
  },
  'gemini-compatible': {
    label: 'Gemini 兼容',
  },
  custom: {
    label: '自定义接入',
  },
};

const AUTH_TYPE_META: Record<ProviderProfile['authType'], { label: string }> = {
  bearer: {
    label: 'Bearer Token',
  },
  header: {
    label: '自定义 Header',
  },
  query: {
    label: 'Query 参数',
  },
  custom: {
    label: '手动拼装',
  },
};

const PROVIDER_AVATAR_THEMES = [
  'amber',
  'sky',
  'mint',
  'rose',
  'violet',
] as const;

type ProviderAvatarTheme = (typeof PROVIDER_AVATAR_THEMES)[number];

function getModelTypeCounts(models: ModelConfig[]): Record<ModelType, number> {
  return models.reduce(
    (counts, model) => {
      counts[model.type] += 1;
      return counts;
    },
    { image: 0, video: 0, text: 0 }
  );
}

function matchesProviderModelQuery(model: ModelConfig, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    model.id,
    model.label,
    model.shortLabel,
    model.shortCode,
    model.description,
    model.sourceProfileName,
    getDiscoveryVendorLabel(model.vendor),
  ]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(normalized));
}

function getConfiguredRouteCount(preset: InvocationPreset | null): number {
  if (!preset) {
    return 0;
  }

  return (['image', 'video', 'text'] as ModelType[]).filter((routeType) =>
    Boolean(getRouteModelId(preset[routeType]))
  ).length;
}

function getProviderDraftState(
  profile: ProviderProfile,
  initialProfiles: ProviderProfile[]
): 'new' | 'dirty' | 'saved' {
  const initialProfile = initialProfiles.find((item) => item.id === profile.id);
  if (!initialProfile) {
    return 'new';
  }
  return areEqual(initialProfile, profile) ? 'saved' : 'dirty';
}

function createSettingsDraftSignature(params: {
  profiles: ProviderProfile[];
  presets: InvocationPreset[];
  activePresetId: string;
  imageModelName: string;
  videoModelName: string;
  textModelName: string;
  showWorkZoneCard: boolean;
}): string {
  return JSON.stringify(params);
}

function getProviderIconUrl(
  profile: Pick<ProviderProfile, 'iconUrl'>
): string | null {
  if (typeof profile.iconUrl !== 'string') {
    return null;
  }

  const trimmed = profile.iconUrl.trim();
  return trimmed || null;
}

function getProviderAvatarLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return '供';
  }

  const alphaNumericGroups = trimmed.match(/[A-Za-z0-9]+/g);
  if (alphaNumericGroups?.[0]) {
    return alphaNumericGroups[0][0].toUpperCase();
  }

  return Array.from(trimmed)[0]?.toUpperCase() || '供';
}

function getProviderAvatarTheme(
  profile: Pick<ProviderProfile, 'id' | 'name' | 'providerType'>
): ProviderAvatarTheme {
  const seed = Array.from(
    `${profile.id}-${profile.providerType}-${profile.name}`
  ).reduce((total, char, index) => total + char.charCodeAt(0) * (index + 1), 0);

  return PROVIDER_AVATAR_THEMES[seed % PROVIDER_AVATAR_THEMES.length];
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createProfile(index: number): ProviderProfile {
  const providerType: ProviderProfile['providerType'] = 'openai-compatible';
  return {
    id: createId('profile'),
    name: `供应商 ${index}`,
    iconUrl: '',
    providerType,
    baseUrl: '',
    apiKey: '',
    authType: inferAuthTypeForProviderType(providerType),
    enabled: true,
    capabilities: {
      supportsModelsEndpoint: true,
      supportsText: true,
      supportsImage: true,
      supportsVideo: true,
      supportsTools: true,
    },
  };
}

function inferAuthTypeForProviderType(
  providerType: ProviderProfile['providerType']
): ProviderProfile['authType'] {
  return 'bearer';
}

function isManagedProviderProfile(profileId: string): boolean {
  return (
    profileId === LEGACY_DEFAULT_PROVIDER_PROFILE_ID ||
    profileId === TUZI_ORIGINAL_PROVIDER_PROFILE_ID
  );
}

const ProviderAvatar = ({
  profile,
  size = 'regular',
}: {
  profile: Pick<ProviderProfile, 'id' | 'name' | 'providerType' | 'iconUrl'>;
  size?: 'regular' | 'large';
}) => {
  const normalizedIconUrl = getProviderIconUrl(profile);
  const [imageUrl, setImageUrl] = useState<string | null>(normalizedIconUrl);

  useEffect(() => {
    setImageUrl(normalizedIconUrl);
  }, [normalizedIconUrl]);

  const avatarTheme = getProviderAvatarTheme(profile);
  const avatarLabel = getProviderAvatarLabel(profile.name);

  return (
    <span
      className={`settings-dialog__provider-avatar settings-dialog__provider-avatar--${avatarTheme} ${
        size === 'large' ? 'settings-dialog__provider-avatar--large' : ''
      }`}
      aria-hidden="true"
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`${profile.name} 图标`}
          className="settings-dialog__provider-avatar-image"
          loading="lazy"
          onError={() => setImageUrl(null)}
        />
      ) : (
        <span className="settings-dialog__provider-avatar-text">
          {avatarLabel}
        </span>
      )}
    </span>
  );
};

function createPreset(
  profileId: string | null,
  defaults: { image: string; video: string; text: string }
): InvocationPreset {
  return {
    id: createId('preset'),
    name: '新预设',
    text: createRouteConfig(createModelRef(profileId, defaults.text || null)),
    image: createRouteConfig(createModelRef(profileId, defaults.image || null)),
    video: createRouteConfig(createModelRef(profileId, defaults.video || null)),
  };
}

function updatePresetRoute(
  preset: InvocationPreset,
  routeType: ModelType,
  patch: Partial<RouteConfig> & {
    profileId?: string | null;
    defaultModelId?: string | null;
    defaultModelRef?: ModelRef | null;
  }
): InvocationPreset {
  const currentRoute = preset[routeType];
  const nextModelRef =
    patch.defaultModelRef !== undefined
      ? patch.defaultModelRef
      : createModelRef(
          patch.profileId !== undefined
            ? patch.profileId
            : getRouteProfileId(currentRoute),
          patch.defaultModelId !== undefined
            ? patch.defaultModelId
            : getRouteModelId(currentRoute)
        );

  return {
    ...preset,
    [routeType]: createRouteConfig(nextModelRef),
  };
}

function clearPresetProfileRoute(
  preset: InvocationPreset,
  profileId: string
): InvocationPreset {
  const nextPreset = { ...preset };

  (['image', 'video', 'text'] as ModelType[]).forEach((routeType) => {
    if (getRouteProfileId(nextPreset[routeType]) === profileId) {
      nextPreset[routeType] = createRouteConfig(null);
    }
  });

  return nextPreset;
}

function areEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function encodeModelRefValue(profileId: string, modelId: string): string {
  return JSON.stringify({ profileId, modelId });
}

function parseModelRefValue(value: string): ModelRef | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as {
      profileId?: string;
      modelId?: string;
    };
    return createModelRef(parsed.profileId || null, parsed.modelId || null);
  } catch {
    return null;
  }
}

export const SettingsDialog = ({
  container,
}: {
  container: HTMLElement | null;
}) => {
  const { appState, setAppState } = useDrawnix();
  const {
    isMobile: isMobileDevice,
    viewportWidth,
    viewportHeight,
  } = useDeviceType();

  const [activeView, setActiveView] = useState<SettingsView>('providers');
  const [selectedProfileId, setSelectedProfileId] = useState(
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID
  );
  const [selectedPresetId, setSelectedPresetId] = useState(
    DEFAULT_INVOCATION_PRESET_ID
  );
  const [profilesDraft, setProfilesDraft] = useState<ProviderProfile[]>([]);
  const [presetsDraft, setPresetsDraft] = useState<InvocationPreset[]>([]);
  const [activePresetIdDraft, setActivePresetIdDraft] = useState(
    DEFAULT_INVOCATION_PRESET_ID
  );
  const [initialProfiles, setInitialProfiles] = useState<ProviderProfile[]>([]);
  const [imageModelName, setImageModelName] = useState('');
  const [videoModelName, setVideoModelName] = useState('');
  const [textModelName, setTextModelName] = useState('');
  const [showWorkZoneCard, setShowWorkZoneCard] = useState(true);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [discoveryDialogOpen, setDiscoveryDialogOpen] = useState(false);
  const [initialDraftSignature, setInitialDraftSignature] = useState('');
  const [isPersisting, setIsPersisting] = useState(false);
  const [compactProviderMode, setCompactProviderMode] =
    useState<CompactPanelMode>('catalog');
  const [compactPresetMode, setCompactPresetMode] =
    useState<CompactPanelMode>('catalog');

  const selectedProfile =
    profilesDraft.find((profile) => profile.id === selectedProfileId) ||
    profilesDraft[0] ||
    null;
  const selectedPreset =
    presetsDraft.find((preset) => preset.id === selectedPresetId) ||
    presetsDraft[0] ||
    null;

  const runtimeState = useRuntimeModelDiscoveryState(
    selectedProfile?.id || LEGACY_DEFAULT_PROVIDER_PROFILE_ID
  );
  const deferredModelSearchQuery = useDeferredValue(modelSearchQuery);
  const legacyImageModels = useProfilePreferredModels(
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    'image'
  );
  const legacyVideoModels = useProfilePreferredModels(
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    'video'
  );
  const legacyTextModels = useProfilePreferredModels(
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    'text'
  );

  const enabledProfiles = profilesDraft.filter((profile) => profile.enabled);
  const isCompactLayout = isMobileDevice || viewportWidth <= 980;
  const canManageModels = !!selectedProfile && !!selectedProfile.apiKey.trim();
  const currentDraftSignature = createSettingsDraftSignature({
    profiles: profilesDraft,
    presets: presetsDraft,
    activePresetId: activePresetIdDraft,
    imageModelName,
    videoModelName,
    textModelName,
    showWorkZoneCard,
  });
  const hasPendingChanges =
    appState.openSettings && currentDraftSignature !== initialDraftSignature;

  const handleViewChange = (nextView: SettingsView) => {
    setActiveView(nextView);

    if (!isCompactLayout) {
      return;
    }

    if (nextView === 'providers') {
      setCompactProviderMode('catalog');
    }

    if (nextView === 'presets') {
      setCompactPresetMode('catalog');
    }
  };

  const handleSelectProfile = (profileId: string) => {
    setSelectedProfileId(profileId);

    if (isCompactLayout) {
      setCompactProviderMode('detail');
    }
  };

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);

    if (isCompactLayout) {
      setCompactPresetMode('detail');
    }
  };

  const readPersistedWorkZoneCard = () => {
    try {
      return localStorage.getItem(LS_KEYS.WORKZONE_CARD_VISIBLE) !== 'false';
    } catch {
      return true;
    }
  };

  const syncPersistedBaseline = () => {
    const persistedProfiles = cloneValue(providerProfilesSettings.get());
    const persistedPresets = cloneValue(invocationPresetsSettings.get());
    const persistedActivePresetId =
      invocationPresetsSettings.getActivePresetId() ||
      DEFAULT_INVOCATION_PRESET_ID;
    const persistedGemini = geminiSettings.get();
    const persistedShowWorkZoneCard = readPersistedWorkZoneCard();

    setInitialProfiles(persistedProfiles);
    setInitialDraftSignature(
      createSettingsDraftSignature({
        profiles: persistedProfiles,
        presets: persistedPresets,
        activePresetId: persistedActivePresetId,
        imageModelName:
          persistedGemini.imageModelName || getDefaultImageModel(),
        videoModelName:
          persistedGemini.videoModelName || getDefaultVideoModel(),
        textModelName: persistedGemini.textModelName || getDefaultTextModel(),
        showWorkZoneCard: persistedShowWorkZoneCard,
      })
    );
  };

  useEffect(() => {
    if (!appState.openSettings) {
      return;
    }

    const nextProfiles = cloneValue(providerProfilesSettings.get());
    const nextPresets = cloneValue(invocationPresetsSettings.get());
    const nextActivePresetId =
      invocationPresetsSettings.getActivePresetId() ||
      DEFAULT_INVOCATION_PRESET_ID;
    const geminiConfig = geminiSettings.get();
    let nextShowWorkZoneCard = true;

    setProfilesDraft(nextProfiles);
    setPresetsDraft(nextPresets);
    setInitialProfiles(nextProfiles);
    setActivePresetIdDraft(nextActivePresetId);
    setSelectedProfileId((currentProfileId) =>
      nextProfiles.some((profile) => profile.id === currentProfileId)
        ? currentProfileId
        : nextProfiles[0]?.id || LEGACY_DEFAULT_PROVIDER_PROFILE_ID
    );
    setSelectedPresetId((currentPresetId) =>
      nextPresets.some((preset) => preset.id === currentPresetId)
        ? currentPresetId
        : nextPresets[0]?.id || DEFAULT_INVOCATION_PRESET_ID
    );
    setImageModelName(geminiConfig.imageModelName || getDefaultImageModel());
    setVideoModelName(geminiConfig.videoModelName || getDefaultVideoModel());
    setTextModelName(geminiConfig.textModelName || getDefaultTextModel());

    try {
      nextShowWorkZoneCard =
        localStorage.getItem(LS_KEYS.WORKZONE_CARD_VISIBLE) !== 'false';
    } catch {
      nextShowWorkZoneCard = true;
    }
    setShowWorkZoneCard(nextShowWorkZoneCard);

    setActiveView('providers');
    setCompactProviderMode('catalog');
    setCompactPresetMode('catalog');
    setModelSearchQuery('');
    setDiscoveryDialogOpen(false);
    setInitialDraftSignature(
      createSettingsDraftSignature({
        profiles: nextProfiles,
        presets: nextPresets,
        activePresetId: nextActivePresetId,
        imageModelName: geminiConfig.imageModelName || getDefaultImageModel(),
        videoModelName: geminiConfig.videoModelName || getDefaultVideoModel(),
        textModelName: geminiConfig.textModelName || getDefaultTextModel(),
        showWorkZoneCard: nextShowWorkZoneCard,
      })
    );
  }, [appState.openSettings]);

  useEffect(() => {
    if (!selectedProfileId && profilesDraft[0]) {
      setSelectedProfileId(profilesDraft[0].id);
      return;
    }

    if (
      selectedProfileId &&
      profilesDraft.length > 0 &&
      !profilesDraft.some((profile) => profile.id === selectedProfileId)
    ) {
      setSelectedProfileId(profilesDraft[0].id);
    }
  }, [profilesDraft, selectedProfileId]);

  useEffect(() => {
    if (!selectedPresetId && presetsDraft[0]) {
      setSelectedPresetId(presetsDraft[0].id);
      return;
    }

    if (
      selectedPresetId &&
      presetsDraft.length > 0 &&
      !presetsDraft.some((preset) => preset.id === selectedPresetId)
    ) {
      setSelectedPresetId(presetsDraft[0].id);
    }
  }, [presetsDraft, selectedPresetId]);

  useEffect(() => {
    setModelSearchQuery('');
  }, [selectedProfileId, activeView]);

  const updateProfile = (
    profileId: string,
    updater: (profile: ProviderProfile) => ProviderProfile
  ) => {
    setProfilesDraft((current) =>
      current.map((profile) =>
        profile.id === profileId ? updater(profile) : profile
      )
    );
  };

  const updatePreset = (
    presetId: string,
    updater: (preset: InvocationPreset) => InvocationPreset
  ) => {
    setPresetsDraft((current) =>
      current.map((preset) =>
        preset.id === presetId ? updater(preset) : preset
      )
    );
  };

  const persistPresetConfiguration = async (
    nextPresets: InvocationPreset[],
    nextActivePresetId: string
  ): Promise<boolean> => {
    try {
      const persistedGemini = geminiSettings.get();
      const effectiveActivePresetId =
        nextPresets.find((preset) => preset.id === nextActivePresetId)?.id ||
        nextPresets[0]?.id ||
        DEFAULT_INVOCATION_PRESET_ID;
      const activePreset =
        nextPresets.find((preset) => preset.id === effectiveActivePresetId) ||
        nextPresets[0] ||
        null;
      const nextImageModelName =
        getRouteModelId(activePreset?.image) ||
        persistedGemini.imageModelName ||
        getDefaultImageModel();
      const nextVideoModelName =
        getRouteModelId(activePreset?.video) ||
        persistedGemini.videoModelName ||
        getDefaultVideoModel();
      const nextTextModelName =
        getRouteModelId(activePreset?.text) ||
        persistedGemini.textModelName ||
        persistedGemini.chatModel ||
        getDefaultTextModel();

      await invocationPresetsSettings.update(cloneValue(nextPresets));
      await invocationPresetsSettings.setActivePresetId(
        effectiveActivePresetId
      );
      await geminiSettings.update({
        imageModelName: nextImageModelName,
        videoModelName: nextVideoModelName,
        textModelName: nextTextModelName,
        chatModel: nextTextModelName,
      });

      setPresetsDraft(nextPresets);
      setActivePresetIdDraft(effectiveActivePresetId);
      setImageModelName(nextImageModelName);
      setVideoModelName(nextVideoModelName);
      setTextModelName(nextTextModelName);
      syncPersistedBaseline();

      return true;
    } catch (error) {
      console.error('Failed to persist preset configuration:', error);
      MessagePlugin.error('预设保存失败，请重试');
      return false;
    }
  };

  const handleProviderEnabledChange = async (
    profileId: string,
    enabled: boolean
  ) => {
    setProfilesDraft((current) =>
      current.map((profile) =>
        profile.id === profileId ? { ...profile, enabled } : profile
      )
    );

    if (!initialProfiles.some((profile) => profile.id === profileId)) {
      return;
    }

    try {
      await providerProfilesSettings.update(
        cloneValue(providerProfilesSettings.get()).map((profile) =>
          profile.id === profileId ? { ...profile, enabled } : profile
        )
      );
      syncPersistedBaseline();
    } catch (error) {
      console.error('Failed to persist provider enabled state:', error);
      setProfilesDraft((current) =>
        current.map((profile) =>
          profile.id === profileId ? { ...profile, enabled: !enabled } : profile
        )
      );
      MessagePlugin.error('供应商状态保存失败，请重试');
    }
  };

  const handleCanvasVisibilityChange = async (checked: boolean) => {
    setShowWorkZoneCard(checked);

    try {
      localStorage.setItem(LS_KEYS.WORKZONE_CARD_VISIBLE, String(checked));
      window.dispatchEvent(new CustomEvent('workzone-visibility-changed'));
      syncPersistedBaseline();
    } catch (error) {
      console.error('Failed to persist canvas visibility state:', error);
      setShowWorkZoneCard(!checked);
      MessagePlugin.error('画布显示配置保存失败，请重试');
    }
  };

  const handleAddProfile = () => {
    const nextProfile = createProfile(profilesDraft.length + 1);
    setProfilesDraft((current) => [...current, nextProfile]);
    setSelectedProfileId(nextProfile.id);
    setActiveView('providers');

    if (isCompactLayout) {
      setCompactProviderMode('detail');
    }
  };

  const handleDeleteProfile = (profileId: string) => {
    if (isManagedProviderProfile(profileId)) {
      return;
    }

    const remainingProfiles = profilesDraft.filter(
      (profile) => profile.id !== profileId
    );
    setProfilesDraft(remainingProfiles);
    setPresetsDraft((current) =>
      current.map((preset) => clearPresetProfileRoute(preset, profileId))
    );
    if (selectedProfileId === profileId) {
      setSelectedProfileId(
        remainingProfiles[0]?.id || LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      );
    }

    if (isCompactLayout) {
      setCompactProviderMode('catalog');
    }
  };

  const handleAddPreset = () => {
    const fallbackProfileId = enabledProfiles[0]?.id || null;
    const nextPreset = createPreset(fallbackProfileId, {
      image: imageModelName || getDefaultImageModel(),
      video: videoModelName || getDefaultVideoModel(),
      text: textModelName || getDefaultTextModel(),
    });
    setPresetsDraft((current) => [...current, nextPreset]);
    setSelectedPresetId(nextPreset.id);
    setActiveView('presets');

    if (isCompactLayout) {
      setCompactPresetMode('detail');
    }
  };

  const handleDeletePreset = (presetId: string) => {
    if (presetsDraft.length <= 1) {
      return;
    }

    const remainingPresets = presetsDraft.filter(
      (preset) => preset.id !== presetId
    );
    setPresetsDraft(remainingPresets);

    if (activePresetIdDraft === presetId) {
      setActivePresetIdDraft(
        remainingPresets[0]?.id || DEFAULT_INVOCATION_PRESET_ID
      );
    }
    if (selectedPresetId === presetId) {
      setSelectedPresetId(
        remainingPresets[0]?.id || DEFAULT_INVOCATION_PRESET_ID
      );
    }

    if (isCompactLayout) {
      setCompactPresetMode('catalog');
    }
  };

  const handleRouteModelChange = (routeType: ModelType, value: string) => {
    if (!selectedPreset) {
      return;
    }

    const nextModelRef = parseModelRefValue(value);
    const nextPresets = presetsDraft.map((preset) =>
      preset.id === selectedPreset.id
        ? updatePresetRoute(preset, routeType, {
            defaultModelRef: nextModelRef,
          })
        : preset
    );

    setPresetsDraft(nextPresets);
    void persistPresetConfiguration(nextPresets, activePresetIdDraft);
  };

  const handleFetchModels = async () => {
    if (!selectedProfile) {
      MessagePlugin.warning('请先选择供应商配置');
      return;
    }

    if (hasPendingChanges) {
      const savingMessage = MessagePlugin.loading('正在保存当前配置...', 0);
      const saved = await persistDrafts(false);
      MessagePlugin.close(savingMessage);
      if (!saved) {
        return;
      }
    }

    const trimmedApiKey = selectedProfile.apiKey.trim();
    const normalizedBaseUrl = normalizeModelApiBaseUrl(
      selectedProfile.baseUrl.trim() || TUZI_PROVIDER_DEFAULT_BASE_URL
    );

    if (!trimmedApiKey) {
      MessagePlugin.warning('请先填写 API Key');
      return;
    }

    try {
      await runtimeModelDiscovery.discover(
        selectedProfile.id,
        normalizedBaseUrl,
        trimmedApiKey
      );
      setDiscoveryDialogOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型同步失败';
      runtimeModelDiscovery.setError(selectedProfile.id, message);
      MessagePlugin.error({
        content: message,
        duration: 3600,
      });
    }
  };

  const handleApplySelectedModels = (selectedModelIds: string[]) => {
    if (!selectedProfile) {
      return;
    }

    const selectedModels = runtimeModelDiscovery.applySelection(
      selectedProfile.id,
      selectedModelIds
    );

    if (selectedProfile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID) {
      const nextImageModels = selectedModels.filter(
        (model) => model.type === 'image'
      );
      const nextVideoModels = selectedModels.filter(
        (model) => model.type === 'video'
      );
      const nextTextModels = selectedModels.filter(
        (model) => model.type === 'text'
      );
      const discoveredImageIds = runtimeState.discoveredModels
        .filter((model) => model.type === 'image')
        .map((model) => model.id);
      const discoveredVideoIds = runtimeState.discoveredModels
        .filter((model) => model.type === 'video')
        .map((model) => model.id);
      const discoveredTextIds = runtimeState.discoveredModels
        .filter((model) => model.type === 'text')
        .map((model) => model.id);

      if (
        !nextImageModels.some((model) => model.id === imageModelName) &&
        discoveredImageIds.includes(imageModelName)
      ) {
        setImageModelName(nextImageModels[0]?.id || getDefaultImageModel());
      }
      if (
        !nextVideoModels.some((model) => model.id === videoModelName) &&
        discoveredVideoIds.includes(videoModelName)
      ) {
        setVideoModelName(nextVideoModels[0]?.id || getDefaultVideoModel());
      }
      if (
        !nextTextModels.some((model) => model.id === textModelName) &&
        discoveredTextIds.includes(textModelName)
      ) {
        setTextModelName(nextTextModels[0]?.id || getDefaultTextModel());
      }
    }

    MessagePlugin.success(
      selectedModels.length > 0
        ? `已为 ${selectedProfile.name} 添加 ${selectedModels.length} 个模型`
        : `已清空 ${selectedProfile.name} 的已添加模型`
    );
    setDiscoveryDialogOpen(false);
  };

  const closeSettingsDialog = () => {
    setAppState((prev) => ({ ...prev, openSettings: false }));
  };

  const persistDrafts = async (closeAfterSave = false): Promise<boolean> => {
    if (isPersisting) {
      return false;
    }

    setIsPersisting(true);
    try {
      const normalizedProfiles = profilesDraft.map((profile) => {
        const normalizedBaseUrl = profile.baseUrl.trim()
          ? normalizeModelApiBaseUrl(profile.baseUrl)
          : '';

        return {
          ...profile,
          name: profile.name.trim() || '未命名供应商',
          iconUrl: profile.iconUrl?.trim() || undefined,
          baseUrl: normalizedBaseUrl,
          apiKey: profile.apiKey.trim(),
        };
      });

      const profileIds = new Set(
        normalizedProfiles.map((profile) => profile.id)
      );
      const normalizedPresets = presetsDraft.map((preset) => {
        const nextPreset: InvocationPreset = {
          ...preset,
          name: preset.name.trim() || '未命名预设',
          image: { ...preset.image },
          video: { ...preset.video },
          text: { ...preset.text },
        };

        (['image', 'video', 'text'] as ModelType[]).forEach((routeType) => {
          const route = nextPreset[routeType];
          const routeProfileId = getRouteProfileId(route);
          const routeModelId = getRouteModelId(route);
          if (routeProfileId && !profileIds.has(routeProfileId)) {
            nextPreset[routeType] = createRouteConfig(
              createModelRef(null, routeModelId)
            );
            return;
          }

          nextPreset[routeType] = createRouteConfig(
            createModelRef(routeProfileId, routeModelId)
          );
        });

        return nextPreset;
      });

      const normalizedActivePresetId =
        normalizedPresets.find((preset) => preset.id === activePresetIdDraft)
          ?.id ||
        normalizedPresets[0]?.id ||
        DEFAULT_INVOCATION_PRESET_ID;
      const activePreset =
        normalizedPresets.find(
          (preset) => preset.id === normalizedActivePresetId
        ) ||
        normalizedPresets[0] ||
        null;

      const legacyProfile =
        normalizedProfiles.find(
          (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
        ) || normalizedProfiles[0];

      const normalizedLegacyBaseUrl = normalizeModelApiBaseUrl(
        legacyProfile?.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL
      );
      const normalizedImageModel =
        imageModelName.trim() ||
        legacyImageModels[0]?.id ||
        getDefaultImageModel();
      const normalizedVideoModel =
        videoModelName.trim() ||
        legacyVideoModels[0]?.id ||
        getDefaultVideoModel();
      const normalizedTextModel =
        textModelName.trim() ||
        legacyTextModels[0]?.id ||
        getDefaultTextModel();
      const normalizedActiveImageModel =
        getRouteModelId(activePreset?.image) || normalizedImageModel;
      const normalizedActiveVideoModel =
        getRouteModelId(activePreset?.video) || normalizedVideoModel;
      const normalizedActiveTextModel =
        getRouteModelId(activePreset?.text) || normalizedTextModel;

      normalizedProfiles.forEach((profile) => {
        runtimeModelDiscovery.invalidateIfConfigChanged(
          profile.id,
          profile.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL,
          profile.apiKey || ''
        );
      });

      await geminiSettings.update({
        apiKey: legacyProfile?.apiKey || '',
        baseUrl: normalizedLegacyBaseUrl,
        imageModelName: normalizedActiveImageModel,
        videoModelName: normalizedActiveVideoModel,
        textModelName: normalizedActiveTextModel,
      });
      await providerProfilesSettings.update(normalizedProfiles);
      await providerCatalogsSettings.update(
        runtimeModelDiscovery
          .getCatalogs()
          .filter((catalog) => profileIds.has(catalog.profileId))
      );
      await invocationPresetsSettings.update(normalizedPresets);
      await invocationPresetsSettings.setActivePresetId(
        normalizedActivePresetId
      );

      try {
        localStorage.setItem(
          LS_KEYS.WORKZONE_CARD_VISIBLE,
          String(showWorkZoneCard)
        );
        window.dispatchEvent(new CustomEvent('workzone-visibility-changed'));
      } catch {
        // localStorage not available
      }

      setProfilesDraft(normalizedProfiles);
      setInitialProfiles(cloneValue(normalizedProfiles));
      setPresetsDraft(normalizedPresets);
      setActivePresetIdDraft(normalizedActivePresetId);
      setImageModelName(normalizedImageModel);
      setVideoModelName(normalizedVideoModel);
      setTextModelName(normalizedTextModel);
      setInitialDraftSignature(
        createSettingsDraftSignature({
          profiles: normalizedProfiles,
          presets: normalizedPresets,
          activePresetId: normalizedActivePresetId,
          imageModelName: normalizedImageModel,
          videoModelName: normalizedVideoModel,
          textModelName: normalizedTextModel,
          showWorkZoneCard,
        })
      );

      if (closeAfterSave) {
        closeSettingsDialog();
      }

      return true;
    } catch (error) {
      console.error('Failed to persist settings drafts:', error);
      MessagePlugin.error('设置保存失败，请稍后重试');
      return false;
    } finally {
      setIsPersisting(false);
    }
  };

  const handleCancel = () => {
    if (!hasPendingChanges) {
      closeSettingsDialog();
      return;
    }

    void (async () => {
      const savingMessage = MessagePlugin.loading('正在保存设置...', 0);
      const saved = await persistDrafts(true);
      MessagePlugin.close(savingMessage);

      if (!saved) {
        MessagePlugin.warning('设置尚未保存，请检查后重试');
      }
    })();
  };

  const handleWindowClose = () => {
    if (discoveryDialogOpen || isPersisting) {
      return;
    }
    handleCancel();
  };

  const renderProviderList = () => (
    <div className="settings-dialog__sidebar-shell settings-dialog__sidebar-shell--catalog">
      <div className="settings-dialog__sidebar-summary">
        <div className="settings-dialog__sidebar-summary-row">
          <span className="settings-dialog__sidebar-summary-title">
            供应商目录
          </span>
          {isCompactLayout ? (
            <button
              type="button"
              className="settings-dialog__sidebar-summary-action"
              onClick={handleAddProfile}
            >
              新增供应商
            </button>
          ) : null}
        </div>
        {isCompactLayout ? (
          <span className="settings-dialog__sidebar-summary-text">
            先从列表里选择供应商，再进入对应的配置页面。
          </span>
        ) : null}
      </div>

      <div className="settings-dialog__sidebar-list">
        {profilesDraft.map((profile) => {
          const isSelected = profile.id === selectedProfile?.id;

          return (
            <div
              key={profile.id}
              className={`settings-dialog__provider-row ${
                isSelected ? 'settings-dialog__provider-row--active' : ''
              } ${
                profile.enabled ? '' : 'settings-dialog__provider-row--disabled'
              }`}
            >
              <button
                type="button"
                className="settings-dialog__provider-select"
                onClick={() => handleSelectProfile(profile.id)}
                aria-pressed={isSelected}
              >
                <span className="settings-dialog__provider-select-main">
                  <ProviderAvatar profile={profile} />
                  <span className="settings-dialog__provider-copy">
                    <span className="settings-dialog__provider-name-row">
                      <span className="settings-dialog__provider-name">
                        {profile.name}
                      </span>
                      {profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID ? (
                        <span className="settings-dialog__provider-tag">
                          默认
                        </span>
                      ) : null}
                    </span>
                    {isCompactLayout ? (
                      <span className="settings-dialog__provider-meta">
                        <span>
                          {PROVIDER_TYPE_META[profile.providerType].label}
                        </span>
                        <span>{profile.enabled ? '启用' : '停用'}</span>
                      </span>
                    ) : null}
                  </span>
                </span>
                {isCompactLayout ? (
                  <ChevronRight
                    size={16}
                    className="settings-dialog__provider-arrow"
                    aria-hidden="true"
                  />
                ) : null}
              </button>

              <div className="settings-dialog__provider-switch">
                <span className="settings-dialog__provider-switch-copy">
                  {profile.enabled ? '启用' : '停用'}
                </span>
                <Switch
                  size="small"
                  value={profile.enabled}
                  disabled={profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID}
                  onChange={(checked) =>
                    void handleProviderEnabledChange(
                      profile.id,
                      checked as boolean
                    )
                  }
                />
              </div>
            </div>
          );
        })}
      </div>

      {!isCompactLayout ? (
        <button
          type="button"
          className="settings-dialog__sidebar-add"
          onClick={handleAddProfile}
        >
          <span className="settings-dialog__sidebar-add-icon">+</span>
          <span>新增供应商</span>
        </button>
      ) : null}
    </div>
  );

  const renderPresetList = () => (
    <div className="settings-dialog__sidebar-shell">
      <div className="settings-dialog__sidebar-summary">
        <div className="settings-dialog__sidebar-summary-row">
          <span className="settings-dialog__sidebar-summary-title">
            默认模型
          </span>
          {isCompactLayout ? (
            <button
              type="button"
              className="settings-dialog__sidebar-summary-action"
              onClick={handleAddPreset}
            >
              新增预设
            </button>
          ) : null}
        </div>
        {isCompactLayout ? (
          <span className="settings-dialog__sidebar-summary-text">
            先选中一个预设，再进入详情页调整默认路由。
          </span>
        ) : null}
      </div>

      <div className="settings-dialog__sidebar-list">
        {presetsDraft.map((preset) => {
          const isSelected = preset.id === selectedPreset?.id;
          const isActive = preset.id === activePresetIdDraft;
          const configuredRouteCount = getConfiguredRouteCount(preset);

          return (
            <button
              key={preset.id}
              type="button"
              className={`settings-dialog__sidebar-item ${
                isSelected ? 'settings-dialog__sidebar-item--active' : ''
              }`}
              onClick={() => handleSelectPreset(preset.id)}
            >
              <div className="settings-dialog__sidebar-item-head">
                <div className="settings-dialog__sidebar-item-top">
                  <span>{preset.name}</span>
                  {isActive ? (
                    <span className="settings-dialog__sidebar-badge settings-dialog__sidebar-badge--accent">
                      当前
                    </span>
                  ) : null}
                </div>
                {isCompactLayout ? (
                  <ChevronRight
                    size={16}
                    className="settings-dialog__sidebar-item-arrow"
                    aria-hidden="true"
                  />
                ) : null}
              </div>

              <div className="settings-dialog__sidebar-item-meta">
                <span>{configuredRouteCount}/3 已配置</span>
                {isCompactLayout ? (
                  <span>{isActive ? '正在生效' : '点击查看详情'}</span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {!isCompactLayout ? (
        <button
          type="button"
          className="settings-dialog__sidebar-add"
          onClick={handleAddPreset}
        >
          <span className="settings-dialog__sidebar-add-icon">+</span>
          <span>新增预设</span>
        </button>
      ) : null}
    </div>
  );

  const renderCompactCatalog = (stageKey: string, content: ReactNode) => (
    <div className="settings-dialog__workspace settings-dialog__workspace--single">
      <div className="settings-dialog__content-panel settings-dialog__content-panel--compact">
        <div key={stageKey} className="settings-dialog__mobile-stage">
          {content}
        </div>
      </div>
    </div>
  );

  const renderProviderForm = (compactMode = false) => {
    if (!selectedProfile) {
      return (
        <div className="settings-dialog__empty-panel">请选择一个供应商。</div>
      );
    }

    const selectedCounts = getModelTypeCounts(runtimeState.models);
    const draftState = getProviderDraftState(selectedProfile, initialProfiles);
    const totalModels =
      selectedCounts.image + selectedCounts.video + selectedCounts.text;

    return (
      <div
        key={compactMode ? `provider-detail-${selectedProfile.id}` : undefined}
        className={`settings-dialog__content-panel settings-dialog__content-panel--providers ${
          compactMode ? 'settings-dialog__content-panel--detail' : ''
        }`}
      >
        {compactMode ? (
          <div className="settings-dialog__compact-stage-header">
            <button
              type="button"
              className="settings-dialog__compact-back"
              onClick={() => setCompactProviderMode('catalog')}
            >
              <ChevronLeft size={16} />
              <span>返回供应商目录</span>
            </button>
            <div className="settings-dialog__compact-stage-copy">
              <span className="settings-dialog__compact-stage-eyebrow">
                供应商配置
              </span>
              <p className="settings-dialog__compact-stage-text">
                进入详情后再编辑接口信息、密钥和模型同步配置。
              </p>
            </div>
          </div>
        ) : null}
        <div className="settings-dialog__section settings-dialog__section--compact">
          <div className="settings-dialog__panel-header">
            <div className="settings-dialog__profile-hero">
              <ProviderAvatar profile={selectedProfile} size="large" />
              <div>
                <h3 className="settings-dialog__section-title">
                  {selectedProfile.name}
                </h3>
                <div className="settings-dialog__inline-meta">
                  <span>
                    {PROVIDER_TYPE_META[selectedProfile.providerType].label}
                  </span>
                  <span>{selectedProfile.enabled ? '启用' : '停用'}</span>
                  <span>{totalModels} 个模型</span>
                  <span>{draftState === 'saved' ? '已保存' : '未保存'}</span>
                </div>
              </div>
            </div>
            {!isManagedProviderProfile(selectedProfile.id) ? (
              <button
                type="button"
                className="settings-dialog__danger-button"
                onClick={() => handleDeleteProfile(selectedProfile.id)}
              >
                删除
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-dialog__section">
          <div className="settings-dialog__section-header">
            <div>
              <h3 className="settings-dialog__section-title">基础配置</h3>
            </div>
          </div>

          <div className="settings-dialog__grid">
            <div className="settings-dialog__field settings-dialog__field--column">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                名称
              </label>
              <input
                type="text"
                className="settings-dialog__input"
                value={selectedProfile.name}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    name: event.target.value,
                  }))
                }
              />
            </div>

            <div className="settings-dialog__field settings-dialog__field--column">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                接口类型
              </label>
              <select
                className="settings-dialog__select"
                value={selectedProfile.providerType}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => {
                    const providerType = event.target
                      .value as ProviderProfile['providerType'];
                    const previousDefaultAuth = inferAuthTypeForProviderType(
                      profile.providerType
                    );
                    const nextDefaultAuth =
                      inferAuthTypeForProviderType(providerType);

                    return {
                      ...profile,
                      providerType,
                      authType:
                        profile.authType === previousDefaultAuth
                          ? nextDefaultAuth
                          : profile.authType,
                    };
                  })
                }
              >
                {PROVIDER_TYPE_OPTIONS.map((providerType) => (
                  <option key={providerType} value={providerType}>
                    {PROVIDER_TYPE_META[providerType].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                图标 URL
              </label>
              <input
                type="url"
                className="settings-dialog__input"
                value={selectedProfile.iconUrl || ''}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    iconUrl: event.target.value,
                  }))
                }
                placeholder="可选，留空时自动生成默认图标"
              />
              <span className="settings-dialog__field-hint">
                支持填写远程图片地址；未填写时将根据供应商名称生成默认图标。
              </span>
            </div>

            <div className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
              <div className="settings-dialog__label-with-tooltip settings-dialog__label-with-tooltip--left">
                <label className="settings-dialog__label settings-dialog__label--stacked">
                  API Key
                </label>
                <Tooltip
                  content={
                    <div>
                      您可以从以下地址获取 API Key:
                      <br />
                      <a
                        href="https://api.tu-zi.com/token"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#F39C12', textDecoration: 'none' }}
                      >
                        api.tu-zi.com/token
                      </a>
                    </div>
                  }
                  placement="top"
                  theme="light"
                  showArrow={false}
                >
                  <InfoCircleIcon className="settings-dialog__tooltip-icon" />
                </Tooltip>
              </div>
              <input
                type="password"
                className="settings-dialog__input"
                value={selectedProfile.apiKey}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    apiKey: event.target.value,
                  }))
                }
                autoComplete="off"
              />
            </div>

            <div className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                API 地址
              </label>
              <input
                type="text"
                className="settings-dialog__input"
                value={selectedProfile.baseUrl}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    baseUrl: event.target.value,
                  }))
                }
                placeholder={TUZI_PROVIDER_DEFAULT_BASE_URL}
              />
            </div>

            <div className="settings-dialog__field settings-dialog__field--column">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                鉴权方式
              </label>
              <select
                className="settings-dialog__select"
                value={selectedProfile.authType}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    authType: event.target.value as ProviderProfile['authType'],
                  }))
                }
              >
                {AUTH_TYPE_OPTIONS.map((authType) => (
                  <option key={authType} value={authType}>
                    {AUTH_TYPE_META[authType].label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {selectedProfile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID ? (
          <div className="settings-dialog__section settings-dialog__section--compact">
            <div className="settings-dialog__compat-card">
              <div className="settings-dialog__compat-title">兼容默认模型</div>
              <div className="settings-dialog__compat-meta">
                <span>图片：{imageModelName || getDefaultImageModel()}</span>
                <span>视频：{videoModelName || getDefaultVideoModel()}</span>
                <span>文本：{textModelName || getDefaultTextModel()}</span>
              </div>
            </div>
          </div>
        ) : null}

        {renderProviderModelSummary()}
      </div>
    );
  };

  const renderProviderModelSummary = () => {
    const vendorPriorityMap = new Map(
      DISCOVERY_VENDOR_ORDER.map((vendor, index) => [vendor, index])
    );
    const modelSearch = deferredModelSearchQuery.trim();
    const typeCounts = getModelTypeCounts(runtimeState.models);
    const filteredModels = runtimeState.models.filter((model) =>
      matchesProviderModelQuery(model, modelSearch)
    );
    const modelGroups = MODEL_SUMMARY_GROUP_ORDER.map((type) => ({
      type,
      models: filteredModels
        .filter((model) => model.type === type)
        .sort((left, right) => {
          const leftPriority =
            vendorPriorityMap.get(left.vendor) ?? Number.MAX_SAFE_INTEGER;
          const rightPriority =
            vendorPriorityMap.get(right.vendor) ?? Number.MAX_SAFE_INTEGER;

          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
          }

          return left.id.localeCompare(right.id, 'zh-Hans-CN');
        }),
    })).filter((group) => group.models.length > 0);
    const showSearchToolbar = canManageModels || runtimeState.models.length > 0;
    const shouldShowEmptySearch =
      runtimeState.models.length > 0 &&
      filteredModels.length === 0 &&
      Boolean(modelSearch);
    const shouldShowErrorState =
      runtimeState.status === 'error' && runtimeState.models.length === 0;
    const shouldShowHintState =
      !canManageModels && runtimeState.models.length === 0;

    return (
      <div className="settings-dialog__section">
        <div className="settings-dialog__section-header">
          <div>
            <h3 className="settings-dialog__section-title">模型</h3>
            <div className="settings-dialog__inline-meta">
              <span>已添加 {runtimeState.models.length} 个</span>
              <span>图 {typeCounts.image}</span>
              <span>视 {typeCounts.video}</span>
              <span>文 {typeCounts.text}</span>
            </div>
          </div>
        </div>

        {showSearchToolbar ? (
          <div className="settings-dialog__model-toolbar">
            <label
              className={`settings-dialog__model-search ${
                runtimeState.models.length === 0
                  ? 'settings-dialog__model-search--disabled'
                  : ''
              }`}
            >
              <Search size={15} />
              <input
                type="text"
                value={modelSearchQuery}
                onChange={(event) => setModelSearchQuery(event.target.value)}
                placeholder={
                  runtimeState.models.length > 0
                    ? '搜索模型 ID、名称或品牌'
                    : '获取模型后可搜索'
                }
                disabled={runtimeState.models.length === 0}
              />
              {modelSearchQuery ? (
                <button
                  type="button"
                  className="settings-dialog__model-search-clear"
                  onClick={() => setModelSearchQuery('')}
                  aria-label="清空搜索"
                >
                  <X size={14} />
                </button>
              ) : null}
            </label>
            <button
              type="button"
              className="settings-dialog__button settings-dialog__button--fetch"
              onClick={handleFetchModels}
              disabled={!canManageModels || runtimeState.status === 'loading'}
            >
              {runtimeState.status === 'loading' ? (
                <>
                  <Loader2
                    size={15}
                    className="settings-dialog__button-spinner"
                  />
                  同步中
                </>
              ) : (
                '获取模型'
              )}
            </button>
          </div>
        ) : null}

        {modelGroups.length > 0 ? (
          <div className="settings-dialog__model-type-groups">
            {modelGroups.map(({ type, models }) => (
              <div key={type} className="settings-dialog__model-type-group">
                <div className="settings-dialog__model-type-header">
                  <span className="settings-dialog__model-type-title">
                    {MODEL_GROUP_LABELS[type]}
                  </span>
                  <span className="settings-dialog__model-type-count">
                    {models.length}
                  </span>
                </div>
                <div className="settings-dialog__model-type-list">
                  {models.map((model) => {
                    const palette = getModelVendorPalette(model.vendor);

                    return (
                      <div
                        key={model.id}
                        className="settings-dialog__model-type-item"
                        style={
                          {
                            '--model-brand-accent': palette.accent,
                            '--model-brand-surface': palette.surface,
                            '--model-brand-border': palette.border,
                          } as CSSProperties
                        }
                      >
                        <span className="settings-dialog__model-type-item-logo">
                          <ModelVendorMark vendor={model.vendor} size={16} />
                        </span>
                        <div className="settings-dialog__model-type-item-copy">
                          <span className="settings-dialog__model-type-item-id">
                            {model.id}
                          </span>
                          <span className="settings-dialog__model-type-item-vendor">
                            {getDiscoveryVendorLabel(model.vendor)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : shouldShowEmptySearch ? (
          <div className="settings-dialog__model-empty">
            没有匹配的模型，试试搜索品牌名或更完整的模型 ID。
          </div>
        ) : shouldShowErrorState ? (
          <div className="settings-dialog__model-empty settings-dialog__model-empty--error">
            <AlertTriangle size={16} />
            <span>{runtimeState.error || '模型获取失败，请稍后重试'}</span>
          </div>
        ) : shouldShowHintState ? (
          <div className="settings-dialog__model-empty">
            填写 API Key 后即可获取模型，获取完成后可在这里检索和浏览。
          </div>
        ) : (
          <div className="settings-dialog__model-empty">还没有已添加的模型</div>
        )}
      </div>
    );
  };

  const getRouteCandidateModels = (
    routeType: ModelType,
    capabilityKey: keyof ProviderProfile['capabilities'],
    route: RouteConfig
  ): Array<{ profile: ProviderProfile; models: ModelConfig[] }> => {
    const currentProfileId = getRouteProfileId(route);
    const currentModelId = getRouteModelId(route);

    return profilesDraft
      .filter(
        (profile) =>
          profile.id === currentProfileId ||
          (profile.enabled && profile.capabilities[capabilityKey])
      )
      .map((profile) => {
        const sourceModels =
          profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
            ? routeType === 'image'
              ? legacyImageModels
              : routeType === 'video'
              ? legacyVideoModels
              : legacyTextModels
            : runtimeModelDiscovery
                .getState(profile.id)
                .models.filter((model) => model.type === routeType);

        const uniqueModels = sourceModels.filter(
          (model, index, list) =>
            list.findIndex((item) => item.id === model.id) === index
        );

        if (
          profile.id === currentProfileId &&
          currentModelId &&
          !uniqueModels.some((model) => model.id === currentModelId)
        ) {
          uniqueModels.unshift({
            id: currentModelId,
            label: currentModelId,
            shortLabel: currentModelId,
            type: routeType,
            vendor: ModelVendor.OTHER,
          });
        }

        return {
          profile,
          models: uniqueModels,
        };
      })
      .filter((group) => group.models.length > 0);
  };

  const renderPresetRouteEditor = (
    routeType: ModelType,
    route: RouteConfig,
    profileCapabilityKey: keyof ProviderProfile['capabilities']
  ) => {
    const routeGroups = getRouteCandidateModels(
      routeType,
      profileCapabilityKey,
      route
    );
    const selectedProfileId = getRouteProfileId(route);
    const selectedModelId = getRouteModelId(route);
    const selectedProfileName =
      profilesDraft.find((profile) => profile.id === selectedProfileId)?.name ||
      '未配置';

    return (
      <div
        className={`settings-dialog__route-card settings-dialog__route-card--${routeType}`}
      >
        <div className="settings-dialog__route-card-top">
          <div className="settings-dialog__route-card-title">
            {ROUTE_LABELS[routeType]}
          </div>
        </div>
        <div className="settings-dialog__stack">
          <div className="settings-dialog__field settings-dialog__field--column">
            <label className="settings-dialog__label settings-dialog__label--stacked">
              默认模型
            </label>
            <select
              className="settings-dialog__select"
              value={
                selectedProfileId && selectedModelId
                  ? encodeModelRefValue(selectedProfileId, selectedModelId)
                  : ''
              }
              onChange={(event) =>
                handleRouteModelChange(routeType, event.target.value)
              }
            >
              <option value="">未配置</option>
              {routeGroups.map(({ profile, models }) => (
                <optgroup
                  key={profile.id}
                  label={`${profile.name}${
                    profile.enabled ? '' : '（已停用）'
                  }`}
                >
                  {models.map((model) => (
                    <option
                      key={`${profile.id}-${model.id}`}
                      value={encodeModelRefValue(profile.id, model.id)}
                    >
                      {model.shortLabel || model.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="settings-dialog__route-meta">
            <span>{selectedProfileName}</span>
            <span>{selectedModelId || '未选择模型'}</span>
            {routeGroups.length === 0 ? <span>暂无可选模型</span> : null}
          </div>
        </div>
      </div>
    );
  };

  const renderPresetManagement = (compactMode = false) => {
    if (!selectedPreset) {
      return (
        <div className="settings-dialog__empty-panel">
          请选择一个默认模型预设。
        </div>
      );
    }

    const configuredRouteCount = getConfiguredRouteCount(selectedPreset);
    const isActive = selectedPreset.id === activePresetIdDraft;

    return (
      <div
        key={compactMode ? `preset-detail-${selectedPreset.id}` : undefined}
        className={`settings-dialog__content-panel ${
          compactMode ? 'settings-dialog__content-panel--detail' : ''
        }`}
      >
        {compactMode ? (
          <div className="settings-dialog__compact-stage-header">
            <button
              type="button"
              className="settings-dialog__compact-back"
              onClick={() => setCompactPresetMode('catalog')}
            >
              <ChevronLeft size={16} />
              <span>返回模型预设</span>
            </button>
            <div className="settings-dialog__compact-stage-copy">
              <span className="settings-dialog__compact-stage-eyebrow">
                模型预设
              </span>
              <p className="settings-dialog__compact-stage-text">
                在这里设置图片、视频和文本模型的默认路由。
              </p>
            </div>
          </div>
        ) : null}
        <div className="settings-dialog__section">
          <div className="settings-dialog__panel-header">
            <div>
              <h3 className="settings-dialog__section-title">
                {selectedPreset.name}
              </h3>
              <div className="settings-dialog__inline-meta">
                <span>{isActive ? '当前预设' : '未激活'}</span>
                <span>{configuredRouteCount}/3 已配置</span>
              </div>
            </div>
            <div className="settings-dialog__inline-row">
              <button
                type="button"
                className="settings-dialog__ghost-button"
                onClick={() => {
                  void persistPresetConfiguration(
                    presetsDraft,
                    selectedPreset.id
                  );
                }}
              >
                设为当前预设
              </button>
              <button
                type="button"
                className="settings-dialog__danger-button"
                onClick={() => handleDeletePreset(selectedPreset.id)}
                disabled={presetsDraft.length <= 1}
              >
                删除预设
              </button>
            </div>
          </div>

          <div className="settings-dialog__grid">
            <div className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                预设名称
              </label>
              <input
                type="text"
                className="settings-dialog__input"
                value={selectedPreset.name}
                onChange={(event) =>
                  updatePreset(selectedPreset.id, (preset) => ({
                    ...preset,
                    name: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        </div>

        <div className="settings-dialog__routes">
          {renderPresetRouteEditor(
            'image',
            selectedPreset.image,
            'supportsImage'
          )}
          {renderPresetRouteEditor(
            'video',
            selectedPreset.video,
            'supportsVideo'
          )}
          {renderPresetRouteEditor('text', selectedPreset.text, 'supportsText')}
        </div>
      </div>
    );
  };

  const renderCanvasSettings = () => (
    <div className="settings-dialog__workspace settings-dialog__workspace--single">
      <div className="settings-dialog__content-panel settings-dialog__content-panel--canvas">
        {isCompactLayout ? (
          <div className="settings-dialog__compact-stage-header">
            <div className="settings-dialog__compact-stage-copy">
              <span className="settings-dialog__compact-stage-eyebrow">
                画布显示
              </span>
              <p className="settings-dialog__compact-stage-text">
                手机上会以更集中的卡片形式展示，方便快速切换画布相关开关。
              </p>
            </div>
          </div>
        ) : null}
        <div className="settings-dialog__section settings-dialog__section--canvas-card">
          <div className="settings-dialog__section-header">
            <div>
              <h3 className="settings-dialog__section-title">画布显示配置</h3>
            </div>
          </div>

          <div className="settings-dialog__preference settings-dialog__preference--panel">
            <div className="settings-dialog__toggle-copy">
              <span className="settings-dialog__toggle-title">
                任务进度卡片
              </span>
              <span className="settings-dialog__toggle-desc">
                在画布中显示任务进度卡片，便于追踪当前生成状态。
              </span>
            </div>
            <Switch
              size="small"
              value={showWorkZoneCard}
              onChange={(checked) =>
                void handleCanvasVisibilityChange(checked as boolean)
              }
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderSettingsNav = () => {
    return (
      <aside className="settings-dialog__nav">
        <div className="settings-dialog__nav-shell">
          <div className="settings-dialog__nav-list">
            {VIEW_SECTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`settings-dialog__nav-item ${
                  activeView === item.value
                    ? 'settings-dialog__nav-item--active'
                    : ''
                }`}
                onClick={() => handleViewChange(item.value)}
              >
                <span className="settings-dialog__nav-item-title">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    );
  };

  const renderActiveView = () => {
    if (activeView === 'canvas') {
      return renderCanvasSettings();
    }

    if (activeView === 'presets') {
      if (isCompactLayout) {
        return compactPresetMode === 'catalog'
          ? renderCompactCatalog('presets-catalog', renderPresetList())
          : renderPresetManagement(true);
      }

      return (
        <div className="settings-dialog__workspace">
          <aside className="settings-dialog__sidebar">
            {renderPresetList()}
          </aside>
          {renderPresetManagement()}
        </div>
      );
    }

    if (isCompactLayout) {
      return compactProviderMode === 'catalog'
        ? renderCompactCatalog('providers-catalog', renderProviderList())
        : renderProviderForm(true);
    }

    return (
      <div className="settings-dialog__workspace">
        <aside className="settings-dialog__sidebar">
          {renderProviderList()}
        </aside>
        {renderProviderForm()}
      </div>
    );
  };

  return (
    <>
      <WinBoxWindow
        visible={appState.openSettings}
        title="设置"
        onClose={handleWindowClose}
        width={isCompactLayout ? '100%' : '88%'}
        height={isCompactLayout ? '100%' : '88%'}
        minWidth={
          isCompactLayout
            ? Math.max(320, Math.min(viewportWidth - 16, 640))
            : 1080
        }
        minHeight={
          isCompactLayout
            ? Math.max(520, Math.min(viewportHeight - 16, 820))
            : 680
        }
        x="center"
        y="center"
        maximizable={true}
        minimizable={false}
        resizable={!isCompactLayout}
        movable={!isCompactLayout}
        modal={false}
        className="winbox-ai-generation winbox-tool-window winbox-settings-window"
        container={container}
        background="#ffffff"
        autoMaximize={isCompactLayout}
      >
        <div className="settings-dialog" data-testid="settings-dialog">
          <div className="settings-dialog__layout">
            {renderSettingsNav()}
            <div className="settings-dialog__main">{renderActiveView()}</div>
          </div>
        </div>
      </WinBoxWindow>
      <ModelDiscoveryDialog
        open={discoveryDialogOpen}
        container={container}
        models={runtimeState.discoveredModels}
        selectedModelIds={runtimeState.selectedModelIds}
        onClose={() => setDiscoveryDialogOpen(false)}
        onConfirm={handleApplySelectedModels}
      />
    </>
  );
};

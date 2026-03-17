import { Dialog, DialogContent } from '../dialog/dialog';
import { useDrawnix } from '../../hooks/use-drawnix';
import './settings-dialog.scss';
import { useI18n } from '../../i18n';
import { useEffect, useState } from 'react';
import { Tooltip, Checkbox } from 'tdesign-react';
import { InfoCircleIcon } from 'tdesign-icons-react';
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
  type InvocationPreset,
  type ModelRef,
  type ProviderProfile,
  type RouteConfig,
} from '../../utils/settings-manager';

export { IMAGE_MODEL_GROUPED_SELECT_OPTIONS as IMAGE_MODEL_GROUPED_OPTIONS } from '../../constants/model-config';
export { VIDEO_MODEL_SELECT_OPTIONS as VIDEO_MODEL_OPTIONS } from '../../constants/model-config';

type SettingsView = 'providers' | 'presets';

const VIEW_TABS: Array<{ value: SettingsView; label: string }> = [
  { value: 'providers', label: '供应商配置' },
  { value: 'presets', label: '默认模型预设' },
];

const PROVIDER_TYPE_OPTIONS: ProviderProfile['providerType'][] = [
  'openai-compatible',
  'gemini-compatible',
  'custom',
];

const AUTH_TYPE_OPTIONS: ProviderProfile['authType'][] = ['bearer', 'header'];

const ROUTE_LABELS: Record<ModelType, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
};

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createProfile(index: number): ProviderProfile {
  return {
    id: createId('profile'),
    name: `供应商 ${index}`,
    providerType: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    authType: 'bearer',
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
  const { t } = useI18n();

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
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [discoveryDialogOpen, setDiscoveryDialogOpen] = useState(false);

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
  const selectedProfileInitial = initialProfiles.find(
    (profile) => profile.id === selectedProfile?.id
  );
  const selectedProfileDirty =
    !!selectedProfile &&
    !areEqual(selectedProfileInitial || null, selectedProfile);
  const selectedProfileSaved = !!selectedProfileInitial;
  const canManageModels =
    !!selectedProfile &&
    selectedProfileSaved &&
    !selectedProfileDirty &&
    !!selectedProfile.baseUrl.trim();

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
      setShowWorkZoneCard(
        localStorage.getItem(LS_KEYS.WORKZONE_CARD_VISIBLE) !== 'false'
      );
    } catch {
      setShowWorkZoneCard(true);
    }

    setActiveView('providers');
    setSyncMessage(null);
    setDiscoveryDialogOpen(false);
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
    setSyncMessage(null);
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

  const handleAddProfile = () => {
    const nextProfile = createProfile(profilesDraft.length + 1);
    setProfilesDraft((current) => [...current, nextProfile]);
    setSelectedProfileId(nextProfile.id);
    setActiveView('providers');
  };

  const handleDeleteProfile = (profileId: string) => {
    if (profileId === LEGACY_DEFAULT_PROVIDER_PROFILE_ID) {
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
  };

  const handleRouteModelChange = (routeType: ModelType, value: string) => {
    if (!selectedPreset) {
      return;
    }

    const nextModelRef = parseModelRefValue(value);

    updatePreset(selectedPreset.id, (preset) =>
      updatePresetRoute(preset, routeType, {
        defaultModelRef: nextModelRef,
      })
    );
  };

  const handleFetchModels = async () => {
    if (!selectedProfile) {
      setSyncMessage('请先选择供应商配置');
      return;
    }

    if (!selectedProfileSaved || selectedProfileDirty) {
      setSyncMessage('请先保存当前供应商配置，再获取模型');
      return;
    }

    const trimmedApiKey = selectedProfile.apiKey.trim();
    const normalizedBaseUrl = normalizeModelApiBaseUrl(
      selectedProfile.baseUrl.trim() || 'https://api.tu-zi.com/v1'
    );

    if (!trimmedApiKey) {
      setSyncMessage('请先填写 API Key');
      return;
    }

    try {
      const discovered = await runtimeModelDiscovery.discover(
        selectedProfile.id,
        normalizedBaseUrl,
        trimmedApiKey
      );
      setSyncMessage(
        `已获取 ${discovered.length} 个模型，请选择需要添加的模型`
      );
      setDiscoveryDialogOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型同步失败';
      runtimeModelDiscovery.setError(selectedProfile.id, message);
      setSyncMessage(message);
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

    setSyncMessage(
      selectedModels.length > 0
        ? `已为 ${selectedProfile.name} 添加 ${selectedModels.length} 个模型`
        : `已清空 ${selectedProfile.name} 的已添加模型`
    );
    setDiscoveryDialogOpen(false);
  };

  const handleCancel = () => {
    setAppState({ ...appState, openSettings: false });
  };

  const handleSave = async () => {
    const normalizedProfiles = profilesDraft.map((profile) => {
      const normalizedBaseUrl = profile.baseUrl.trim()
        ? normalizeModelApiBaseUrl(profile.baseUrl)
        : '';

      return {
        ...profile,
        name: profile.name.trim() || '未命名供应商',
        baseUrl: normalizedBaseUrl,
        apiKey: profile.apiKey.trim(),
      };
    });

    const profileIds = new Set(normalizedProfiles.map((profile) => profile.id));
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
      legacyProfile?.baseUrl || 'https://api.tu-zi.com/v1'
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
      textModelName.trim() || legacyTextModels[0]?.id || getDefaultTextModel();
    const normalizedActiveImageModel =
      getRouteModelId(activePreset?.image) || normalizedImageModel;
    const normalizedActiveVideoModel =
      getRouteModelId(activePreset?.video) || normalizedVideoModel;
    const normalizedActiveTextModel =
      getRouteModelId(activePreset?.text) || normalizedTextModel;

    runtimeModelDiscovery.invalidateIfConfigChanged(
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
      normalizedLegacyBaseUrl,
      legacyProfile?.apiKey || ''
    );

    await geminiSettings.update({
      apiKey: legacyProfile?.apiKey || '',
      baseUrl: normalizedLegacyBaseUrl,
      imageModelName: normalizedActiveImageModel,
      videoModelName: normalizedActiveVideoModel,
      textModelName: normalizedActiveTextModel,
    });
    await providerProfilesSettings.update(normalizedProfiles);
    await providerCatalogsSettings.update(
      providerCatalogsSettings
        .get()
        .filter((catalog) => profileIds.has(catalog.profileId))
    );
    await invocationPresetsSettings.update(normalizedPresets);
    await invocationPresetsSettings.setActivePresetId(normalizedActivePresetId);

    try {
      localStorage.setItem(
        LS_KEYS.WORKZONE_CARD_VISIBLE,
        String(showWorkZoneCard)
      );
      window.dispatchEvent(new CustomEvent('workzone-visibility-changed'));
    } catch {
      // localStorage not available
    }

    setAppState({ ...appState, openSettings: false });
  };

  const renderProviderList = () => (
    <div className="settings-dialog__sidebar-list">
      {profilesDraft.map((profile) => {
        const state = runtimeModelDiscovery.getState(profile.id);
        const isSelected = profile.id === selectedProfile?.id;

        return (
          <button
            key={profile.id}
            type="button"
            className={`settings-dialog__sidebar-item ${
              isSelected ? 'settings-dialog__sidebar-item--active' : ''
            }`}
            onClick={() => setSelectedProfileId(profile.id)}
          >
            <div className="settings-dialog__sidebar-item-top">
              <span>{profile.name}</span>
              {profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID ? (
                <span className="settings-dialog__sidebar-badge">默认</span>
              ) : null}
            </div>
            <div className="settings-dialog__sidebar-item-meta">
              <span>{profile.enabled ? '已启用' : '已停用'}</span>
              <span>{state.models.length} 已添加</span>
              <span>{state.discoveredModels.length} 已发现</span>
            </div>
          </button>
        );
      })}
      <button
        type="button"
        className="settings-dialog__sidebar-add"
        onClick={handleAddProfile}
      >
        + 新增供应商
      </button>
    </div>
  );

  const renderPresetList = () => (
    <div className="settings-dialog__sidebar-list">
      {presetsDraft.map((preset) => {
        const isSelected = preset.id === selectedPreset?.id;
        const isActive = preset.id === activePresetIdDraft;

        return (
          <button
            key={preset.id}
            type="button"
            className={`settings-dialog__sidebar-item ${
              isSelected ? 'settings-dialog__sidebar-item--active' : ''
            }`}
            onClick={() => setSelectedPresetId(preset.id)}
          >
            <div className="settings-dialog__sidebar-item-top">
              <span>{preset.name}</span>
              {isActive ? (
                <span className="settings-dialog__sidebar-badge">当前</span>
              ) : null}
            </div>
            <div className="settings-dialog__sidebar-item-meta">
              <span>
                图 {getRouteModelId(preset.image) ? '已配置' : '未配'}
              </span>
              <span>
                视 {getRouteModelId(preset.video) ? '已配置' : '未配'}
              </span>
              <span>文 {getRouteModelId(preset.text) ? '已配置' : '未配'}</span>
            </div>
          </button>
        );
      })}
      <button
        type="button"
        className="settings-dialog__sidebar-add"
        onClick={handleAddPreset}
      >
        + 新增预设
      </button>
    </div>
  );

  const renderProviderForm = () => {
    if (!selectedProfile) {
      return (
        <div className="settings-dialog__empty-panel">请选择一个供应商。</div>
      );
    }

    return (
      <div className="settings-dialog__content-panel">
        <div className="settings-dialog__section">
          <div className="settings-dialog__section-header">
            <div>
              <h3 className="settings-dialog__section-title">供应商详情</h3>
              <p className="settings-dialog__section-note">
                管理 Base
                URL、认证方式和能力声明。模型与供应商绑定，实际调用会优先按所选模型所属供应商解析。
              </p>
            </div>
            {selectedProfile.id !== LEGACY_DEFAULT_PROVIDER_PROFILE_ID ? (
              <button
                type="button"
                className="settings-dialog__danger-button"
                onClick={() => handleDeleteProfile(selectedProfile.id)}
              >
                删除供应商
              </button>
            ) : null}
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
                Provider Type
              </label>
              <select
                className="settings-dialog__select"
                value={selectedProfile.providerType}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    providerType: event.target
                      .value as ProviderProfile['providerType'],
                  }))
                }
              >
                {PROVIDER_TYPE_OPTIONS.map((providerType) => (
                  <option key={providerType} value={providerType}>
                    {providerType}
                  </option>
                ))}
              </select>
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
                Base URL
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
                placeholder="https://api.tu-zi.com/v1"
              />
            </div>

            <div className="settings-dialog__field settings-dialog__field--column">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                Auth Type
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
                    {authType}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-dialog__field settings-dialog__field--column">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                状态
              </label>
              <div className="settings-dialog__inline-row">
                <Checkbox
                  checked={selectedProfile.enabled}
                  disabled={
                    selectedProfile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
                  }
                  onChange={(checked) =>
                    updateProfile(selectedProfile.id, (profile) => ({
                      ...profile,
                      enabled: checked as boolean,
                    }))
                  }
                >
                  启用此供应商
                </Checkbox>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-dialog__section">
          <h3 className="settings-dialog__section-title">接口能力</h3>
          <div className="settings-dialog__capabilities">
            {(
              [
                ['supportsModelsEndpoint', '支持 /v1/models'],
                ['supportsImage', '支持图片'],
                ['supportsVideo', '支持视频'],
                ['supportsText', '支持文本'],
                ['supportsTools', '支持 Tools'],
              ] as Array<[keyof ProviderProfile['capabilities'], string]>
            ).map(([key, label]) => (
              <Checkbox
                key={key}
                checked={selectedProfile.capabilities[key]}
                onChange={(checked) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    capabilities: {
                      ...profile.capabilities,
                      [key]: checked as boolean,
                    },
                  }))
                }
              >
                {label}
              </Checkbox>
            ))}
          </div>
        </div>

        {selectedProfile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID ? (
          <div className="settings-dialog__section">
            <div className="settings-dialog__compat-card">
              <div className="settings-dialog__compat-title">兼容模式说明</div>
              <p className="settings-dialog__compat-text">
                旧版 `gemini`
                默认模型字段仍会保留，用于兼容历史链路和本地数据迁移。
                这组值会在保存时自动跟随当前激活的默认模型预设同步，无需再单独设置。
              </p>
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
    const modelCounts = {
      image: runtimeState.models.filter((model) => model.type === 'image')
        .length,
      video: runtimeState.models.filter((model) => model.type === 'video')
        .length,
      text: runtimeState.models.filter((model) => model.type === 'text').length,
    };

    return (
      <div className="settings-dialog__section">
        <div className="settings-dialog__section-header">
          <div>
            <h3 className="settings-dialog__section-title">模型目录</h3>
            <p className="settings-dialog__section-note">
              在当前供应商下同步并选择需要启用的模型；这里只管理目录，不会自动切换默认预设或覆盖当前显式选中的模型。
            </p>
          </div>
          <button
            type="button"
            className="settings-dialog__button settings-dialog__button--save"
            onClick={handleFetchModels}
            disabled={!canManageModels || runtimeState.status === 'loading'}
          >
            {runtimeState.status === 'loading' ? '同步中...' : '管理模型'}
          </button>
        </div>

        <div className="settings-dialog__summary-grid">
          <div className="settings-dialog__summary-card">
            <span className="settings-dialog__summary-label">状态</span>
            <strong>{runtimeState.status}</strong>
          </div>
          <div className="settings-dialog__summary-card">
            <span className="settings-dialog__summary-label">已发现</span>
            <strong>{runtimeState.discoveredModels.length}</strong>
          </div>
          <div className="settings-dialog__summary-card">
            <span className="settings-dialog__summary-label">已添加</span>
            <strong>{runtimeState.models.length}</strong>
          </div>
          <div className="settings-dialog__summary-card">
            <span className="settings-dialog__summary-label">最后同步</span>
            <strong>
              {runtimeState.discoveredAt
                ? new Date(runtimeState.discoveredAt).toLocaleString()
                : '未同步'}
            </strong>
          </div>
        </div>

        <div className="settings-dialog__summary-strip">
          <span>图片 {modelCounts.image}</span>
          <span>视频 {modelCounts.video}</span>
          <span>文本 {modelCounts.text}</span>
        </div>

        <div className="settings-dialog__notice">
          {syncMessage ||
            (canManageModels
              ? '当前供应商已保存，可直接同步并选择模型。'
              : '请先保存当前供应商配置，再管理模型。')}
        </div>
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
      <div className="settings-dialog__route-card">
        <div className="settings-dialog__route-card-title">
          {ROUTE_LABELS[routeType]}
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
            <span>当前供应商：{selectedProfileName}</span>
            <span>
              {selectedModelId
                ? '选择模型后会自动绑定对应供应商'
                : '请先在供应商配置中管理模型，再为预设选择默认模型'}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderPresetManagement = () => {
    if (!selectedPreset) {
      return (
        <div className="settings-dialog__empty-panel">
          请选择一个默认模型预设。
        </div>
      );
    }

    return (
      <div className="settings-dialog__content-panel">
        <div className="settings-dialog__section">
          <div className="settings-dialog__section-header">
            <div>
              <h3 className="settings-dialog__section-title">预设详情</h3>
              <p className="settings-dialog__section-note">
                为图片、视频、文本分别指定默认模型。这里提供的是默认值；运行时如果用户显式选择了别的模型，会优先按那个模型所属供应商调用。
              </p>
            </div>
            <div className="settings-dialog__inline-row">
              <button
                type="button"
                className="settings-dialog__ghost-button"
                onClick={() => setActivePresetIdDraft(selectedPreset.id)}
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

  const renderActiveView = () => {
    if (activeView === 'presets') {
      return (
        <div className="settings-dialog__workspace">
          <aside className="settings-dialog__sidebar">
            {renderPresetList()}
          </aside>
          {renderPresetManagement()}
        </div>
      );
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
    <Dialog
      open={appState.openSettings}
      onOpenChange={(open) => {
        if (!open && discoveryDialogOpen) {
          return;
        }
        setAppState({ ...appState, openSettings: open });
      }}
    >
      <DialogContent
        className="settings-dialog"
        container={container}
        data-testid="settings-dialog"
      >
        <div className="settings-dialog__header">
          <div>
            <h2 className="settings-dialog__title">{t('settings.title')}</h2>
            <p className="settings-dialog__subtitle">
              管理多供应商接入、模型目录和默认模型预设。
            </p>
          </div>
          <div className="settings-dialog__tabs">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className={`settings-dialog__tab ${
                  activeView === tab.value ? 'settings-dialog__tab--active' : ''
                }`}
                onClick={() => setActiveView(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {renderActiveView()}

        <div className="settings-dialog__footer-settings">
          <label className="settings-dialog__label">画布显示</label>
          <Checkbox
            checked={showWorkZoneCard}
            onChange={(checked) => setShowWorkZoneCard(checked as boolean)}
          >
            显示任务进度卡片
          </Checkbox>
        </div>

        <div className="settings-dialog__actions">
          <button
            className="settings-dialog__button settings-dialog__button--cancel"
            data-track="settings_click_cancel"
            onClick={handleCancel}
          >
            {t('settings.cancel')}
          </button>
          <button
            className="settings-dialog__button settings-dialog__button--save"
            data-track="settings_click_save"
            onClick={handleSave}
          >
            {t('settings.save')}
          </button>
        </div>
      </DialogContent>
      <ModelDiscoveryDialog
        open={discoveryDialogOpen}
        container={container}
        models={runtimeState.discoveredModels}
        selectedModelIds={runtimeState.selectedModelIds}
        onClose={() => setDiscoveryDialogOpen(false)}
        onConfirm={handleApplySelectedModels}
      />
    </Dialog>
  );
};

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from 'react';
import type { Subscription } from 'rxjs';
import {
  BENCHMARK_PROMPT_PRESETS,
  buildBenchmarkTarget,
  getDefaultPromptPreset,
  modelBenchmarkService,
  rankBenchmarkEntries,
  type BenchmarkCompareMode,
  type BenchmarkModality,
  type BenchmarkRankingMode,
  type ModelBenchmarkEntry,
  type ModelBenchmarkLaunchRequest,
  type ModelBenchmarkSession,
} from '../../services/model-benchmark-service';
import { runtimeModelDiscovery } from '../../utils/runtime-model-discovery';
import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  providerProfilesSettings,
  type ProviderProfile,
} from '../../utils/settings-manager';
import type { ModelConfig } from '../../constants/model-config';
import './model-benchmark-workbench.scss';

interface ModelBenchmarkWorkbenchProps {
  initialRequest?: ModelBenchmarkLaunchRequest;
}

type CapabilityKey =
  | 'supportsText'
  | 'supportsImage'
  | 'supportsVideo'
  | 'supportsAudio';

const MODALITY_LABELS: Record<BenchmarkModality, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
};

const MODE_LABELS: Record<BenchmarkCompareMode, string> = {
  'cross-provider': '同模型跨供应商',
  'cross-model': '同供应商跨模型',
  custom: '自定义批测',
};

const RANKING_LABELS: Record<BenchmarkRankingMode, string> = {
  speed: '速度优先',
  cost: '成本优先',
  balanced: '综合平衡',
};

const MAX_AUTO_CUSTOM_TARGETS = 6;

function isNonNullTarget<T>(value: T | null): value is T {
  return value !== null;
}

function getCapabilityKey(modality: BenchmarkModality): CapabilityKey {
  if (modality === 'text') return 'supportsText';
  if (modality === 'image') return 'supportsImage';
  if (modality === 'video') return 'supportsVideo';
  return 'supportsAudio';
}

function getAvailableProfilesForModality(
  profiles: ProviderProfile[],
  modality: BenchmarkModality
) {
  const capabilityKey = getCapabilityKey(modality);
  return profiles.filter(
    (profile) =>
      profile.enabled &&
      (profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID ||
        profile.capabilities[capabilityKey])
  );
}

function useDiscoveryVersion() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    return runtimeModelDiscovery.subscribe(() => {
      setVersion((value) => value + 1);
    });
  }, []);

  return version;
}

function useProviderProfilesState() {
  const [profiles, setProfiles] = useState<ProviderProfile[]>(() =>
    providerProfilesSettings.get()
  );

  useEffect(() => {
    const listener = (nextProfiles: ProviderProfile[]) => {
      setProfiles(nextProfiles);
    };
    providerProfilesSettings.addListener(listener);
    return () => {
      providerProfilesSettings.removeListener(listener);
    };
  }, []);

  return profiles;
}

function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) {
    return '--';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
}

function getSessionSummary(session: ModelBenchmarkSession | null) {
  if (!session) {
    return {
      total: 0,
      completed: 0,
      failed: 0,
    };
  }
  return session.entries.reduce(
    (summary, entry) => {
      summary.total += 1;
      if (entry.status === 'completed') summary.completed += 1;
      if (entry.status === 'failed') summary.failed += 1;
      return summary;
    },
    { total: 0, completed: 0, failed: 0 }
  );
}

function getProfileModels(
  profileId: string,
  modality: BenchmarkModality
): ModelConfig[] {
  const models =
    profileId === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      ? runtimeModelDiscovery.getProfilePreferredModels(profileId, modality)
      : runtimeModelDiscovery
          .getState(profileId)
          .models.filter((model) => model.type === modality);
  const deduped = new Map<string, ModelConfig>();
  models.forEach((model) => {
    if (model.type === modality && !deduped.has(model.id)) {
      deduped.set(model.id, model);
    }
  });
  return Array.from(deduped.values());
}

function ModelBenchmarkWorkbench({
  initialRequest,
}: ModelBenchmarkWorkbenchProps) {
  const profiles = useProviderProfilesState();
  const discoveryVersion = useDiscoveryVersion();
  const [storeState, setStoreState] = useState(() =>
    modelBenchmarkService.getState()
  );
  const [modality, setModality] = useState<BenchmarkModality>('text');
  const [compareMode, setCompareMode] =
    useState<BenchmarkCompareMode>('cross-provider');
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [selectedCustomKeys, setSelectedCustomKeys] = useState<string[]>([]);
  const [promptPresetId, setPromptPresetId] = useState(
    getDefaultPromptPreset('text').id
  );
  const [prompt, setPrompt] = useState(getDefaultPromptPreset('text').prompt);
  const [rankingMode, setRankingMode] =
    useState<BenchmarkRankingMode>('speed');
  const launchSignatureRef = useRef<string>('');

  useEffect(() => {
    const subscription: Subscription = modelBenchmarkService
      .observe()
      .subscribe((state) => {
        startTransition(() => {
          setStoreState(state);
        });
      });
    return () => subscription.unsubscribe();
  }, []);

  const availableProfiles = useMemo(() => {
    return getAvailableProfilesForModality(profiles, modality);
  }, [modality, profiles]);

  const profileOptions = useMemo(
    () =>
      availableProfiles.map((profile) => ({
        value: profile.id,
        label: profile.name,
      })),
    [availableProfiles]
  );

  const activeProfileModels = useMemo(() => {
    void discoveryVersion;
    if (!selectedProfileId) {
      return [];
    }
    return getProfileModels(selectedProfileId, modality);
  }, [discoveryVersion, modality, selectedProfileId]);

  const customTargets = useMemo(() => {
    void discoveryVersion;
    return availableProfiles.flatMap((profile) =>
      getProfileModels(profile.id, modality).map((model) =>
        buildBenchmarkTarget(profile.id, profile.name, model)
      )
    );
  }, [availableProfiles, discoveryVersion, modality]);

  useEffect(() => {
    if (!availableProfiles.length) {
      return;
    }

    const defaultPreset = getDefaultPromptPreset(modality);
    setPromptPresetId((current) =>
      BENCHMARK_PROMPT_PRESETS.some(
        (preset) => preset.modality === modality && preset.id === current
      )
        ? current
        : defaultPreset.id
    );
    setPrompt((current) =>
      current === getDefaultPromptPreset('text').prompt ||
      current === getDefaultPromptPreset('image').prompt ||
      current === getDefaultPromptPreset('video').prompt ||
      current === getDefaultPromptPreset('audio').prompt
        ? defaultPreset.prompt
        : current
    );

    if (
      !selectedProfileId ||
      !availableProfiles.some((profile) => profile.id === selectedProfileId)
    ) {
      setSelectedProfileId(availableProfiles[0].id);
    }
  }, [availableProfiles, modality, selectedProfileId]);

  useEffect(() => {
    if (!activeProfileModels.length) {
      setSelectedModelId('');
      setSelectedModelIds([]);
      return;
    }

    if (!activeProfileModels.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(activeProfileModels[0].id);
    }
    setSelectedModelIds((current) => {
      const kept = current.filter((modelId) =>
        activeProfileModels.some((model) => model.id === modelId)
      );
      return kept.length > 0
        ? kept
        : activeProfileModels.slice(0, 3).map((model) => model.id);
    });
  }, [activeProfileModels, selectedModelId]);

  useEffect(() => {
    if (selectedCustomKeys.length > 0) {
      return;
    }
    setSelectedCustomKeys(
      customTargets.slice(0, MAX_AUTO_CUSTOM_TARGETS).map((item) => item.selectionKey)
    );
  }, [customTargets, selectedCustomKeys.length]);

  const activeSession = useMemo(() => {
    return (
      storeState.sessions.find(
        (session) => session.id === storeState.activeSessionId
      ) || null
    );
  }, [storeState.activeSessionId, storeState.sessions]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    setRankingMode(activeSession.rankingMode);
  }, [activeSession]);

  const sessionSummary = useMemo(
    () => getSessionSummary(activeSession),
    [activeSession]
  );

  const sortedEntries = useMemo(() => {
    if (!activeSession) {
      return [];
    }
    return rankBenchmarkEntries(activeSession.entries, activeSession.rankingMode);
  }, [activeSession]);

  const resolvedTargets = useMemo(() => {
    if (compareMode === 'cross-provider') {
      if (!selectedModelId) {
        return [];
      }
      return availableProfiles
        .map((profile) => {
          const model = getProfileModels(profile.id, modality).find(
            (item) => item.id === selectedModelId
          );
          return model ? buildBenchmarkTarget(profile.id, profile.name, model) : null;
        })
        .filter(Boolean) as ReturnType<typeof buildBenchmarkTarget>[];
    }

    if (compareMode === 'cross-model') {
      if (!selectedProfileId) {
        return [];
      }
      const models = getProfileModels(selectedProfileId, modality).filter((model) =>
        selectedModelIds.includes(model.id)
      );
      const profile =
        availableProfiles.find((item) => item.id === selectedProfileId) || null;
      if (!profile) {
        return [];
      }
      return models.map((model) =>
        buildBenchmarkTarget(profile.id, profile.name, model)
      );
    }

    return customTargets.filter((target) =>
      selectedCustomKeys.includes(target.selectionKey)
    );
  }, [
    availableProfiles,
    compareMode,
    customTargets,
    modality,
    selectedCustomKeys,
    selectedModelId,
    selectedModelIds,
    selectedProfileId,
  ]);

  useEffect(() => {
    if (!initialRequest) {
      return;
    }
    const signature = JSON.stringify(initialRequest);
    if (!storeState.ready || launchSignatureRef.current === signature) {
      return;
    }
    launchSignatureRef.current = signature;

    const nextModality = initialRequest.modality || 'text';
    const nextProfiles = getAvailableProfilesForModality(profiles, nextModality);
    const nextCompareMode =
      initialRequest.compareMode ||
      (initialRequest.modelId ? 'cross-provider' : 'cross-model');
    const defaultPreset = getDefaultPromptPreset(nextModality);
    setModality(nextModality);
    setCompareMode(nextCompareMode);
    setPromptPresetId(defaultPreset.id);
    setPrompt(defaultPreset.prompt);
    if (initialRequest.profileId) {
      setSelectedProfileId(initialRequest.profileId);
    }
    if (initialRequest.modelId) {
      setSelectedModelId(initialRequest.modelId);
    }

    const schedule = window.setTimeout(() => {
      const profileId =
        initialRequest.profileId ||
        nextProfiles[0]?.id ||
        selectedProfileId;
      const targets =
        nextCompareMode === 'cross-provider' && initialRequest.modelId
          ? nextProfiles
              .map((profile) => {
                const model = getProfileModels(profile.id, nextModality).find(
                  (item) => item.id === initialRequest.modelId
                );
                return model
                  ? buildBenchmarkTarget(profile.id, profile.name, model)
                  : null;
              })
              .filter(isNonNullTarget)
          : profileId
          ? getProfileModels(profileId, nextModality)
              .slice(0, MAX_AUTO_CUSTOM_TARGETS)
              .map((model) => {
                const profile = nextProfiles.find(
                  (item) => item.id === profileId
                );
                return profile
                  ? buildBenchmarkTarget(profile.id, profile.name, model)
                  : null;
              })
              .filter(isNonNullTarget)
          : [];

      if (!targets.length) {
        return;
      }

      const session = modelBenchmarkService.createSession({
        modality: nextModality,
        compareMode: nextCompareMode,
        promptPresetId: defaultPreset.id,
        prompt: defaultPreset.prompt,
        rankingMode,
        targets,
        source: 'shortcut',
      });

      if (initialRequest.autoRun) {
        void modelBenchmarkService.runSession(session.id);
      }
    }, 120);

    return () => window.clearTimeout(schedule);
  }, [
    initialRequest,
    profiles,
    rankingMode,
    selectedProfileId,
    storeState.ready,
  ]);

  const handleApplyPreset = (presetId: string) => {
    const preset =
      BENCHMARK_PROMPT_PRESETS.find((item) => item.id === presetId) ||
      getDefaultPromptPreset(modality);
    setPromptPresetId(preset.id);
    setPrompt(preset.prompt);
  };

  const handleCreateAndRun = async () => {
    if (resolvedTargets.length === 0) {
      return;
    }
    const session = modelBenchmarkService.createSession({
      modality,
      compareMode,
      promptPresetId,
      prompt,
      rankingMode,
      targets: resolvedTargets,
      source: 'manual',
    });
    await modelBenchmarkService.runSession(session.id);
  };

  const handleToggleCustomTarget = (key: string) => {
    setSelectedCustomKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  };

  const handleToggleCrossModel = (modelId: string) => {
    setSelectedModelIds((current) =>
      current.includes(modelId)
        ? current.filter((item) => item !== modelId)
        : [...current, modelId]
    );
  };

  const handleRankingModeChange = (nextMode: BenchmarkRankingMode) => {
    setRankingMode(nextMode);
    if (activeSession) {
      modelBenchmarkService.setRankingMode(activeSession.id, nextMode);
    }
  };

  const renderEntryPreview = (entry: ModelBenchmarkEntry) => {
    if (entry.modality === 'text') {
      return (
        <pre className="model-benchmark__preview-text">
          {entry.preview.text || '暂无返回'}
        </pre>
      );
    }

    if (entry.modality === 'image' && entry.preview.url) {
      return (
        <img
          className="model-benchmark__preview-image"
          src={entry.preview.url}
          alt={entry.modelLabel}
          loading="lazy"
        />
      );
    }

    if (entry.modality === 'video' && entry.preview.url) {
      return (
        <video
          className="model-benchmark__preview-video"
          src={entry.preview.url}
          controls
          preload="metadata"
        />
      );
    }

    if (entry.modality === 'audio' && entry.preview.url) {
      return (
        <div className="model-benchmark__preview-audio-shell">
          <audio controls preload="none" src={entry.preview.url} />
          {entry.preview.text ? (
            <pre className="model-benchmark__preview-text">
              {entry.preview.text}
            </pre>
          ) : null}
        </div>
      );
    }

    return <div className="model-benchmark__preview-empty">暂无预览</div>;
  };

  return (
    <div className="model-benchmark">
      <aside className="model-benchmark__sidebar">
        <div className="model-benchmark__sidebar-head">
          <div>
            <div className="model-benchmark__eyebrow">模型选型工作台</div>
            <h2>批量测速与人工打分</h2>
          </div>
          <button
            type="button"
            className="model-benchmark__ghost-button"
            onClick={() =>
              activeSession && modelBenchmarkService.removeSession(activeSession.id)
            }
            disabled={!activeSession}
          >
            删除当前会话
          </button>
        </div>

        <div className="model-benchmark__section">
          <div className="model-benchmark__section-title">测试配置</div>
          <div className="model-benchmark__field-grid">
            <label className="model-benchmark__field">
              <span>模态</span>
              <select
                value={modality}
                onChange={(event) =>
                  setModality(event.target.value as BenchmarkModality)
                }
              >
                {Object.entries(MODALITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="model-benchmark__field">
              <span>模式</span>
              <select
                value={compareMode}
                onChange={(event) =>
                  setCompareMode(event.target.value as BenchmarkCompareMode)
                }
              >
                {Object.entries(MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {compareMode === 'cross-model' ? (
              <label className="model-benchmark__field model-benchmark__field--full">
                <span>供应商</span>
                <select
                  value={selectedProfileId}
                  onChange={(event) => setSelectedProfileId(event.target.value)}
                >
                  {profileOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {compareMode === 'cross-provider' ? (
              <label className="model-benchmark__field model-benchmark__field--full">
                <span>模型</span>
                <select
                  value={selectedModelId}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  {activeProfileModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.shortLabel || model.label || model.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="model-benchmark__field model-benchmark__field--full">
              <span>默认排序</span>
              <select
                value={rankingMode}
                onChange={(event) =>
                  handleRankingModeChange(
                    event.target.value as BenchmarkRankingMode
                  )
                }
              >
                {Object.entries(RANKING_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="model-benchmark__section">
          <div className="model-benchmark__section-title">提示词</div>
          <div className="model-benchmark__preset-list">
            {BENCHMARK_PROMPT_PRESETS.filter(
              (preset) => preset.modality === modality
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`model-benchmark__preset-chip ${
                  preset.id === promptPresetId
                    ? 'model-benchmark__preset-chip--active'
                    : ''
                }`}
                onClick={() => handleApplyPreset(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <textarea
            className="model-benchmark__prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
          />
        </div>

        {compareMode === 'cross-model' ? (
          <div className="model-benchmark__section">
            <div className="model-benchmark__section-title">模型选择</div>
            <div className="model-benchmark__picker-list">
              {activeProfileModels.map((model) => (
                <label key={model.id} className="model-benchmark__picker-item">
                  <input
                    type="checkbox"
                    checked={selectedModelIds.includes(model.id)}
                    onChange={() => handleToggleCrossModel(model.id)}
                  />
                  <span>{model.shortLabel || model.label || model.id}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {compareMode === 'custom' ? (
          <div className="model-benchmark__section">
            <div className="model-benchmark__section-title">自定义目标</div>
            <div className="model-benchmark__picker-list">
              {customTargets.map((target) => (
                <label
                  key={target.selectionKey}
                  className="model-benchmark__picker-item"
                >
                  <input
                    type="checkbox"
                    checked={selectedCustomKeys.includes(target.selectionKey)}
                    onChange={() =>
                      handleToggleCustomTarget(target.selectionKey)
                    }
                  />
                  <span>
                    {target.profileName} · {target.modelLabel}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="model-benchmark__section model-benchmark__section--flush-top">
          <div className="model-benchmark__target-meta">
            <span>待测 {resolvedTargets.length} 个目标</span>
            <span>默认并发 2</span>
          </div>
          <button
            type="button"
            className="model-benchmark__primary-button"
            onClick={handleCreateAndRun}
            disabled={!storeState.ready || resolvedTargets.length === 0 || !prompt.trim()}
          >
            开始批量测试
          </button>
        </div>

        <div className="model-benchmark__section model-benchmark__section--sessions">
          <div className="model-benchmark__section-title">历史会话</div>
          <div className="model-benchmark__session-list">
            {storeState.sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`model-benchmark__session-item ${
                  session.id === storeState.activeSessionId
                    ? 'model-benchmark__session-item--active'
                    : ''
                }`}
                onClick={() => modelBenchmarkService.setActiveSession(session.id)}
              >
                <span className="model-benchmark__session-title">
                  {session.title}
                </span>
                <span className="model-benchmark__session-meta">
                  {MODALITY_LABELS[session.modality]} · {session.entries.length} 项
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="model-benchmark__main">
        <div className="model-benchmark__main-head">
          <div>
            <div className="model-benchmark__eyebrow">
              {activeSession ? MODE_LABELS[activeSession.compareMode] : '结果面板'}
            </div>
            <h3>{activeSession ? activeSession.title : '还没有测试结果'}</h3>
          </div>
          {activeSession ? (
            <div className="model-benchmark__summary">
              <span>总计 {sessionSummary.total}</span>
              <span>成功 {sessionSummary.completed}</span>
              <span>失败 {sessionSummary.failed}</span>
              <span>{RANKING_LABELS[activeSession.rankingMode]}</span>
            </div>
          ) : null}
        </div>

        {activeSession ? (
          <div className="model-benchmark__result-list">
            {sortedEntries.map((entry) => (
              <article
                key={entry.id}
                className={`model-benchmark__result-card model-benchmark__result-card--${entry.status}`}
              >
                <header className="model-benchmark__result-head">
                  <div>
                    <div className="model-benchmark__result-title">
                      {entry.modelLabel}
                    </div>
                    <div className="model-benchmark__result-subtitle">
                      {entry.profileName}
                    </div>
                  </div>
                  <span
                    className={`model-benchmark__status model-benchmark__status--${entry.status}`}
                  >
                    {entry.status === 'completed'
                      ? '完成'
                      : entry.status === 'failed'
                      ? '失败'
                      : entry.status === 'running'
                      ? '测试中'
                      : '等待中'}
                  </span>
                </header>

                <div className="model-benchmark__result-metrics">
                  <span>首响 {formatDuration(entry.firstResponseMs)}</span>
                  <span>总耗时 {formatDuration(entry.totalDurationMs)}</span>
                  <span>
                    成本{' '}
                    {entry.estimatedCost === null
                      ? '未知'
                      : `¥${entry.estimatedCost.toFixed(4)}`}
                  </span>
                </div>

                <div className="model-benchmark__preview">
                  {renderEntryPreview(entry)}
                </div>

                {entry.errorSummary ? (
                  <div className="model-benchmark__error">{entry.errorSummary}</div>
                ) : null}

                <div className="model-benchmark__feedback">
                  <div className="model-benchmark__score-row">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <button
                        key={score}
                        type="button"
                        className={`model-benchmark__score-chip ${
                          entry.userScore === score
                            ? 'model-benchmark__score-chip--active'
                            : ''
                        }`}
                        onClick={() =>
                          modelBenchmarkService.setEntryFeedback(
                            activeSession.id,
                            entry.id,
                            {
                              userScore:
                                entry.userScore === score ? null : score,
                            }
                          )
                        }
                      >
                        {score}分
                      </button>
                    ))}
                  </div>
                  <div className="model-benchmark__action-row">
                    <button
                      type="button"
                      className={`model-benchmark__ghost-button ${
                        entry.favorite
                          ? 'model-benchmark__ghost-button--active'
                          : ''
                      }`}
                      onClick={() =>
                        modelBenchmarkService.setEntryFeedback(
                          activeSession.id,
                          entry.id,
                          {
                            favorite: !entry.favorite,
                          }
                        )
                      }
                    >
                      收藏
                    </button>
                    <button
                      type="button"
                      className={`model-benchmark__ghost-button ${
                        entry.rejected
                          ? 'model-benchmark__ghost-button--danger'
                          : ''
                      }`}
                      onClick={() =>
                        modelBenchmarkService.setEntryFeedback(
                          activeSession.id,
                          entry.id,
                          {
                            rejected: !entry.rejected,
                          }
                        )
                      }
                    >
                      淘汰
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="model-benchmark__empty">
            先在左侧选择测试模式和提示词，再开始第一轮批量测试。
          </div>
        )}
      </main>
    </div>
  );
}

export default ModelBenchmarkWorkbench;

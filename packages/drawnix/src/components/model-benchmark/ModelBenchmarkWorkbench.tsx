import React, { useEffect, useMemo, useRef, useState, startTransition } from 'react';
import type { Subscription } from 'rxjs';
import { Select, Input, MessagePlugin, Tooltip } from 'tdesign-react';
import {
  DeleteIcon,
  SearchIcon,
  ViewListIcon,
  ImageIcon,
  VideoIcon,
  TextboxIcon,
} from 'tdesign-icons-react';
import { Music4 } from 'lucide-react';
import { downloadFromBlob } from '@aitu/utils';
import { useAtomValue } from 'jotai';
import {
  buildBenchmarkTarget,
  getDefaultPromptPreset,
  modelBenchmarkService,
  rankBenchmarkEntries,
  computeValueScore,
  type BenchmarkCompareMode,
  type BenchmarkModality,
  type BenchmarkRankingMode,
  type ModelBenchmarkEntry,
  type ModelBenchmarkSession,
} from '../../services/model-benchmark-service';
import {
  applyShiftRangeSelection,
  reconcileSelection,
} from '../../services/model-benchmark-pure';
import { benchmarkLaunchAtom } from '../../services/model-benchmark-launcher';
import { runtimeModelDiscovery } from '../../utils/runtime-model-discovery';
import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  providerProfilesSettings,
  type ProviderProfile,
} from '../../utils/settings-manager';
import type { ModelConfig } from '../../constants/model-config';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import './model-benchmark-workbench.scss';

interface ModelBenchmarkWorkbenchProps {
  // props reserved for future use
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
  'cross-provider': '跨供应商对比',
  'cross-model': '多模型批测',
  custom: '自定义测试',
};

type SessionModalityFilter = 'all' | BenchmarkModality;

const MODE_DESCRIPTIONS: Record<BenchmarkCompareMode, string> = {
  'cross-provider': '锁定一个模型，横向比较不同供应商的稳定性、速度和效果差异。',
  'cross-model': '锁定一个供应商，一次跑完同类模型，快速筛掉慢和差的型号。',
  custom: '手动编排供应商与模型组合，适合做定向复测和候选名单对比。',
};

const RANKING_LABELS: Record<BenchmarkRankingMode, string> = {
  speed: '速度优先',
  cost: '成本优先',
  balanced: '综合平衡',
  'value-for-money': '性价比',
};

const SESSION_STATUS_LABELS: Record<string, string> = {
  draft: '待启动',
  running: '测试中',
  completed: '已完成',
  partial: '部分失败',
  failed: '全部失败',
};

const ENTRY_STATUS_LABELS: Record<string, string> = {
  pending: '待测',
  running: '测试中',
  completed: '已完成',
  failed: '失败',
};

const MAX_AUTO_CUSTOM_TARGETS = 6;
const QUEUE_PREVIEW_LIMIT = 8;
const MAX_EXCEL_CELL_LENGTH = 32000;

function formatDateTime(value: number | null): string {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
  });
}

function truncateExcelCell(value: string): string {
  return value.length > MAX_EXCEL_CELL_LENGTH
    ? `${value.slice(0, MAX_EXCEL_CELL_LENGTH - 8)}...[截断]`
    : value;
}

function normalizeExportText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  if (value.startsWith('data:')) {
    return '[内嵌数据已省略]';
  }

  return truncateExcelCell(value);
}

function normalizeExportList(values: string[] | null | undefined): string {
  if (!values?.length) {
    return '';
  }

  return truncateExcelCell(values.map((item) => normalizeExportText(item)).join('\n'));
}

function toBooleanLabel(value: boolean): string {
  return value ? '是' : '否';
}

function averageNullableNumbers(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let count = 0;

  values.forEach((value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  });

  return count > 0 ? Number((total / count).toFixed(2)) : null;
}

function buildExportFilename(now = new Date()): string {
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(
    now.getMinutes()
  ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `model-benchmark-history_${dateStr}_${timeStr}.xlsx`;
}

function isNonNullTarget<T>(value: T | null): value is T {
  return value !== null;
}

function normalizeQuery(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function matchesQuery(query: string, values: Array<string | null | undefined>): boolean {
  const tokens = normalizeQuery(query);
  if (tokens.length === 0) {
    return true;
  }

  const haystack = values
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return tokens.every((token) => haystack.includes(token));
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

function getSessionModelLabels(session: ModelBenchmarkSession): string[] {
  const entriesByModelId = new Map<
    string,
    {
      modelId: string;
      modelLabel: string;
    }
  >();

  session.entries.forEach((entry) => {
    const modelId = entry.modelId?.trim();
    const modelLabel = entry.modelLabel?.trim();
    if (modelId && modelLabel && !entriesByModelId.has(modelId)) {
      entriesByModelId.set(modelId, {
        modelId,
        modelLabel,
      });
    }
  });

  const labelCounts = new Map<string, number>();
  entriesByModelId.forEach(({ modelLabel }) => {
    labelCounts.set(modelLabel, (labelCounts.get(modelLabel) || 0) + 1);
  });

  return Array.from(entriesByModelId.values()).map(({ modelId, modelLabel }) =>
    (labelCounts.get(modelLabel) || 0) > 1 ? `${modelLabel} · ${modelId}` : modelLabel
  );
}

function getSessionSummary(session: ModelBenchmarkSession | null) {
  if (!session) {
    return {
      total: 0,
      completed: 0,
      failed: 0,
      running: 0,
    };
  }
  return session.entries.reduce(
    (summary, entry) => {
      summary.total += 1;
      if (entry.status === 'completed') summary.completed += 1;
      if (entry.status === 'failed') summary.failed += 1;
      if (entry.status === 'running') summary.running += 1;
      return summary;
    },
    { total: 0, completed: 0, failed: 0, running: 0 }
  );
}

function getProfileModels(
  profileId: string,
  modality: BenchmarkModality
): ModelConfig[] {
  const models = runtimeModelDiscovery
    .getState(profileId)
    .models.filter((model) => model.type === modality);
  const deduped = new Map<string, ModelConfig>();
  models.forEach((model) => {
    if (!deduped.has(model.id)) {
      deduped.set(model.id, model);
    }
  });
  return Array.from(deduped.values());
}

function getModelDisplayName(model: Pick<ModelConfig, 'id' | 'label' | 'shortLabel'>) {
  return model.shortLabel || model.label || model.id;
}

function getModelOptionLabel(model: Pick<ModelConfig, 'id' | 'label' | 'shortLabel'>) {
  const displayName = getModelDisplayName(model);
  return displayName === model.id
    ? displayName
    : `${displayName} · ${model.id}`;
}

function buildCustomSelectionKey(profileId: string, modelId: string): string {
  return `${profileId}::${modelId}`;
}

function ModelBenchmarkWorkbench({}: ModelBenchmarkWorkbenchProps) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const initialRequest = useAtomValue(benchmarkLaunchAtom);
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
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [selectedCustomKeys, setSelectedCustomKeys] = useState<string[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [promptPresetId, setPromptPresetId] = useState(
    getDefaultPromptPreset('text').id
  );
  const [prompt, setPrompt] = useState(getDefaultPromptPreset('text').prompt);
  const [concurrency, setConcurrency] = useState(2);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [rankingMode, setRankingMode] = useState<BenchmarkRankingMode>('speed');
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [sessionModalityFilter, setSessionModalityFilter] =
    useState<SessionModalityFilter>('all');
  const launchSignatureRef = useRef<string>('');
  const launchGuardRef = useRef(false);
  const pickerAnchorRef = useRef<string | null>(null);
  const pickerButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

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

  const profileMap = useMemo(
    () => new Map(availableProfiles.map((profile) => [profile.id, profile])),
    [availableProfiles]
  );

  const activeProfile = selectedProfileId
    ? profileMap.get(selectedProfileId) || null
    : null;

  const handleDeleteSession = React.useCallback(
    async (session: ModelBenchmarkSession) => {
      const confirmed = await confirm({
        title: '确认删除会话',
        description: `确定要删除会话「${session.title || '未命名会话'}」吗？此操作不可撤销。`,
        confirmText: '删除',
        cancelText: '取消',
        danger: true,
      });

      if (!confirmed) {
        return;
      }

      modelBenchmarkService.removeSession(session.id);
    },
    [confirm]
  );

  const activeProfileModels = useMemo(() => {
    void discoveryVersion;
    if (!selectedProfileId) {
      return [];
    }
    return getProfileModels(selectedProfileId, modality);
  }, [discoveryVersion, modality, selectedProfileId]);

  const crossProviderModels = useMemo(() => {
    void discoveryVersion;
    const deduped = new Map<string, ModelConfig>();
    availableProfiles.forEach((profile) => {
      getProfileModels(profile.id, modality).forEach((model) => {
        if (!deduped.has(model.id)) {
          deduped.set(model.id, model);
        }
      });
    });
    return Array.from(deduped.values());
  }, [availableProfiles, discoveryVersion, modality]);

  const customTargets = useMemo(() => {
    void discoveryVersion;
    return availableProfiles.flatMap((profile) =>
      getProfileModels(profile.id, modality).map((model) =>
        buildBenchmarkTarget(profile.id, profile.name, model)
      )
    );
  }, [availableProfiles, discoveryVersion, modality]);

  useEffect(() => {
    if (launchGuardRef.current) {
      console.debug('[Benchmark] reconcile profile/prompt: skipped (launchGuard)');
      return;
    }
    if (!availableProfiles.length) {
      setSelectedProfileId('');
      return;
    }

    const defaultPreset = getDefaultPromptPreset(modality);
    setPromptPresetId(defaultPreset.id);
    setPrompt((current) =>
      current === getDefaultPromptPreset('text').prompt ||
      current === getDefaultPromptPreset('image').prompt ||
      current === getDefaultPromptPreset('video').prompt ||
      current === getDefaultPromptPreset('audio').prompt
        ? defaultPreset.prompt
        : current
    );

    if (!selectedProfileId || !profileMap.has(selectedProfileId)) {
      setSelectedProfileId(availableProfiles[0].id);
    }
  }, [
    availableProfiles,
    modality,
    profileMap,
    selectedProfileId,
  ]);

  useEffect(() => {
    if (launchGuardRef.current) {
      console.debug('[Benchmark] reconcile modelIds: skipped (launchGuard)');
      return;
    }
    const modelIds = activeProfileModels.map((model) => model.id);
    if (modelIds.length === 0) {
      setSelectedModelIds([]);
      return;
    }

    setSelectedModelIds((current) => {
      const next = reconcileSelection(current, modelIds, { fallback: 'all' });
      if (next !== current) {
        console.debug('[Benchmark] reconcile modelIds: changed', { from: current, to: next });
      }
      return next;
    });
  }, [activeProfileModels]);

  useEffect(() => {
    if (launchGuardRef.current) {
      console.debug('[Benchmark] reconcile selectedModelId: skipped (launchGuard)');
      return;
    }
    const modelIds = crossProviderModels.map((model) => model.id);
    if (modelIds.length === 0) {
      setSelectedModelId('');
      return;
    }

    if (!modelIds.includes(selectedModelId)) {
      setSelectedModelId(modelIds[0]);
    }
  }, [crossProviderModels, selectedModelId]);

  const crossProviderCandidates = useMemo(() => {
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
      .filter(isNonNullTarget);
  }, [availableProfiles, modality, selectedModelId]);

  useEffect(() => {
    if (launchGuardRef.current) {
      console.debug('[Benchmark] reconcile providerIds: skipped (launchGuard)');
      return;
    }
    setSelectedProviderIds((current) =>
      reconcileSelection(
        current,
        crossProviderCandidates.map((target) => target.profileId),
        { fallback: 'all' }
      )
    );
  }, [crossProviderCandidates]);

  useEffect(() => {
    if (launchGuardRef.current) {
      console.debug('[Benchmark] reconcile customKeys: skipped (launchGuard)');
      return;
    }
    setSelectedCustomKeys((current) =>
      reconcileSelection(
        current,
        customTargets.map((target) => target.selectionKey),
        {
          fallback: 'first',
          limit: MAX_AUTO_CUSTOM_TARGETS,
        }
      )
    );
  }, [customTargets]);

  const activeSession = useMemo(() => {
    return (
      storeState.sessions.find(
        (session) => session.id === storeState.activeSessionId
      ) || null
    );
  }, [storeState.activeSessionId, storeState.sessions]);

  const filteredSessions = useMemo(() => {
    return storeState.sessions.filter((session) => {
      if (
        sessionModalityFilter !== 'all' &&
        session.modality !== sessionModalityFilter
      ) {
        return false;
      }

      return matchesQuery(sessionSearchQuery, [
        session.title,
        session.prompt,
        MODE_LABELS[session.compareMode],
        MODALITY_LABELS[session.modality],
        ...session.entries.flatMap((entry) => [
          entry.profileName,
          entry.profileId,
          entry.modelLabel,
          entry.modelId,
          entry.vendor,
        ]),
      ]);
    });
  }, [sessionModalityFilter, sessionSearchQuery, storeState.sessions]);

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
      return crossProviderCandidates.filter((target) =>
        selectedProviderIds.includes(target.profileId)
      );
    }

    if (compareMode === 'cross-model') {
      if (!selectedProfileId) {
        return [];
      }
      const profile = profileMap.get(selectedProfileId);
      if (!profile) {
        return [];
      }
      return activeProfileModels
        .filter((model) => selectedModelIds.includes(model.id))
        .map((model) => buildBenchmarkTarget(profile.id, profile.name, model));
    }

    return customTargets.filter((target) =>
      selectedCustomKeys.includes(target.selectionKey)
    );
  }, [
    activeProfileModels,
    compareMode,
    crossProviderCandidates,
    customTargets,
    profileMap,
    selectedCustomKeys,
    selectedModelIds,
    selectedProfileId,
    selectedProviderIds,
  ]);

  const isQueuePreviewBoundToActiveSession = useMemo(() => {
    if (!activeSession) {
      return false;
    }
    if (
      activeSession.modality !== modality ||
      activeSession.compareMode !== compareMode
    ) {
      return false;
    }

    const resolvedKeys = resolvedTargets.map((target) => target.selectionKey);
    if (resolvedKeys.length === 0) {
      return false;
    }
    if (activeSession.entries.length !== resolvedKeys.length) {
      return false;
    }

    const resolvedKeySet = new Set(resolvedKeys);
    return activeSession.entries.every((entry) =>
      resolvedKeySet.has(entry.selectionKey)
    );
  }, [activeSession, compareMode, modality, resolvedTargets]);

  const queuePreviewEntries = useMemo(() => {
    if (activeSession && isQueuePreviewBoundToActiveSession) {
      return activeSession.entries.map((entry) => ({
        key: entry.selectionKey,
        modelLabel: entry.modelLabel,
        profileName: entry.profileName,
        badgeLabel: ENTRY_STATUS_LABELS[entry.status] || ENTRY_STATUS_LABELS.pending,
      }));
    }

    return resolvedTargets.map((target) => ({
      key: target.selectionKey,
      modelLabel: target.modelLabel,
      profileName: target.profileName,
      badgeLabel: ENTRY_STATUS_LABELS.pending,
    }));
  }, [activeSession, isQueuePreviewBoundToActiveSession, resolvedTargets]);
  const displayedSession = activeSession;
  const displayedSessionSummary = displayedSession ? sessionSummary : getSessionSummary(null);
  const displayedSortedEntries = displayedSession ? sortedEntries : [];
  const queuePreviewTotal = queuePreviewEntries.length;
  const queuePreviewTargets = queuePreviewEntries.slice(0, QUEUE_PREVIEW_LIMIT);
  const topEntry =
    displayedSortedEntries.find((entry) => entry.status === 'completed') || null;
  const filteredCrossModelModels = useMemo(
    () =>
      activeProfileModels.filter((model) => {
        const active = selectedModelIds.includes(model.id);
        if (showSelectedOnly && !active) {
          return false;
        }
        return matchesQuery(pickerQuery, [
          getModelDisplayName(model),
          model.id,
          activeProfile?.name,
        ]);
      }),
    [activeProfile?.name, activeProfileModels, pickerQuery, selectedModelIds, showSelectedOnly]
  );
  const filteredCrossProviderCandidates = useMemo(
    () =>
      crossProviderCandidates.filter((target) => {
        const active = selectedProviderIds.includes(target.profileId);
        if (showSelectedOnly && !active) {
          return false;
        }
        return matchesQuery(pickerQuery, [
          target.profileName,
          target.modelLabel,
          target.modelId,
          target.profileId,
        ]);
      }),
    [crossProviderCandidates, pickerQuery, selectedProviderIds, showSelectedOnly]
  );
  const filteredCustomTargets = useMemo(
    () =>
      customTargets.filter((target) => {
        const active = selectedCustomKeys.includes(target.selectionKey);
        if (showSelectedOnly && !active) {
          return false;
        }
        return matchesQuery(pickerQuery, [
          target.profileName,
          target.modelLabel,
          target.modelId,
          target.profileId,
        ]);
      }),
    [customTargets, pickerQuery, selectedCustomKeys, showSelectedOnly]
  );
  const visiblePickerKeys = useMemo(() => {
    if (compareMode === 'cross-model') {
      return filteredCrossModelModels.map((model) => model.id);
    }
    if (compareMode === 'cross-provider') {
      return filteredCrossProviderCandidates.map((target) => target.profileId);
    }
    return filteredCustomTargets.map((target) => target.selectionKey);
  }, [
    compareMode,
    filteredCrossModelModels,
    filteredCrossProviderCandidates,
    filteredCustomTargets,
  ]);

  useEffect(() => {
    if (visiblePickerKeys.length === 0) {
      pickerAnchorRef.current = null;
      return;
    }
    if (
      pickerAnchorRef.current &&
      visiblePickerKeys.includes(pickerAnchorRef.current)
    ) {
      return;
    }
    pickerAnchorRef.current = visiblePickerKeys[0];
  }, [visiblePickerKeys]);

  useEffect(() => {
    if (!initialRequest) {
      console.debug('[Benchmark] useEffect: no initialRequest, skip');
      return;
    }
    if (!storeState.ready) {
      console.debug('[Benchmark] useEffect: storeState not ready, waiting...');
      return;
    }
    const signature = JSON.stringify(initialRequest);
    if (launchSignatureRef.current === signature) {
      console.debug('[Benchmark] useEffect: same signature, skip', { signature });
      return;
    }

    const nextModality = initialRequest.modality || 'text';
    const nextProfiles = getAvailableProfilesForModality(profiles, nextModality);
    const requestedProfileId = initialRequest.profileId || '';
    const requestedModelId = initialRequest.modelId || '';
    const requestedProfileState = requestedProfileId
      ? runtimeModelDiscovery.getState(requestedProfileId)
      : null;
    const requestedProfileModels =
      requestedProfileId && requestedModelId
        ? getProfileModels(requestedProfileId, nextModality)
        : [];
    const requestedModelReady =
      !requestedModelId ||
      requestedProfileModels.some((item) => item.id === requestedModelId);

    if (
      requestedProfileState &&
      requestedModelId &&
      !requestedModelReady &&
      (requestedProfileState.status === 'idle' ||
        requestedProfileState.status === 'loading')
    ) {
      console.debug('[Benchmark] useEffect: waiting for requested model discovery', {
        signature,
        requestedProfileId,
        requestedModelId,
        status: requestedProfileState.status,
        discoveryVersion,
      });
      return;
    }

    // 等目标模型可见后再设置 guard，避免过早消费 initialRequest。
    launchGuardRef.current = true;
    launchSignatureRef.current = signature;

    // 计算该模型在多少个供应商下存在
    const requestedCompareMode =
      initialRequest.compareMode ||
      (initialRequest.modelId ? 'cross-provider' : 'cross-model');
    let nextCompareMode = requestedCompareMode;
    let matchingProviderIds: string[] = [];
    const requestedCustomKey =
      initialRequest.profileId && initialRequest.modelId
        ? buildCustomSelectionKey(initialRequest.profileId, initialRequest.modelId)
        : '';
    if (
      requestedCompareMode === 'cross-provider' &&
      initialRequest.modelId
    ) {
      matchingProviderIds = nextProfiles
        .filter((profile) =>
          getProfileModels(profile.id, nextModality).some(
            (item) => item.id === initialRequest.modelId
          )
        )
        .map((profile) => profile.id);
      // 仅 1 个供应商有该模型时，降级为 custom，保留当前供应商 + 当前模型
      if (matchingProviderIds.length <= 1) {
        nextCompareMode = 'custom';
        console.debug('[Benchmark] cross-provider → custom downgrade', {
          modelId: initialRequest.modelId,
          matchingProviderIds,
        });
      }
    }

    console.debug('[Benchmark] useEffect: applying initialRequest', {
      nextModality,
      nextCompareMode,
      requestedCompareMode,
      profileId: initialRequest.profileId,
      modelId: initialRequest.modelId,
      profileCount: nextProfiles.length,
      matchingProviderIds,
    });

    const defaultPreset = getDefaultPromptPreset(nextModality);
    setModality(nextModality);
    setCompareMode(nextCompareMode);
    setPromptPresetId(defaultPreset.id);
    setPrompt(defaultPreset.prompt);

    const effectiveProfileId =
      initialRequest.profileId || matchingProviderIds[0] || nextProfiles[0]?.id || '';
    if (effectiveProfileId) {
      setSelectedProfileId(effectiveProfileId);
    }

    if (nextCompareMode === 'cross-provider' && initialRequest.modelId) {
      // 直接设置选中的模型和供应商，避免被 reconcile useEffect 覆盖
      setSelectedModelId(initialRequest.modelId);
      setSelectedProviderIds(matchingProviderIds);
    } else if (nextCompareMode === 'cross-model' && initialRequest.modelId) {
      // cross-model：只选目标模型，不全选
      setSelectedModelIds([initialRequest.modelId]);
    } else if (nextCompareMode === 'cross-model' && !initialRequest.modelId && effectiveProfileId) {
      // cross-model 无 modelId（测试本组）：全选该 profile 下的所有模型
      const allModels = getProfileModels(effectiveProfileId, nextModality);
      setSelectedModelIds(allModels.map((m) => m.id));
    } else if (nextCompareMode === 'custom' && requestedCustomKey) {
      setSelectedCustomKeys([requestedCustomKey]);
    }

    const schedule = window.setTimeout(() => {
      let targets: ReturnType<typeof buildBenchmarkTarget>[];

      if (nextCompareMode === 'cross-provider' && initialRequest.modelId) {
        targets = nextProfiles
          .map((profile) => {
            const model = getProfileModels(profile.id, nextModality).find(
              (item) => item.id === initialRequest.modelId
            );
            return model
              ? buildBenchmarkTarget(profile.id, profile.name, model)
              : null;
          })
          .filter(isNonNullTarget);
      } else if (nextCompareMode === 'cross-model' && initialRequest.modelId) {
        // cross-model：只选目标模型
        const profile = nextProfiles.find(
          (item) => item.id === effectiveProfileId
        );
        if (profile) {
          const model = getProfileModels(profile.id, nextModality).find(
            (item) => item.id === initialRequest.modelId
          );
          targets = model
            ? [buildBenchmarkTarget(profile.id, profile.name, model)]
            : [];
        } else {
          targets = [];
        }
      } else if (nextCompareMode === 'custom') {
        const profile = nextProfiles.find(
          (item) => item.id === (initialRequest.profileId || effectiveProfileId)
        );
        if (profile && initialRequest.modelId) {
          const model = getProfileModels(profile.id, nextModality).find(
            (item) => item.id === initialRequest.modelId
          );
          targets = model
            ? [buildBenchmarkTarget(profile.id, profile.name, model)]
            : [];
        } else {
          targets = [];
        }
      } else {
        const profileId =
          effectiveProfileId || selectedProfileId;
        if (profileId) {
          targets = getProfileModels(profileId, nextModality)
            .map((model) => {
              const profile = nextProfiles.find(
                (item) => item.id === profileId
              );
              return profile
                ? buildBenchmarkTarget(profile.id, profile.name, model)
                : null;
            })
            .filter(isNonNullTarget);
        } else {
          targets = [];
        }
      }

      if (!targets.length) {
        console.debug('[Benchmark] setTimeout: no targets built, abort');
        return;
      }

      console.debug('[Benchmark] setTimeout: creating session', {
        targetCount: targets.length,
        targets: targets.map(t => `${t.profileName}/${t.modelId}`),
        autoRun: initialRequest.autoRun,
      });

      if (!initialRequest.autoRun) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            launchGuardRef.current = false;
            console.debug('[Benchmark] guard released without autoRun');
          }, 0);
        });
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

      void modelBenchmarkService.runSession(session.id);
      // 延迟释放 guard：createSession 会更新 storeState → 触发重新渲染 →
      // reconcile effects 需要在 guard 保护下跳过，否则会覆盖 initialRequest 设置的状态。
      // 用 rAF + setTimeout 确保 React 完成所有同步渲染和 effects 后再释放。
      requestAnimationFrame(() => {
        setTimeout(() => {
          launchGuardRef.current = false;
          console.debug('[Benchmark] guard released');
        }, 0);
      });
    }, 120);

    return () => {
      window.clearTimeout(schedule);
    };
  }, [
    discoveryVersion,
    initialRequest,
    profiles,
    rankingMode,
    selectedProfileId,
    storeState.ready,
  ]);

  const handleCreateAndRun = async () => {
    if (resolvedTargets.length === 0 || !prompt.trim()) {
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
    await modelBenchmarkService.runSession(session.id, concurrency);
  };

  const handleExportExcel = async () => {
    if (isExportingExcel) {
      return;
    }

    const sessions = storeState.sessions;
    if (sessions.length === 0) {
      MessagePlugin.warning('暂无历史会话可导出');
      return;
    }

    setIsExportingExcel(true);
    try {
      const XLSX = await import('xlsx');
      const detailRows = sessions.flatMap((session) =>
        session.entries.map((entry) => ({
          会话标题: session.title,
          会话ID: session.id,
          会话创建时间: formatDateTime(session.createdAt),
          模态: MODALITY_LABELS[session.modality],
          对比方式: MODE_LABELS[session.compareMode],
          会话状态: SESSION_STATUS_LABELS[session.status],
          提示词预设: session.promptPresetId,
          提示词: normalizeExportText(session.prompt),
          供应商配置: entry.profileName,
          供应商ID: entry.profileId,
          模型名称: entry.modelLabel,
          模型ID: entry.modelId,
          厂商: entry.vendor,
          选择Key: entry.selectionKey,
          结果ID: entry.id,
          结果状态: ENTRY_STATUS_LABELS[entry.status],
          开始时间: formatDateTime(entry.startedAt),
          首响时间: formatDateTime(entry.firstResponseAt),
          完成时间: formatDateTime(entry.completedAt),
          首响ms: entry.firstResponseMs,
          总耗时ms: entry.totalDurationMs,
          预估成本: entry.estimatedCost,
          用户评分: entry.userScore,
          已收藏: toBooleanLabel(entry.favorite),
          已淘汰: toBooleanLabel(entry.rejected),
          错误摘要: normalizeExportText(entry.errorSummary),
          预览文本: normalizeExportText(entry.preview.text),
          预览链接: normalizeExportText(entry.preview.url),
          预览链接列表: normalizeExportList(entry.preview.urls),
          预览格式: entry.preview.format || '',
          预览时长: entry.preview.duration ?? '',
          预览标题: normalizeExportText(entry.preview.title),
        }))
      );

      const modelSummaryMap = new Map<
        string,
        {
          profileName: string;
          profileId: string;
          modelLabel: string;
          modelId: string;
          vendor: string;
          modality: string;
          selectionKey: string;
          sessionIds: Set<string>;
          count: number;
          completedCount: number;
          failedCount: number;
          runningCount: number;
          pendingCount: number;
          favoriteCount: number;
          rejectedCount: number;
          firstResponseValues: number[];
          totalDurationValues: number[];
          costValues: number[];
          scoreValues: number[];
          latestAt: number;
        }
      >();

      sessions.forEach((session) => {
        session.entries.forEach((entry) => {
          const groupKey = `${session.modality}::${entry.selectionKey}`;
          const current = modelSummaryMap.get(groupKey) || {
            profileName: entry.profileName,
            profileId: entry.profileId,
            modelLabel: entry.modelLabel,
            modelId: entry.modelId,
            vendor: entry.vendor,
            modality: MODALITY_LABELS[session.modality],
            selectionKey: entry.selectionKey,
            sessionIds: new Set<string>(),
            count: 0,
            completedCount: 0,
            failedCount: 0,
            runningCount: 0,
            pendingCount: 0,
            favoriteCount: 0,
            rejectedCount: 0,
            firstResponseValues: [],
            totalDurationValues: [],
            costValues: [],
            scoreValues: [],
            latestAt: 0,
          };

          current.sessionIds.add(session.id);
          current.count += 1;
          if (entry.status === 'completed') current.completedCount += 1;
          if (entry.status === 'failed') current.failedCount += 1;
          if (entry.status === 'running') current.runningCount += 1;
          if (entry.status === 'pending') current.pendingCount += 1;
          if (entry.favorite) current.favoriteCount += 1;
          if (entry.rejected) current.rejectedCount += 1;
          if (typeof entry.firstResponseMs === 'number') {
            current.firstResponseValues.push(entry.firstResponseMs);
          }
          if (typeof entry.totalDurationMs === 'number') {
            current.totalDurationValues.push(entry.totalDurationMs);
          }
          if (typeof entry.estimatedCost === 'number') {
            current.costValues.push(entry.estimatedCost);
          }
          if (typeof entry.userScore === 'number') {
            current.scoreValues.push(entry.userScore);
          }

          current.latestAt = Math.max(
            current.latestAt,
            entry.completedAt || entry.startedAt || session.updatedAt || session.createdAt
          );
          modelSummaryMap.set(groupKey, current);
        });
      });

      const modelSummaryRows = Array.from(modelSummaryMap.values())
        .map((item) => ({
          供应商配置: item.profileName,
          供应商ID: item.profileId,
          模型名称: item.modelLabel,
          模型ID: item.modelId,
          厂商: item.vendor,
          模态: item.modality,
          选择Key: item.selectionKey,
          测试次数: item.count,
          涉及会话数: item.sessionIds.size,
          完成次数: item.completedCount,
          失败次数: item.failedCount,
          运行中次数: item.runningCount,
          待测次数: item.pendingCount,
          收藏次数: item.favoriteCount,
          淘汰次数: item.rejectedCount,
          平均首响ms: averageNullableNumbers(item.firstResponseValues),
          最快首响ms:
            item.firstResponseValues.length > 0
              ? Math.min(...item.firstResponseValues)
              : null,
          平均总耗时ms: averageNullableNumbers(item.totalDurationValues),
          最快总耗时ms:
            item.totalDurationValues.length > 0
              ? Math.min(...item.totalDurationValues)
              : null,
          平均成本: averageNullableNumbers(item.costValues),
          平均评分: averageNullableNumbers(item.scoreValues),
          最近测试时间: formatDateTime(item.latestAt),
        }))
        .sort((left, right) => {
          const scoreDelta = (right['平均评分'] ?? -1) - (left['平均评分'] ?? -1);
          if (scoreDelta !== 0) return scoreDelta;
          const speedDelta = (left['平均首响ms'] ?? Number.MAX_SAFE_INTEGER) -
            (right['平均首响ms'] ?? Number.MAX_SAFE_INTEGER);
          if (speedDelta !== 0) return speedDelta;
          return (left['平均成本'] ?? Number.MAX_SAFE_INTEGER) -
            (right['平均成本'] ?? Number.MAX_SAFE_INTEGER);
        });

      const workbook = XLSX.utils.book_new();
      const summarySheet = XLSX.utils.json_to_sheet(modelSummaryRows);
      const detailSheet = XLSX.utils.json_to_sheet(detailRows);

      summarySheet['!cols'] = [
        { wch: 18 },
        { wch: 22 },
        { wch: 24 },
        { wch: 32 },
        { wch: 14 },
        { wch: 10 },
        { wch: 32 },
        { wch: 8 },
        { wch: 10 },
        { wch: 8 },
        { wch: 8 },
        { wch: 10 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 18 },
        { wch: 18 },
        { wch: 12 },
        { wch: 18 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 20 },
      ];

      detailSheet['!cols'] = [
        { wch: 28 },
        { wch: 24 },
        { wch: 20 },
        { wch: 10 },
        { wch: 14 },
        { wch: 10 },
        { wch: 18 },
        { wch: 60 },
        { wch: 18 },
        { wch: 22 },
        { wch: 24 },
        { wch: 32 },
        { wch: 14 },
        { wch: 32 },
        { wch: 24 },
        { wch: 10 },
        { wch: 20 },
        { wch: 20 },
        { wch: 20 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 10 },
        { wch: 8 },
        { wch: 8 },
        { wch: 36 },
        { wch: 60 },
        { wch: 60 },
        { wch: 80 },
        { wch: 12 },
        { wch: 10 },
        { wch: 28 },
      ];

      XLSX.utils.book_append_sheet(workbook, summarySheet, '模型汇总');
      XLSX.utils.book_append_sheet(workbook, detailSheet, '原始结果');

      const buffer = XLSX.write(workbook, {
        bookType: 'xlsx',
        type: 'array',
      });
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      downloadFromBlob(blob, buildExportFilename());
      MessagePlugin.success(`已导出 ${modelSummaryRows.length} 个模型结果`);
    } catch (error) {
      console.error('[ModelBenchmark] Excel export failed:', error);
      MessagePlugin.error('导出 Excel 失败，请稍后重试');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleRangeAwareToggle = (
    targetKey: string,
    currentSelection: string[],
    setSelection: React.Dispatch<React.SetStateAction<string[]>>,
    visibleKeys: string[],
    useShiftKey: boolean
  ) => {
    const shouldSelect = !currentSelection.includes(targetKey);
    setSelection((current) =>
      useShiftKey
        ? applyShiftRangeSelection(
            current,
            visibleKeys,
            pickerAnchorRef.current,
            targetKey,
            shouldSelect
          )
        : shouldSelect
        ? Array.from(new Set([...current, targetKey]))
        : current.filter((item) => item !== targetKey)
    );
    pickerAnchorRef.current = targetKey;
  };

  const focusPickerKey = (targetKey: string) => {
    window.requestAnimationFrame(() => {
      pickerButtonRefs.current[targetKey]?.focus();
    });
  };

  const handlePickerKeyboardShortcut = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    targetKey: string,
    currentSelection: string[],
    setSelection: React.Dispatch<React.SetStateAction<string[]>>,
    visibleKeys: string[]
  ) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelection(visibleKeys);
      pickerAnchorRef.current = visibleKeys[0] || targetKey;
      return;
    }

    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight'
    ) {
      return;
    }

    event.preventDefault();
    const currentIndex = visibleKeys.indexOf(targetKey);
    if (currentIndex === -1) {
      return;
    }
    const delta =
      event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = Math.min(
      visibleKeys.length - 1,
      Math.max(0, currentIndex + delta)
    );
    const nextKey = visibleKeys[nextIndex];
    if (!nextKey || nextKey === targetKey) {
      return;
    }

    if (event.shiftKey) {
      const nextSelected = !currentSelection.includes(nextKey);
      setSelection((current) =>
        applyShiftRangeSelection(
          current,
          visibleKeys,
          pickerAnchorRef.current || targetKey,
          nextKey,
          nextSelected
        )
      );
    } else {
      pickerAnchorRef.current = nextKey;
    }

    focusPickerKey(nextKey);
  };

  const handleToggleCrossModel = (modelId: string, useShiftKey = false) => {
    handleRangeAwareToggle(
      modelId,
      selectedModelIds,
      setSelectedModelIds,
      filteredCrossModelModels.map((model) => model.id),
      useShiftKey
    );
  };

  const handleToggleProvider = (profileId: string, useShiftKey = false) => {
    handleRangeAwareToggle(
      profileId,
      selectedProviderIds,
      setSelectedProviderIds,
      filteredCrossProviderCandidates.map((target) => target.profileId),
      useShiftKey
    );
  };

  const handleToggleCustomTargetWithRange = (
    selectionKey: string,
    useShiftKey = false
  ) => {
    handleRangeAwareToggle(
      selectionKey,
      selectedCustomKeys,
      setSelectedCustomKeys,
      filteredCustomTargets.map((target) => target.selectionKey),
      useShiftKey
    );
  };

  const renderEntryPreview = (entry: ModelBenchmarkEntry) => {
    const rawDataBlock = entry.preview.rawData ? (
      <details className="model-benchmark__raw-data">
        <summary>原始数据 (JSON)</summary>
        <pre>{JSON.stringify(entry.preview.rawData, null, 2)}</pre>
      </details>
    ) : null;

    if (entry.modality === 'text') {
      return (
        <div className="model-benchmark__preview-content">
          <pre className="model-benchmark__preview-text">
            {entry.preview.text || '暂无返回'}
          </pre>
          {rawDataBlock}
        </div>
      );
    }

    if (entry.modality === 'image' && entry.preview.url) {
      return (
        <div className="model-benchmark__preview-content">
          <img
            className="model-benchmark__preview-image"
            src={entry.preview.url}
            alt={entry.modelLabel}
            loading="lazy"
          />
          {rawDataBlock}
        </div>
      );
    }

    if (entry.modality === 'video' && entry.preview.url) {
      return (
        <div className="model-benchmark__preview-content">
          <video
            className="model-benchmark__preview-video"
            src={entry.preview.url}
            controls
            preload="metadata"
          />
          {rawDataBlock}
        </div>
      );
    }

    if (entry.modality === 'audio' && entry.preview.url) {
      return (
        <div className="model-benchmark__preview-content">
          <div className="model-benchmark__preview-audio-shell">
            <audio controls preload="none" src={entry.preview.url} />
            {entry.preview.text ? (
              <pre className="model-benchmark__preview-text">
                {entry.preview.text}
              </pre>
            ) : null}
          </div>
          {rawDataBlock}
        </div>
      );
    }

    return (
      <div className="model-benchmark__preview-empty">
        {entry.status === 'failed' ? '加载失败' : '暂无预览'}
        {rawDataBlock}
      </div>
    );
  };

  const pickerTitle =
    compareMode === 'cross-model'
      ? '选择参测模型'
      : compareMode === 'cross-provider'
      ? '选择参与对比的供应商'
      : '选择目标组合';
  const composerLockedLabel =
    compareMode === 'cross-model'
      ? `已锁定供应商：${activeProfile?.name || '未选择'}`
      : compareMode === 'cross-provider'
      ? `已锁定模型：${selectedModelId || '未选择'}（来自全供应商去重列表）`
      : '手动编排供应商与模型组合';
  const composerNextStep =
    compareMode === 'cross-model'
      ? '下一步：勾选要纳入本轮测试的模型'
      : compareMode === 'cross-provider'
      ? '下一步：从下拉框中多选要参与横向对比的供应商'
      : '下一步：按需筛选并勾选目标组合';
  const crossProviderModelOptions = crossProviderModels.map((model) => ({
    label: getModelOptionLabel(model),
    value: model.id,
  }));
  const crossProviderOptions = crossProviderCandidates.map((target) => ({
    label: `${target.profileName} · ${target.modelLabel}`,
    value: target.profileId,
  }));
  const sessionModalityTabs: Array<{
    label: string;
    value: SessionModalityFilter;
    icon: React.ReactNode;
  }> = [
    { label: '全部', value: 'all', icon: <ViewListIcon size={14} /> },
    { label: '图片', value: 'image', icon: <ImageIcon size="14px" /> },
    { label: '视频', value: 'video', icon: <VideoIcon size="14px" /> },
    { label: '音频', value: 'audio', icon: <Music4 size={14} strokeWidth={1.9} /> },
    { label: '文本', value: 'text', icon: <TextboxIcon size="14px" /> },
  ];

  return (
    <div className="model-benchmark">
      <aside className="model-benchmark__sidebar">
        <div className="model-benchmark__sidebar-head">
          <div className="model-benchmark__panel-title">历史会话</div>
          <button
            type="button"
            className="model-benchmark__ghost-button"
            onClick={handleExportExcel}
            disabled={storeState.sessions.length === 0 || isExportingExcel}
          >
            {isExportingExcel ? '导出中...' : '导出 Excel'}
          </button>
        </div>
        <div className="model-benchmark__sidebar-filters">
          <Input
            value={sessionSearchQuery}
            onChange={setSessionSearchQuery}
            placeholder="搜索会话 / 模型 / 供应商"
            prefixIcon={<SearchIcon />}
            size="small"
            clearable
          />
          <div className="model-benchmark__sidebar-tabs">
            {sessionModalityTabs.map((tab) => (
              <Tooltip key={tab.value} content={tab.label} theme="light">
                <button
                  type="button"
                  className={
                    sessionModalityFilter === tab.value
                      ? 'model-benchmark__sidebar-tab model-benchmark__sidebar-tab--active'
                      : 'model-benchmark__sidebar-tab'
                  }
                  onClick={() => setSessionModalityFilter(tab.value)}
                  aria-label={tab.label}
                  title={tab.label}
                >
                  {tab.icon}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
        <div className="model-benchmark__session-list">
          {filteredSessions.length > 0 ? (
            filteredSessions.map((session) => {
              const modelLabels = getSessionModelLabels(session);
              return (
                <div key={session.id} className="model-benchmark__session-row">
                  <button
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
                    <span className="model-benchmark__session-models">
                      {modelLabels.length > 0
                        ? modelLabels.join(' / ')
                        : '暂无模型信息'}
                    </span>
                    <span className="model-benchmark__session-meta">
                      {MODE_LABELS[session.compareMode]} · {session.entries.length} 个目标 ·{' '}
                      {SESSION_STATUS_LABELS[session.status]}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="model-benchmark__session-delete"
                    onClick={() => void handleDeleteSession(session)}
                    aria-label={`删除会话 ${session.title}`}
                    title="删除会话"
                  >
                    <DeleteIcon />
                  </button>
                </div>
              );
            })
          ) : (
            <div className="model-benchmark__session-empty">
              {storeState.sessions.length === 0 ? '暂无历史会话' : '没有匹配的历史会话'}
            </div>
          )}
        </div>
      </aside>

      <main className="model-benchmark__main">
        <div className="model-benchmark__main-shell">
          <section className="model-benchmark__config-dashboard">
            <div className="model-benchmark__config-row model-benchmark__config-row--top">
              <div className="model-benchmark__modality-tabs">
                {(Object.keys(MODALITY_LABELS) as BenchmarkModality[]).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      className={modality === value ? 'active' : ''}
                      onClick={() => setModality(value)}
                    >
                      {MODALITY_LABELS[value]}
                    </button>
                  )
                )}
              </div>

              <div className="model-benchmark__mode-selector">
                {(Object.entries(MODE_LABELS) as [string, string][]).map(
                  ([value, label]) => (
                    <Tooltip
                      key={value}
                      content={MODE_DESCRIPTIONS[value as BenchmarkCompareMode]}
                      placement="top"
                    >
                      <button
                        type="button"
                        className={compareMode === value ? 'active' : ''}
                        onClick={() =>
                          setCompareMode(value as BenchmarkCompareMode)
                        }
                      >
                        {label}
                      </button>
                    </Tooltip>
                  )
                )}
              </div>
            </div>

            <div className="model-benchmark__config-main">
              <div className="model-benchmark__config-controls">
                <div className="model-benchmark__primary-select-row">
                  {compareMode === 'cross-model' ? (
                    <Select
                      className="model-benchmark__select"
                      label="目标供应商: "
                      value={selectedProfileId}
                      onChange={(value) => setSelectedProfileId(value as string)}
                      options={availableProfiles.map((p) => ({
                        label: p.name,
                        value: p.id,
                      }))}
                    />
                  ) : null}

                  {compareMode === 'cross-provider' ? (
                    <Select
                      filterable
                      className="model-benchmark__select"
                      label="对比模型: "
                      value={selectedModelId}
                      options={crossProviderModelOptions}
                      placeholder="搜索并选择要横向对比的模型"
                      onChange={(value) =>
                        setSelectedModelId((value as string) || '')
                      }
                    />
                  ) : null}
                </div>

                <div className="model-benchmark__secondary-select-row">
                  {compareMode === 'cross-provider' ? (
                    <Select
                      multiple
                      filterable
                      minCollapsedNum={3}
                      popupProps={{
                        overlayClassName: 'model-benchmark__select-popup',
                      }}
                      panelTopContent={
                        <div className="model-benchmark__select-actions">
                          <button type="button" onClick={() => setSelectedProviderIds(crossProviderOptions.map((o) => o.value as string))}>全选</button>
                          <button type="button" onClick={() => setSelectedProviderIds([])}>清除</button>
                        </div>
                      }
                      className="model-benchmark__multi-select"
                      label="参测供应商: "
                      value={selectedProviderIds}
                      options={crossProviderOptions}
                      placeholder="多选要参与对比的供应商 (已选即为批测队列)"
                      onChange={(value) =>
                        setSelectedProviderIds(
                          Array.isArray(value) ? (value as string[]) : []
                        )
                      }
                    />
                  ) : null}

                  {compareMode === 'cross-model' ? (
                    <Select
                      multiple
                      filterable
                      minCollapsedNum={3}
                      popupProps={{
                        overlayClassName: 'model-benchmark__select-popup',
                      }}
                      panelTopContent={
                        <div className="model-benchmark__select-actions">
                          <button type="button" onClick={() => setSelectedModelIds(activeProfileModels.map((m) => m.id))}>全选</button>
                          <button type="button" onClick={() => setSelectedModelIds([])}>清除</button>
                        </div>
                      }
                      className="model-benchmark__multi-select"
                      label="参测模型: "
                      value={selectedModelIds}
                      options={activeProfileModels.map((m) => ({
                        label: getModelOptionLabel(m),
                        value: m.id,
                      }))}
                      placeholder="多选要测试的模型 (已选即为批测队列)"
                      onChange={(value) =>
                        setSelectedModelIds(
                          Array.isArray(value) ? (value as string[]) : []
                        )
                      }
                    />
                  ) : null}

                  {compareMode === 'custom' ? (
                    <Select
                      multiple
                      filterable
                      minCollapsedNum={3}
                      popupProps={{
                        overlayClassName: 'model-benchmark__select-popup',
                      }}
                      panelTopContent={
                        <div className="model-benchmark__select-actions">
                          <button type="button" onClick={() => setSelectedCustomKeys(customTargets.map((t) => t.selectionKey))}>全选</button>
                          <button type="button" onClick={() => setSelectedCustomKeys([])}>清除</button>
                        </div>
                      }
                      className="model-benchmark__multi-select"
                      label="目标组合: "
                      value={selectedCustomKeys}
                      options={customTargets.map((t) => ({
                        label: `${t.profileName} · ${t.modelLabel}`,
                        value: t.selectionKey,
                      }))}
                      placeholder="手动编排供应商与模型组合"
                      onChange={(value) =>
                        setSelectedCustomKeys(
                          Array.isArray(value) ? (value as string[]) : []
                        )
                      }
                    />
                  ) : null}
                </div>
              </div>

              <div className="model-benchmark__config-actions">
                <div className="model-benchmark__prompt-area">
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="在此输入测试提示词..."
                  />
                </div>
                <div className="model-benchmark__action-row-inline">
                  <div className="model-benchmark__concurrency">
                    <span>最大并发:</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="最大并发"
                      value={concurrency}
                      onChange={(event) => {
                        const digitsOnly = event.target.value.replace(/\D/g, '');
                        const nextValue = Number(digitsOnly);
                        setConcurrency(Math.min(10, Math.max(1, nextValue || 1)));
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="model-benchmark__primary-button"
                    onClick={handleCreateAndRun}
                    disabled={
                      !storeState.ready ||
                      resolvedTargets.length === 0 ||
                      !prompt.trim()
                    }
                  >
                    开始测试 ({resolvedTargets.length})
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="model-benchmark__main-head">
            <div>
              <div className="model-benchmark__eyebrow">
                {displayedSession ? MODE_LABELS[displayedSession.compareMode] : 'Result Board'}
              </div>
              <h3>{displayedSession ? displayedSession.title : '还没有测试结果'}</h3>
              {displayedSession ? (
                <p className="model-benchmark__main-desc">
                  {displayedSessionSummary.total} 个目标
                  {displayedSessionSummary.completed > 0 ? `，${displayedSessionSummary.completed} 成功` : ''}
                  {displayedSessionSummary.failed > 0 ? `，${displayedSessionSummary.failed} 失败` : ''}
                  {' · '}{SESSION_STATUS_LABELS[displayedSession.status]}
                  {' · '}{RANKING_LABELS[displayedSession.rankingMode]}
                </p>
              ) : (
                <p className="model-benchmark__main-desc">
                  请先在上方明确范围，或点击历史会话查看以往结果。
                </p>
              )}
            </div>
          </div>

          {displayedSession ? (
            <>
              {topEntry ? (
                <section className="model-benchmark__spotlight">
                  <div className="model-benchmark__spotlight-copy">
                    <div className="model-benchmark__eyebrow">当前第一名</div>
                    <h4>
                      {displayedSession.compareMode === 'cross-provider'
                        ? topEntry.profileName
                        : topEntry.modelLabel}
                    </h4>
                    <p>
                      {displayedSession.compareMode === 'cross-provider'
                        ? `${topEntry.modelLabel}，`
                        : `来自 ${topEntry.profileName}，`}
                      首响 {formatDuration(topEntry.firstResponseMs)}
                      ，总耗时 {formatDuration(topEntry.totalDurationMs)}
                    </p>
                  </div>
                  <div className="model-benchmark__spotlight-meta">
                    {topEntry.userScore ? <span>{topEntry.userScore} 分</span> : null}
                    {topEntry.favorite ? <span>已收藏</span> : null}
                  </div>
                </section>
              ) : null}

              <div className="model-benchmark__result-grid">
                {displayedSortedEntries.map((entry, index) => (
                  <article
                    key={entry.id}
                    className={`model-benchmark__result-card model-benchmark__result-card--${entry.status}`}
                  >
                    <header className="model-benchmark__result-head">
                      <div className="model-benchmark__result-rank">#{index + 1}</div>
                      <div className="model-benchmark__result-heading">
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
                      <span>
                        性价比{' '}
                        {(() => {
                          const vs = computeValueScore(entry);
                          return vs === null ? '—' : `${vs}/10`;
                        })()}
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
                                displayedSession.id,
                                entry.id,
                                {
                                  userScore: entry.userScore === score ? null : score,
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
                              displayedSession.id,
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
                              displayedSession.id,
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
            </>
          ) : (
            <div className="model-benchmark__empty">
              先在左侧选定“同供应商多模型”或“同模型跨供应商”，把批测目标编满后再开跑。
            </div>
          )}
        </div>
      </main>
      {confirmDialog}
    </div>
  );
}

export default ModelBenchmarkWorkbench;

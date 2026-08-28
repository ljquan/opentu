import {
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { ModelConfig, ModelType } from '../constants/model-config';
import {
  getConfiguredSelectableModels,
  getProfilePreferredModels,
  getPreferredModels,
  getSelectableModels,
  runtimeModelDiscovery,
  type RuntimeModelDiscoveryState,
} from '../utils/runtime-model-discovery';
import { LEGACY_DEFAULT_PROVIDER_PROFILE_ID } from '../utils/settings-manager';

const subscribeRuntimeModelDiscovery = (listener: () => void) =>
  runtimeModelDiscovery.subscribe(listener);
const getRuntimeModelDiscoveryRevision = () =>
  runtimeModelDiscovery.getRevision();

export function useRuntimeModelDiscoveryState(
  profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID
): RuntimeModelDiscoveryState {
  const revision = useRuntimeModelDiscoveryRevision();
  return useMemo(() => {
    void revision;
    return runtimeModelDiscovery.getState(profileId);
  }, [profileId, revision]);
}

/**
 * 比较两个 ModelConfig 数组是否内容相同（按 id + selectionKey）
 */
function areModelListsEqual(a: ModelConfig[], b: ModelConfig[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].selectionKey !== b[i].selectionKey ||
      a[i].tags?.join('\0') !== b[i].tags?.join('\0')
    ) {
      return false;
    }
  }
  return true;
}

function useRuntimeModelDiscoveryRevision(): number {
  return useSyncExternalStore(
    subscribeRuntimeModelDiscovery,
    getRuntimeModelDiscoveryRevision,
    getRuntimeModelDiscoveryRevision
  );
}

export function usePreferredModels(modelType: ModelType): ModelConfig[] {
  const state = useRuntimeModelDiscoveryState();
  const prevRef = useRef<ModelConfig[]>([]);
  return useMemo(() => {
    void state;
    const next = getPreferredModels(modelType);
    if (areModelListsEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  }, [modelType, state]);
}

export function useSelectableModels(modelType: ModelType): ModelConfig[] {
  const state = useRuntimeModelDiscoveryState();
  const prevRef = useRef<ModelConfig[]>([]);
  return useMemo(() => {
    void state;
    const next = getSelectableModels(modelType);
    if (areModelListsEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  }, [modelType, state]);
}

export function useConfiguredSelectableModels(
  modelType: ModelType
): ModelConfig[] {
  const revision = useRuntimeModelDiscoveryRevision();
  return useMemo(() => {
    void revision;
    return getConfiguredSelectableModels(modelType);
  }, [modelType, revision]);
}

export function useProfilePreferredModels(
  profileId: string,
  modelType: ModelType
): ModelConfig[] {
  const state = useRuntimeModelDiscoveryState(profileId);
  const prevRef = useRef<ModelConfig[]>([]);
  return useMemo(() => {
    void state;
    const next = getProfilePreferredModels(profileId, modelType);
    if (areModelListsEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  }, [profileId, modelType, state]);
}

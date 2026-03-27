import { useEffect, useState } from 'react';
import type { ModelConfig, ModelType } from '../constants/model-config';
import {
  getProfilePreferredModels,
  getPreferredModels,
  getSelectableModels,
  runtimeModelDiscovery,
  type RuntimeModelDiscoveryState,
} from '../utils/runtime-model-discovery';
import { LEGACY_DEFAULT_PROVIDER_PROFILE_ID } from '../utils/settings-manager';

export function useRuntimeModelDiscoveryState(
  profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID
): RuntimeModelDiscoveryState {
  const [state, setState] = useState<RuntimeModelDiscoveryState>(() =>
    runtimeModelDiscovery.getState(profileId)
  );

  useEffect(() => {
    setState(runtimeModelDiscovery.getState(profileId));
    return runtimeModelDiscovery.subscribe(() => {
      setState(runtimeModelDiscovery.getState(profileId));
    });
  }, [profileId]);

  return state;
}

export function usePreferredModels(modelType: ModelType): ModelConfig[] {
  useRuntimeModelDiscoveryState();
  return getPreferredModels(modelType);
}

export function useSelectableModels(modelType: ModelType): ModelConfig[] {
  useRuntimeModelDiscoveryState();
  return getSelectableModels(modelType);
}

export function useProfilePreferredModels(
  profileId: string,
  modelType: ModelType
): ModelConfig[] {
  useRuntimeModelDiscoveryState(profileId);
  return getProfilePreferredModels(profileId, modelType);
}

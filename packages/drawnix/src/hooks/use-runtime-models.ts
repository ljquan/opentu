import { useEffect, useState } from 'react';
import type { ModelConfig, ModelType } from '../constants/model-config';
import {
  getPreferredModels,
  runtimeModelDiscovery,
  type RuntimeModelDiscoveryState,
} from '../utils/runtime-model-discovery';

export function useRuntimeModelDiscoveryState(): RuntimeModelDiscoveryState {
  const [state, setState] = useState<RuntimeModelDiscoveryState>(() => runtimeModelDiscovery.getState());

  useEffect(() => {
    return runtimeModelDiscovery.subscribe(() => {
      setState(runtimeModelDiscovery.getState());
    });
  }, []);

  return state;
}

export function usePreferredModels(modelType: ModelType): ModelConfig[] {
  useRuntimeModelDiscoveryState();
  return getPreferredModels(modelType);
}

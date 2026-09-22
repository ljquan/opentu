// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../constants/model-config';

const store = vi.hoisted(() => ({
  revision: 0,
  models: [] as ModelConfig[],
  state: { profileId: 'legacy-default' },
  listeners: new Set<() => void>(),
}));

vi.mock('../../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
}));
vi.mock('../../utils/runtime-model-discovery', () => ({
  getSelectableModels: () => store.models,
  getPreferredModels: () => store.models,
  getConfiguredSelectableModels: () => store.models,
  getProfilePreferredModels: () => store.models,
  runtimeModelDiscovery: {
    getState: () => store.state,
    getRevision: () => store.revision,
    subscribe: (listener: () => void) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
  },
}));

import {
  usePreferredModels,
  useProfilePreferredModels,
  useSelectableModels,
} from '../use-runtime-models';

describe('runtime model subscriptions', () => {
  beforeEach(() => {
    store.revision = 0;
    store.models = [{ id: 'old-a' }, { id: 'old-b' }] as ModelConfig[];
  });
  afterEach(cleanup);

  it.each([
    ['selectable', () => useSelectableModels('image')],
    ['preferred', () => usePreferredModels('image')],
    ['profile', () => useProfilePreferredModels('provider', 'image')],
  ] as const)('%s updates even when the catalog state reference is unchanged', (_, hook) => {
    const { result } = renderHook(hook);
    expect(result.current.map((model) => model.id)).toEqual(['old-a', 'old-b']);

    act(() => {
      store.models = [{ id: 'new-key-model' }] as ModelConfig[];
      store.revision += 1;
      store.listeners.forEach((listener) => listener());
    });

    expect(result.current.map((model) => model.id)).toEqual(['new-key-model']);
  });
});

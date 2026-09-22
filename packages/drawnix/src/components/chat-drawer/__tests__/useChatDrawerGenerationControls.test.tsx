import React, { useCallback, useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getModelConfig,
  type ModelConfig,
} from '../../../constants/model-config';
import type { ChatSessionGenerationState } from '../../../types/chat.types';
import { useChatDrawerGenerationControls } from '../useChatDrawerGenerationControls';

const store = vi.hoisted(() => ({
  models: [] as ModelConfig[],
  savePreferences: vi.fn(),
  saveParams: vi.fn(),
}));

vi.mock('../../../hooks/use-runtime-models', () => ({
  useSelectableModels: (type: string) =>
    store.models.filter((model) => model.type === type),
}));
vi.mock('../../../utils/settings-manager', () => ({
  createModelRef: (profileId: string | null, modelId: string) =>
    modelId ? { profileId, modelId } : null,
  resolveInvocationRoute: () => ({
    profileId: 'legacy-default',
    modelId: 'gpt-image-2.5',
  }),
}));
vi.mock('../../../services/ai-generation-preferences-service', () => ({
  loadAIInputPreferences: () => ({
    generationType: 'image',
    selectedModel: 'gpt-image-2.5',
    selectedParams: {},
    selectedCount: 1,
    selectedSkillId: 'auto',
  }),
  loadScopedAIInputModelParams: (
    _type: string,
    _model: string,
    _key: string,
    fallback = {}
  ) => fallback,
  saveAIInputPreferences: store.savePreferences,
  saveScopedAIInputModelParams: store.saveParams,
}));
vi.mock('../../../services/video-binding-utils', () => ({
  getEffectiveVideoCompatibleParams: () => [],
}));

function runtimeModel(
  id = 'gpt-image-2.5',
  profileId = 'legacy-default'
): ModelConfig {
  const config = getModelConfig(id);
  if (!config) throw new Error(`Missing model fixture: ${id}`);
  return {
    ...config,
    sourceProfileId: profileId,
    selectionKey: `${profileId}::${id}`,
  };
}

function legacyState(): ChatSessionGenerationState {
  return {
    generationType: 'image',
    selectedModel: 'gpt-image-2.5',
    selectedModelRef: null,
    selectedParams: {},
    selectedCount: 1,
  };
}

function renderWithSession(
  initial: ChatSessionGenerationState | null = legacyState()
) {
  const persist = vi.fn();
  const hook = renderHook(
    () => {
      const [session, setSession] = useState({
        id: 'session-1',
        generationState: initial,
      });
      const onSessionGenerationStateChange = useCallback(
        (state: ChatSessionGenerationState) => {
          persist(session.id, state);
          // Bound the reproduction so a regression fails instead of hanging the runner.
          if (persist.mock.calls.length > 20)
            throw new Error('Generation state persistence loop');
          setSession((previous) => ({
            ...previous,
            generationState: {
              ...state,
              selectedParams: { ...state.selectedParams },
            },
          }));
        },
        [session.id]
      );
      const controls = useChatDrawerGenerationControls({
        sessionId: session.id,
        sessionGenerationState: session.generationState,
        onSessionGenerationStateChange,
      });
      return { controls, session, setSession };
    },
    {
      wrapper: ({ children }) => (
        <React.StrictMode>{children}</React.StrictMode>
      ),
    }
  );
  return { ...hook, persist };
}

beforeEach(() => {
  store.models = [runtimeModel()];
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('chat drawer generation state synchronization', () => {
  it('settles a legacy session against runtime-only models before persisting', () => {
    const { result, persist, rerender } = renderWithSession();
    expect(result.current.controls.selectedModelRef).toEqual({
      profileId: 'legacy-default',
      modelId: 'gpt-image-2.5',
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(store.savePreferences).toHaveBeenCalledTimes(1);
    expect(store.saveParams).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][1]).toEqual(
      result.current.session.generationState
    );
    rerender();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('persists user parameters and count once without restoring the previous values', () => {
    const { result, persist } = renderWithSession();
    persist.mockClear();
    act(() => {
      result.current.controls.handleParamSelect('resolution', '2k');
      result.current.controls.setSelectedCount(3);
    });
    expect(
      result.current.session.generationState?.selectedParams.resolution
    ).toBe('2k');
    expect(result.current.session.generationState?.selectedCount).toBe(3);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('restores a different session without writing the previous session into it', () => {
    const { result, persist } = renderWithSession();
    persist.mockClear();
    act(() =>
      result.current.setSession({
        id: 'session-2',
        generationState: {
          ...legacyState(),
          selectedCount: 4,
          selectedParams: { resolution: '2k' },
        },
      })
    );
    expect(result.current.controls.selectedCount).toBe(4);
    expect(result.current.controls.selectedParams.resolution).toBe('2k');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0]).toEqual([
      'session-2',
      result.current.session.generationState,
    ]);
  });

  it('initializes a new session once and does not skip another identical new session', () => {
    const { result, persist } = renderWithSession(null);
    expect(persist).toHaveBeenCalledTimes(1);
    persist.mockClear();
    act(() =>
      result.current.setSession({ id: 'session-2', generationState: null })
    );
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0]).toBe('session-2');
    expect(result.current.controls.selectedSelectionKey).toBe(
      'legacy-default::gpt-image-2.5'
    );
  });

  it('does not rewrite an unchanged normalized session or cloned incoming state', () => {
    const { result, persist } = renderWithSession();
    const stableState = result.current.session.generationState;
    if (!stableState) throw new Error('Missing saved generation state');
    persist.mockClear();
    store.savePreferences.mockClear();
    act(() =>
      result.current.setSession({
        id: 'session-1',
        generationState: {
          ...stableState,
          selectedParams: { ...stableState.selectedParams },
        },
      })
    );
    expect(persist).not.toHaveBeenCalled();
    expect(store.savePreferences).not.toHaveBeenCalled();
    act(() =>
      result.current.setSession({
        id: 'session-2',
        generationState: stableState,
      })
    );
    expect(persist).not.toHaveBeenCalled();
    expect(result.current.controls.selectedParams).toEqual(
      stableState.selectedParams
    );
  });

  it('accepts external parameter changes in the same session without echoing them', () => {
    const { result, persist } = renderWithSession();
    const stableState = result.current.session.generationState;
    if (!stableState) throw new Error('Missing saved generation state');
    persist.mockClear();
    act(() =>
      result.current.setSession({
        ...result.current.session,
        generationState: {
          ...stableState,
          selectedCount: 5,
        },
      })
    );
    expect(result.current.controls.selectedCount).toBe(5);
    expect(persist).not.toHaveBeenCalled();
  });

  it('normalizes once when runtime models arrive after session restoration', () => {
    store.models = [];
    const { result, persist, rerender } = renderWithSession();
    persist.mockClear();
    store.models = [runtimeModel()];
    rerender();
    expect(result.current.controls.selectedSelectionKey).toBe(
      'legacy-default::gpt-image-2.5'
    );
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('preserves provider identity when selecting the same model from another provider', () => {
    store.models = [
      runtimeModel(),
      runtimeModel('gpt-image-2.5', 'second-provider'),
    ];
    const { result, persist } = renderWithSession();
    persist.mockClear();
    act(() => result.current.controls.handleModelConfigSelect(store.models[1]));
    expect(result.current.controls.selectedSelectionKey).toBe(
      'second-provider::gpt-image-2.5'
    );
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][1].selectedModelRef.profileId).toBe(
      'second-provider'
    );
  });

  it('recovers a removed model without repeatedly restoring the stale selection', () => {
    const { result, persist } = renderWithSession({
      ...legacyState(),
      selectedModel: 'removed-model',
    });
    expect(result.current.controls.selectedSelectionKey).toBe(
      'legacy-default::gpt-image-2.5'
    );
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it.each(['text', 'agent', 'audio'] as const)(
    'normalizes %s counts before persisting',
    (generationType) => {
      const model = generationType === 'audio' ? 'suno_music' : 'gpt-5.4';
      store.models = [runtimeModel(model)];
      const { result, persist } = renderWithSession({
        ...legacyState(),
        generationType,
        selectedModel: model,
        selectedCount: 4,
      });
      expect(result.current.controls.generationType).toBe(generationType);
      expect(result.current.controls.selectedCount).toBe(1);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(persist.mock.calls[0][1].selectedCount).toBe(1);
    }
  );
});

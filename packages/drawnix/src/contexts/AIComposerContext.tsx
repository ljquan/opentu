import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { GenerationType } from '../utils/ai-input-parser';
import { createModelRef, type ModelRef } from '../utils/settings-manager';
import { getPersistedModelSelection } from '../utils/ai-model-selection-storage';
import { loadAIInputPreferences } from '../services/ai-generation-preferences-service';

export interface AIComposerState {
  generationType: GenerationType;
  selectedModel: string;
  selectedModelRef: ModelRef | null;
  selectedParams: Record<string, string>;
  selectedCount: number;
}

interface AIComposerContextValue extends AIComposerState {
  setComposerState: (updates: Partial<AIComposerState>) => void;
}

const AIComposerContext = createContext<AIComposerContextValue | null>(null);

function areModelRefsEqual(
  left: ModelRef | null | undefined,
  right: ModelRef | null | undefined
): boolean {
  return (left?.profileId || null) === (right?.profileId || null);
}

function areStringRecordsEqual(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

function createInitialState(): AIComposerState {
  const preferences = loadAIInputPreferences();
  const persistedSelection = getPersistedModelSelection(preferences.generationType);

  return {
    generationType: preferences.generationType,
    selectedModel: persistedSelection?.modelId || preferences.selectedModel,
    selectedModelRef: persistedSelection
      ? createModelRef(persistedSelection.profileId, persistedSelection.modelId)
      : null,
    selectedParams: preferences.selectedParams,
    selectedCount: preferences.selectedCount,
  };
}

export const AIComposerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, setState] = useState<AIComposerState>(() => createInitialState());

  const setComposerState = useCallback((updates: Partial<AIComposerState>) => {
    setState((prev) => {
      const next: AIComposerState = {
        ...prev,
        ...updates,
        selectedParams: updates.selectedParams ?? prev.selectedParams,
      };

      if (
        prev.generationType === next.generationType &&
        prev.selectedModel === next.selectedModel &&
        areModelRefsEqual(prev.selectedModelRef, next.selectedModelRef) &&
        prev.selectedCount === next.selectedCount &&
        areStringRecordsEqual(prev.selectedParams, next.selectedParams)
      ) {
        return prev;
      }

      return next;
    });
  }, []);

  const value = useMemo<AIComposerContextValue>(
    () => ({
      ...state,
      setComposerState,
    }),
    [state, setComposerState]
  );

  return (
    <AIComposerContext.Provider value={value}>
      {children}
    </AIComposerContext.Provider>
  );
};

export function useAIComposerSync(): AIComposerContextValue {
  const context = useContext(AIComposerContext);
  if (!context) {
    throw new Error('useAIComposerSync must be used within AIComposerProvider');
  }
  return context;
}

// @vitest-environment jsdom
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('AIComposerContext', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('在不同消费者之间只同步生成配置，不共享附件草稿', async () => {
    vi.doMock('../../utils/settings-manager', () => ({
      createModelRef: (profileId: string | null, modelId: string) => ({
        profileId,
        modelId,
      }),
    }));
    vi.doMock('../../utils/ai-model-selection-storage', () => ({
      getPersistedModelSelection: () => null,
    }));
    vi.doMock('../../services/ai-generation-preferences-service', () => ({
      loadAIInputPreferences: () => ({
        generationType: 'image',
        selectedModel: 'gemini-3-pro-image-preview',
        selectedParams: {},
        selectedCount: 1,
        selectedSkillId: 'auto',
      }),
    }));

    const {
      AIComposerProvider,
      useAIComposerSync,
    } = await import('../AIComposerContext');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AIComposerProvider>{children}</AIComposerProvider>
    );

    const { result } = renderHook(
      () => ({
        first: useAIComposerSync(),
        second: useAIComposerSync(),
      }),
      { wrapper }
    );

    act(() => {
      result.current.first.setComposerState({
        generationType: 'video',
        selectedModel: 'veo3',
        selectedParams: { duration: '8' },
        selectedCount: 2,
      });
    });

    expect(result.current.second.generationType).toBe('video');
    expect(result.current.second.selectedModel).toBe('veo3');
    expect(result.current.second.selectedParams).toEqual({ duration: '8' });
    expect(result.current.second.selectedCount).toBe(2);
    expect('uploadedContent' in result.current.second).toBe(false);
    expect('setUploadedContent' in result.current.second).toBe(false);
  });
});

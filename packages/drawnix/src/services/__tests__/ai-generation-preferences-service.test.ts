import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ai-generation-preferences-service', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('保存并恢复 AI 输入栏下拉偏好', async () => {
    const {
      loadAIInputPreferences,
      saveAIInputPreferences,
    } = await import('../ai-generation-preferences-service');

    saveAIInputPreferences({
      generationType: 'text',
      selectedModel: 'deepseek-v3.2',
      selectedParams: {},
      selectedCount: 1,
      selectedSkillId: 'skill-123',
    });

    expect(loadAIInputPreferences()).toMatchObject({
      generationType: 'text',
      selectedModel: 'deepseek-v3.2',
      selectedCount: 1,
      selectedSkillId: 'skill-123',
    });
  });

  it('按 selectionKey 为 AI 输入栏隔离模型参数', async () => {
    const {
      loadScopedAIInputModelParams,
      saveScopedAIInputModelParams,
    } = await import('../ai-generation-preferences-service');

    saveScopedAIInputModelParams(
      'audio',
      'suno_music',
      { sunoAction: 'music', instrumental: 'true' },
      'provider-a::suno_music'
    );
    saveScopedAIInputModelParams(
      'audio',
      'suno_music',
      { sunoAction: 'lyrics' },
      'provider-b::suno_music'
    );

    expect(
      loadScopedAIInputModelParams(
        'audio',
        'suno_music',
        'provider-a::suno_music'
      )
    ).toMatchObject({ sunoAction: 'music', instrumental: 'true' });
    expect(
      loadScopedAIInputModelParams(
        'audio',
        'suno_music',
        'provider-b::suno_music'
      )
    ).toMatchObject({ sunoAction: 'lyrics' });
  });

  it('按模型作用域恢复图片工具偏好', async () => {
    const {
      loadScopedAIImageToolPreferences,
      saveAIImageToolPreferences,
    } = await import('../ai-generation-preferences-service');

    saveAIImageToolPreferences({
      currentModel: 'doubao-seedream-4-5-251128',
      currentSelectionKey: 'provider-a::doubao-seedream-4-5-251128',
      extraParams: { seedream_quality: '4k' },
      aspectRatio: '16:9',
    });

    expect(
      loadScopedAIImageToolPreferences(
        'doubao-seedream-4-5-251128',
        'provider-a::doubao-seedream-4-5-251128'
      )
    ).toMatchObject({
      extraParams: { seedream_quality: '4k' },
      aspectRatio: '16:9',
    });
  });

  it('按模型作用域恢复视频工具偏好', async () => {
    const {
      loadScopedAIVideoToolPreferences,
      saveAIVideoToolPreferences,
    } = await import('../ai-generation-preferences-service');

    saveAIVideoToolPreferences({
      currentModel: 'veo3',
      currentSelectionKey: 'provider-a::veo3',
      extraParams: { aspect_ratio: '16:9' },
      duration: '8',
      size: '1280x720',
    });

    expect(
      loadScopedAIVideoToolPreferences('veo3', 'provider-a::veo3')
    ).toMatchObject({
      extraParams: { aspect_ratio: '16:9' },
      duration: '8',
      size: '1280x720',
    });
  });
});

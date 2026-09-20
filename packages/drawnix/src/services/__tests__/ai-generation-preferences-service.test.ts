// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ai-generation-preferences-service', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it.each(['gpt-image-2.5', 'gpt-image-2.5-vip', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
    '%s 保留 4K 偏好并修正尺寸，将已移除的计费档恢复为自动',
    async (modelId) => {
      const { sanitizeImageToolExtraParams } = await import('../ai-generation-preferences-service');
      expect(sanitizeImageToolExtraParams(modelId, {
        size: 'auto', resolution: '4k',
      })).toMatchObject({ size: 'auto', resolution: '4k' });
      expect(sanitizeImageToolExtraParams(modelId, {
        size: 'auto', resolution: '2k',
      })).toMatchObject({ size: 'auto', resolution: '2k' });
      expect(sanitizeImageToolExtraParams(modelId, {
        size: '1536x1024', resolution: '4k',
      })).toMatchObject({ size: '3x2', resolution: '4k' });
      expect(sanitizeImageToolExtraParams(modelId, {
        size: 'auto', resolution: 'auto',
      })).toMatchObject({ size: 'auto', resolution: 'auto' });
      expect(sanitizeImageToolExtraParams(modelId, {
        size: '2x3', resolution: 'billing-1k',
      })).toMatchObject({ size: '2x3', resolution: 'auto' });
    }
  );

  it.each(['gpt-image-2', 'gpt-image-2-vip'])(
    '%s retains automatic aspect ratio with the selected K tier',
    async (modelId) => {
      const { sanitizeImageToolExtraParams } = await import('../ai-generation-preferences-service');
      for (const resolution of ['1k', '2k', '4k']) {
        expect(sanitizeImageToolExtraParams(modelId, {
          size: 'auto', resolution, quality: 'medium',
        })).toMatchObject({ size: 'auto', resolution, quality: 'medium' });
      }
    }
  );

  it('兼容旧 text 偏好并恢复为 agent 模式', async () => {
    localStorage.setItem(
      'aitu_ai_input_preferences',
      JSON.stringify({
        value: {
          generationType: 'text',
          selectedModel: 'deepseek-v3.2',
          selectedParams: {},
          selectedCount: 1,
          selectedSkillId: 'skill-123',
        },
        updatedAt: Date.now(),
      })
    );

    const { loadAIInputPreferences } = await import(
      '../ai-generation-preferences-service'
    );

    expect(loadAIInputPreferences()).toMatchObject({
      generationType: 'agent',
      selectedModel: 'deepseek-v3.2',
      selectedCount: 1,
      selectedSkillId: 'skill-123',
    });
  });

  it('保存并恢复文本生成模式偏好', async () => {
    const { loadAIInputPreferences, saveAIInputPreferences } = await import(
      '../ai-generation-preferences-service'
    );

    saveAIInputPreferences({
      generationType: 'agent',
      selectedModel: 'deepseek-v3.2',
      selectedParams: {},
      selectedCount: 1,
      selectedSkillId: 'skill-123',
    });

    saveAIInputPreferences({
      generationType: 'text',
      selectedModel: 'deepseek-v3.2',
      selectedParams: {},
      selectedCount: 1,
      selectedSkillId: 'auto',
    });

    expect(loadAIInputPreferences()).toMatchObject({
      generationType: 'text',
      selectedModel: 'deepseek-v3.2',
      selectedCount: 1,
    });
  });

  it('按 selectionKey 为 AI 输入栏隔离模型参数', async () => {
    const { loadScopedAIInputModelParams, saveScopedAIInputModelParams } =
      await import('../ai-generation-preferences-service');

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
    const { loadScopedAIImageToolPreferences, saveAIImageToolPreferences } =
      await import('../ai-generation-preferences-service');

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
      extraParams: { size: '16x9', seedream_quality: '4k' },
      aspectRatio: '16:9',
    });
  });

  it.each([
    ['auto', 'auto', 'auto'],
    ['1:1', '1x1', '1:1'],
    ['2:3', '2x3', '2:3'],
    ['3:2', '3x2', '3:2'],
    ['3:4', '3x4', '3:4'],
    ['4:3', '4x3', '4:3'],
    ['4:5', '4x5', '4:5'],
    ['5:4', '5x4', '5:4'],
    ['9:16', '9x16', '9:16'],
    ['16:9', '16x9', '16:9'],
    ['1:4', 'auto', 'auto'],
    ['21:9', '21x9', 'auto'],
  ])(
    'GPT Image 2.5 将图片工具比例 %s 保留为扩展比例 %s',
    async (aspectRatio, expectedSize, expectedAspectRatio) => {
      const {
        loadScopedAIImageToolPreferences,
        loadScopedAIInputModelParams,
        saveAIImageToolPreferences,
      } = await import('../ai-generation-preferences-service');

      saveAIImageToolPreferences({
        currentModel: 'gpt-image-2.5',
        currentSelectionKey: 'provider-a::gpt-image-2.5',
        extraParams: {},
        aspectRatio,
      });

      expect(
        loadScopedAIImageToolPreferences(
          'gpt-image-2.5',
          'provider-a::gpt-image-2.5'
        )
      ).toMatchObject({
        extraParams: {
          size: expectedSize,
          resolution: 'auto',
          quality: 'auto',
        },
        aspectRatio: expectedAspectRatio,
      });
      expect(
        loadScopedAIInputModelParams(
          'image',
          'gpt-image-2.5',
          'provider-a::gpt-image-2.5'
        )
      ).toMatchObject({ size: expectedSize });
    }
  );

  it('将 GPT Image 的旧 quality 档位偏好迁移到 resolution', async () => {
    localStorage.setItem(
      'aitu_ai_image_tool_preferences',
      JSON.stringify({
        value: {
          currentModel: 'gpt-image-2',
          currentSelectionKey: 'provider-a::gpt-image-2',
          extraParams: {
            quality: '2k',
          },
          aspectRatio: '16:9',
          scopedPreferences: {
            'provider-a::gpt-image-2': {
              modelId: 'gpt-image-2',
              selectionKey: 'provider-a::gpt-image-2',
              extraParams: {
                quality: '2k',
              },
              aspectRatio: '16:9',
            },
          },
        },
        updatedAt: Date.now(),
      })
    );

    const { loadScopedAIImageToolPreferences } = await import(
      '../ai-generation-preferences-service'
    );

    expect(
      loadScopedAIImageToolPreferences('gpt-image-2', 'provider-a::gpt-image-2')
    ).toMatchObject({
      extraParams: {
        size: '16x9',
        resolution: '2k',
        quality: 'auto',
      },
      aspectRatio: '16:9',
    });
  });

  it('AI 图片工具优先对齐 AI 输入栏的图片模型参数', async () => {
    const {
      loadScopedAIImageToolPreferences,
      saveAIImageToolPreferences,
      saveScopedAIInputModelParams,
    } = await import('../ai-generation-preferences-service');

    saveAIImageToolPreferences({
      currentModel: 'gpt-image-2',
      currentSelectionKey: 'provider-a::gpt-image-2',
      extraParams: {
        resolution: '1k',
        quality: 'auto',
      },
      aspectRatio: '16:9',
    });
    saveScopedAIInputModelParams(
      'image',
      'gpt-image-2',
      {
        size: '16x9',
        resolution: '4k',
        quality: 'high',
      },
      'provider-a::gpt-image-2'
    );

    expect(
      loadScopedAIImageToolPreferences('gpt-image-2', 'provider-a::gpt-image-2')
    ).toMatchObject({
      extraParams: {
        size: '16x9',
        resolution: '4k',
        quality: 'high',
      },
      aspectRatio: '16:9',
    });
  });

  it('AI 图片工具保存参数时同步回 AI 输入栏并更新尺寸参数', async () => {
    const {
      loadScopedAIInputModelParams,
      saveAIImageToolPreferences,
      saveScopedAIInputModelParams,
    } = await import('../ai-generation-preferences-service');

    saveScopedAIInputModelParams(
      'image',
      'gpt-image-2',
      {
        size: '3x4',
        resolution: '1k',
        quality: 'auto',
      },
      'provider-a::gpt-image-2'
    );
    saveAIImageToolPreferences({
      currentModel: 'gpt-image-2',
      currentSelectionKey: 'provider-a::gpt-image-2',
      extraParams: {
        resolution: '2k',
        quality: 'medium',
      },
      aspectRatio: '16:9',
    });

    expect(
      loadScopedAIInputModelParams(
        'image',
        'gpt-image-2',
        'provider-a::gpt-image-2'
      )
    ).toMatchObject({
      size: '16x9',
      resolution: '2k',
      quality: 'medium',
    });
  });

  it('保留 Gemini preview 的旧 quality 档位语义', async () => {
    localStorage.setItem(
      'aitu_ai_image_tool_preferences',
      JSON.stringify({
        value: {
          currentModel: 'gemini-3-pro-image-preview',
          currentSelectionKey: 'provider-a::gemini-3-pro-image-preview',
          extraParams: {
            quality: '4k',
          },
          aspectRatio: '1:1',
          scopedPreferences: {
            'provider-a::gemini-3-pro-image-preview': {
              modelId: 'gemini-3-pro-image-preview',
              selectionKey: 'provider-a::gemini-3-pro-image-preview',
              extraParams: {
                quality: '4k',
              },
              aspectRatio: '1:1',
            },
          },
        },
        updatedAt: Date.now(),
      })
    );

    const { loadScopedAIImageToolPreferences } = await import(
      '../ai-generation-preferences-service'
    );

    expect(
      loadScopedAIImageToolPreferences(
        'gemini-3-pro-image-preview',
        'provider-a::gemini-3-pro-image-preview'
      )
    ).toMatchObject({
      extraParams: {
        size: '1x1',
        quality: '4k',
      },
      aspectRatio: '1:1',
    });
  });

  it('按模型作用域恢复视频工具偏好', async () => {
    const { loadScopedAIVideoToolPreferences, saveAIVideoToolPreferences } =
      await import('../ai-generation-preferences-service');

    saveAIVideoToolPreferences({
      currentModel: 'kling_video',
      currentSelectionKey: 'provider-a::kling_video',
      extraParams: { model_name: 'kling-v3' },
      duration: '10',
      size: '1024x1024',
    });

    expect(
      loadScopedAIVideoToolPreferences('kling_video', 'provider-a::kling_video')
    ).toMatchObject({
      extraParams: { model_name: 'kling-v3' },
      duration: '10',
      size: '1024x1024',
    });
  });

  it('AI 视频工具优先对齐 AI 输入栏的视频模型参数', async () => {
    const {
      loadScopedAIVideoToolPreferences,
      saveAIVideoToolPreferences,
      saveScopedAIInputModelParams,
    } = await import('../ai-generation-preferences-service');

    saveAIVideoToolPreferences({
      currentModel: 'kling_video',
      currentSelectionKey: 'provider-a::kling_video',
      extraParams: { model_name: 'kling-v1-6' },
      duration: '5',
      size: '1280x720',
    });
    saveScopedAIInputModelParams(
      'video',
      'kling_video',
      {
        duration: '10',
        size: '1024x1024',
        model_name: 'kling-v3',
        klingAction2: 'text2video',
      },
      'provider-a::kling_video'
    );

    expect(
      loadScopedAIVideoToolPreferences('kling_video', 'provider-a::kling_video')
    ).toMatchObject({
      extraParams: {
        model_name: 'kling-v3',
        klingAction2: 'text2video',
      },
      duration: '10',
      size: '1024x1024',
    });
  });

  it('迁移 Seedance 2.0 的旧组合尺寸偏好', async () => {
    const { loadScopedAIVideoToolPreferences, saveScopedAIInputModelParams } =
      await import('../ai-generation-preferences-service');

    saveScopedAIInputModelParams(
      'video',
      'doubao-seedance-2-0-260128',
      {
        duration: '8',
        size: '480p@21:9',
      },
      'provider-a::doubao-seedance-2-0-260128'
    );

    expect(
      loadScopedAIVideoToolPreferences(
        'doubao-seedance-2-0-260128',
        'provider-a::doubao-seedance-2-0-260128'
      )
    ).toMatchObject({
      duration: '8',
      size: '480p',
      extraParams: expect.objectContaining({ ratio: '21:9' }),
    });
  });

  it('迁移 Seedance 2.5 的旧组合偏好时移除不受支持的分辨率', async () => {
    const { loadScopedAIVideoToolPreferences, saveScopedAIInputModelParams } =
      await import('../ai-generation-preferences-service');

    saveScopedAIInputModelParams(
      'video',
      'doubao-seedance-2-5-260628',
      {
        duration: '30',
        size: '1080p@1:1',
      },
      'provider-a::doubao-seedance-2-5-260628'
    );

    expect(
      loadScopedAIVideoToolPreferences(
        'doubao-seedance-2-5-260628',
        'provider-a::doubao-seedance-2-5-260628'
      )
    ).toMatchObject({
      duration: '30',
      size: '',
      extraParams: expect.objectContaining({ ratio: '1:1' }),
    });
  });

  it('AI 视频工具保存参数时同步回 AI 输入栏', async () => {
    const {
      loadScopedAIInputModelParams,
      saveAIVideoToolPreferences,
      saveScopedAIInputModelParams,
    } = await import('../ai-generation-preferences-service');

    saveScopedAIInputModelParams(
      'video',
      'kling_video',
      {
        duration: '5',
        size: '1280x720',
        model_name: 'kling-v1-6',
      },
      'provider-a::kling_video'
    );
    saveAIVideoToolPreferences({
      currentModel: 'kling_video',
      currentSelectionKey: 'provider-a::kling_video',
      extraParams: {
        model_name: 'kling-v3',
        klingAction2: 'text2video',
      },
      duration: '10',
      size: '1024x1024',
    });

    expect(
      loadScopedAIInputModelParams(
        'video',
        'kling_video',
        'provider-a::kling_video'
      )
    ).toMatchObject({
      duration: '10',
      size: '1024x1024',
      model_name: 'kling-v3',
      klingAction2: 'text2video',
    });
  });
});

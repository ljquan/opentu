/* @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import {
  adaptPublishedModelIds,
  isConsumerModelId,
  loadMarketplaceCatalog,
} from './model-marketplace-catalog';

describe('model marketplace catalog', () => {
  it('filters operation endpoints and keeps consumer models', () => {
    expect(isConsumerModelId('gpt-image-2')).toBe(true);
    expect(isConsumerModelId('suno_music')).toBe(true);
    expect(isConsumerModelId('mj_fast_upscale')).toBe(false);
    expect(isConsumerModelId('text-embedding-3-large')).toBe(false);
    expect(isConsumerModelId('suno_lyrics')).toBe(false);
  });

  it('adapts published model ids into curated and inferred entries', () => {
    const models = adaptPublishedModelIds([
      'gpt-image-2',
      'gpt-image-2',
      'custom-video-model',
      'text-embedding-3-small',
    ]);

    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      name: 'GPT Image 2',
      category: 'image',
      vendor: 'OpenAI',
    });
    expect(models[1]).toMatchObject({
      id: 'custom-video-model',
      category: 'video',
    });
  });

  it('uses the administrator-published list when the session api responds', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: ['suno_music', 'gpt-image-2'] }),
    });

    const catalog = await loadMarketplaceCatalog({
      embedded: true,
      apiBaseUrl: 'https://api.example.com',
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/user/models',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(catalog.source).toBe('managed');
    expect(catalog.models.map((model) => model.id)).toEqual([
      'suno_music',
      'gpt-image-2',
    ]);
  });
});


import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStatus, TaskType, type Task } from '../types/task.types';
import {
  prepareImageGenerationRecipe,
  getPreparedImageRecipe,
  readImageGenerationRecipe,
  resolveRecipeCanvasSources,
  validateRestoredImageReferences,
} from './image-generation-recipe';
import {
  collectEmbeddedMediaFromElements,
  restoreEmbeddedMedia,
} from '../data/embedded-media';

const cache = vi.hoisted(() => new Map<string, Blob>());
vi.mock('./canvas-operations/image-generation-references', () => ({
  imageKey: (url: string) => url,
}));
vi.mock('./media-executor/fallback-utils', () => ({
  cacheRemoteUrl: vi.fn(async (url: string, id: string) => {
    if (url.startsWith('/__aitu_cache__/')) return url;
    const target = `/__aitu_cache__/image/${id}.png`;
    cache.set(target, new Blob([url], { type: 'image/png' }));
    return target;
  }),
}));
vi.mock('./unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: vi.fn(async (url: string) => cache.get(url)),
    getCacheInfo: vi.fn(async () => ({ cachedAt: 1, lastUsed: 1 })),
    isCached: vi.fn(async (url: string) => cache.has(url)),
    cacheMediaFromBlob: vi.fn(async (url: string, blob: Blob) => {
      cache.set(url, blob);
      return url;
    }),
  },
}));
vi.mock('../data/image', () => ({
  loadImageElementForCanvas: vi.fn(async (url: string) => {
    if (!cache.has(url)) throw new Error('missing bytes');
    return { width: 10, height: 10 };
  }),
}));

function task(): Task {
  return {
    id: 'original',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    createdAt: 1,
    updatedAt: 1,
    params: {
      prompt: '原提示词',
      model: 'gpt-image-2',
      referenceImages: ['https://image.test/a.png'],
      maskImage: 'https://image.test/mask.png',
    },
  };
}

describe('generation recipes stored with canvas results', () => {
  beforeEach(() => cache.clear());

  it('restores references and masks from a canvas backup after task history and local media are gone', async () => {
    const original = task();
    await prepareImageGenerationRecipe(original);
    const element = {
      id: 'result',
      type: 'image',
      url: 'https://image.test/result.png',
      imageGenerationRecipe: getPreparedImageRecipe(original),
    };
    const saved = JSON.parse(JSON.stringify([element]));
    const embedded = await collectEmbeddedMediaFromElements(saved);
    expect(embedded).toHaveLength(2);
    expect(JSON.stringify(saved)).not.toContain('data:image');
    cache.clear();
    const input = readImageGenerationRecipe(saved[0])!;
    await expect(
      validateRestoredImageReferences(input.images!)
    ).rejects.toThrow('原参考图 1');
    await restoreEmbeddedMedia(embedded);
    await expect(
      validateRestoredImageReferences(input.images!)
    ).resolves.toBeUndefined();
    expect(input.prompt).toBe('原提示词');
    expect(input.images).toHaveLength(1);
    expect(input.images![0].url).not.toBe(element.url);
  });

  it('backs up cached generation-node references and masks without a task history', async () => {
    const url = '/__aitu_cache__/image/node-reference.png';
    const mask = '/__aitu_cache__/image/node-mask.png';
    cache.set(url, new Blob(['reference'], { type: 'image/png' }));
    cache.set(mask, new Blob(['mask'], { type: 'image/png' }));
    const elements = [{ id: 'node', type: 'geometry', generationNode: { version: 1, generationType: 'image', prompt: 'saved', params: {}, count: 1, references: [{ referenceId: 'a', role: 'reference', url, maskImage: mask, name: 'A' }] } }];
    elements.push({ id: 'progress', type: 'generation-anchor', generationOrigin: { version: 1, draft: structuredClone(elements[0]) } } as any);
    const exported = JSON.parse(JSON.stringify(elements));
    const embedded = await collectEmbeddedMediaFromElements(exported);
    expect(embedded).toHaveLength(2);
    cache.clear();
    await restoreEmbeddedMedia(embedded);
    expect(cache.has(url)).toBe(true);
    expect(cache.has(mask)).toBe(true);
    expect(exported[0].generationNode.references[0].referenceId).toBe('a');
  });

  it('does not bind a copied or replaced source to the wrong live canvas object', () => {
    const input = {
      generationType: 'image' as const,
      prompt: 'prompt',
      images: [
        {
          name: 'A',
          url: '/snapshot.png',
          sourceElementId: 'a',
          sourceElementUrl: '/original.png',
        },
      ],
    };
    expect(
      resolveRecipeCanvasSources(input, [{ id: 'a', url: '/original.png' }])
        .images![0].sourceElementId
    ).toBe('a');
    expect(
      resolveRecipeCanvasSources(input, [{ id: 'a', url: '/new.png' }])
        .images![0]
    ).toMatchObject({ url: '/snapshot.png', sourceElementId: undefined });
    expect(
      resolveRecipeCanvasSources(input, []).images![0].sourceElementId
    ).toBeUndefined();
  });

  it('refuses a missing cached reference and an unknown saved version', async () => {
    const original = task();
    original.params.referenceImages = ['/__aitu_cache__/image/missing.png'];
    await expect(prepareImageGenerationRecipe(original)).rejects.toThrow(
      '缓存缺失'
    );
    expect(getPreparedImageRecipe(original)).toBeUndefined();
    expect(() =>
      readImageGenerationRecipe({
        imageGenerationRecipe: { version: 2, input: {} },
      })
    ).toThrow('无法读取');
  });
});

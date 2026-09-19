import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildTuziGPTImageRequestBody,
  tuziGPTImageAdapter,
} from '../model-adapters/tuzi-gpt-image-adapter';
import { buildGPTImageEditFormData, gptImageAdapter } from '../model-adapters/gpt-image-adapter';
import { seedreamImageAdapter } from '../model-adapters/seedream-adapter';
import type { AdapterContext } from '../model-adapters/types';
import { resolveOfficialGPTImageSize } from '../model-adapters/image-size-quality-resolver';
import {
  mergeImageGenerationParams,
  prepareImageGenerationRequest,
  remapImageReferenceMetadata,
} from '../model-adapters/image-generation-intent';

const mocks = vi.hoisted(() => ({ naturalSize: vi.fn(), send: vi.fn() }));
vi.mock('../../utils/image-natural-size', () => ({
  getImageNaturalSize: mocks.naturalSize,
}));
vi.mock('../model-adapters/context', () => ({
  sendAdapterRequest: mocks.send,
}));
const context = { baseUrl: 'https://example.invalid/v1' };
const reference = 'data:image/png;base64,eA==';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.naturalSize.mockResolvedValue({ width: 1086, height: 1448 });
  mocks.send.mockImplementation(async () => new Response(JSON.stringify({
    data: [{ url: 'https://example.invalid/result.png', width: 2480, height: 3312 }],
  }), { headers: { 'Content-Type': 'application/json' } }));
});

describe('image resolution intent', () => {
  it('keeps 1K auto sizing compatible when no ratio is available', async () => {
    await tuziGPTImageAdapter.generateImage(context, {
      model: 'gpt-image-2',
      prompt: 'test',
      size: 'auto',
      params: { resolution: '1k' },
    });
    const body = JSON.parse(mocks.send.mock.calls[0][1].body);
    expect(body.size).toBeUndefined();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it.each(['2k', '4k'].flatMap((resolution) =>
    ['auto', undefined].map((size) => ({ resolution, size }))
  ))(
    'rejects $size + $resolution without a ratio or reference image',
    async ({ resolution, size }) => {
      await expect(tuziGPTImageAdapter.generateImage(context, {
        model: 'gpt-image-2',
        prompt: 'test',
        size,
        params: { resolution },
      })).rejects.toThrow('必须明确图片比例或提供参考图');
      expect(mocks.send).not.toHaveBeenCalled();
    }
  );

  it.each([gptImageAdapter, tuziGPTImageAdapter])(
    '$id rejects legacy quality tiers for a custom model on the GPT protocol',
    async (adapter) => {
      await expect(adapter.generateImage(context, {
        model: 'custom-image-model', prompt: 'test', size: 'auto', params: { quality: '4k' },
      })).rejects.toThrow('必须明确图片比例或提供参考图');
      expect(mocks.send).not.toHaveBeenCalled();
    }
  );

  it.each(['custom-image-model', 'GPT-IMAGE-2', undefined])(
    'prepares reference metadata independently of model label %s',
    async (model) => {
      const request = await prepareImageGenerationRequest({
        model, prompt: 'test', size: 'auto', referenceImages: [reference],
        params: { resolution: '4k' },
      });
      expect(request.size).toBe('3x4');
      expect(request.params).toMatchObject({
        resolution: '4k',
        referenceImageMetadata: [{ url: reference, width: 1086, height: 1448 }],
      });
    }
  );

  it('prepares a reference-free custom request without inventing a ratio or reading images', async () => {
    const request = { model: 'custom-image-model', prompt: 'test', size: 'auto', params: { resolution: '4k' } };
    expect(await prepareImageGenerationRequest(request)).toEqual(request);
    expect(mocks.naturalSize).not.toHaveBeenCalled();
  });

  it.each(['1024x1024', '2048x2048'])(
    'maps %s to the selected 4K tier',
    (size) => {
      expect(
        buildTuziGPTImageRequestBody({
          model: 'gpt-image-2',
          prompt: 'test',
          size,
          params: { resolution: '4k', quality: 'high' },
        })
      ).toMatchObject({ size: '2880x2880', quality: 'high' });
    }
  );

  it('preserves an explicitly supplied pixel size when no tier was selected', () => {
    expect(resolveOfficialGPTImageSize('gpt-image-2', '1024x1024')).toBe(
      '1024x1024'
    );
  });

  it.each(['gpt-image-2.5-1k', 'gpt-image-2.5', 'gpt-image-2.5-vip'])(
    'keeps %s on standard sizes and rejects unsupported tiers',
    (model) => {
      expect(resolveOfficialGPTImageSize(model, '1024x1536')).toBe('1024x1536');
      expect(() => resolveOfficialGPTImageSize(model, '1024x1536', { resolution: '4k' }))
        .toThrow('不支持所选分辨率');
    }
  );

  it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
    'preserves %s extended quality while applying the 4K tier',
    (model) => {
      expect(buildTuziGPTImageRequestBody({
        model, prompt: 'test', size: '16x9', params: { resolution: '4k', quality: 'max' },
      })).toMatchObject({ model, size: '3840x2160', quality: 'max' });
    }
  );

  it('keeps a near-square reference near-square instead of turning it into 9:16', () => {
    const size = resolveOfficialGPTImageSize('gpt-image-2', '1000x1001', {
      resolution: '4k',
    })!;
    const [width, height] = size.split('x').map(Number);
    expect(Math.abs(width / height - 1000 / 1001)).toBeLessThan(0.01);
    expect(width * height).toBeLessThanOrEqual(8_294_400);
    expect(width % 16).toBe(0);
    expect(height % 16).toBe(0);
  });

  it.each(['0x1024', '100x1', 'invalid'])('rejects invalid size %s', (size) => {
    expect(() =>
      resolveOfficialGPTImageSize('gpt-image-2', size, { resolution: '4k' })
    ).toThrow();
  });

  it('rejects invalid resolution instead of falling back to 1K', () => {
    expect(() =>
      resolveOfficialGPTImageSize('gpt-image-2', '1x1', { resolution: '8k' })
    ).toThrow();
  });

  it('resolves the first reference from URL-keyed metadata', async () => {
    await tuziGPTImageAdapter.generateImage(context, {
      model: 'gpt-image-2',
      prompt: 'test',
      size: 'auto',
      referenceImages: [reference, 'second'],
      params: {
        resolution: '4k',
        referenceImageMetadata: [
          { url: 'second', width: 1600, height: 900 },
          { url: reference, width: 1086, height: 1448 },
        ],
      },
    });
    expect(JSON.parse(mocks.send.mock.calls[0][1].body).size).toBe('2480x3312');
    expect(mocks.naturalSize).not.toHaveBeenCalled();
  });

  it('decodes the first legacy reference instead of borrowing the second image dimensions', async () => {
    const request = await prepareImageGenerationRequest({
      prompt: 'test',
      size: 'auto',
      referenceImages: [reference, 'second'],
      params: {
        referenceImageMetadata: [{ url: 'second', width: 1600, height: 900 }],
      },
    });
    expect(mocks.naturalSize).toHaveBeenCalledWith(reference, 0, 0);
    expect(request.size).toBe('3x4');
    expect(request.params?.referenceImageMetadata).toEqual([
      { url: 'second', width: 1600, height: 900 },
      { url: reference, width: 1086, height: 1448 },
    ]);
  });

  it('does not override an explicit aspect ratio using reference dimensions', async () => {
    const request = await prepareImageGenerationRequest({
      prompt: 'test',
      size: '16x9',
      referenceImages: [reference],
    });
    expect(request.size).toBe('16x9');
    expect(mocks.naturalSize).not.toHaveBeenCalled();
  });

  it('fails before submission if the first reference dimensions cannot be read', async () => {
    mocks.naturalSize.mockResolvedValue({ width: 0, height: 0 });
    await expect(
      tuziGPTImageAdapter.generateImage(context, {
        model: 'gpt-image-2',
        prompt: 'test',
        size: 'auto',
        referenceImages: [reference],
        params: { resolution: '4k' },
      })
    ).rejects.toThrow('第一张参考图');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('uses the same resolved tier for multipart edits', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-2',
      prompt: 'test',
      size: 'auto',
      referenceImages: [reference],
      params: {
        resolution: '4k',
        referenceImageMetadata: [{ url: reference, width: 1086, height: 1448 }],
      },
    });
    expect(body.get('size')).toBe('2480x3312');
  });

  it('preserves task-level precedence and reference metadata', () => {
    expect(
      mergeImageGenerationParams({
        size: 'auto',
        resolution: '4k',
        quality: 'high',
        uploadedImages: [{ url: reference, width: 1086, height: 1448 }],
        params: { size: '1x1', resolution: '1k', quality: 'low' },
      })
    ).toMatchObject({
      size: 'auto',
      resolution: '4k',
      quality: 'high',
      referenceImageMetadata: [{ url: reference, width: 1086, height: 1448 }],
    });
  });

  it('fills partial metadata from uploads without discarding other references', () => {
    const params = mergeImageGenerationParams({
      uploadedImages: [
        { url: reference, width: 1086, height: 1448 },
        { url: 'second' },
      ],
      uploadedImage: { url: 'legacy', width: 2000, height: 1000 },
      params: { referenceImageMetadata: [
        { url: reference, width: 99 },
        { url: 'second', width: 1600, height: 900 },
      ] },
    });
    expect(params.referenceImageMetadata).toEqual([
      { url: reference, width: 1086, height: 1448 },
      { url: 'second', width: 1600, height: 900 },
      { url: 'legacy', width: 2000, height: 1000 },
    ]);
  });

  it('remaps dimensions with URL conversion without borrowing another reference dimensions', async () => {
    const metadata = remapImageReferenceMetadata([
      { url: 'second', width: 1600, height: 900 },
      { url: 'third', width: 1086, height: 1448 },
    ], ['first', 'second', 'third'], [reference, 'second-data', reference]);
    expect(metadata).toEqual([
      { url: reference, width: 1086, height: 1448 },
      { url: 'second-data', width: 1600, height: 900 },
    ]);
    const request = await prepareImageGenerationRequest({
      prompt: 'test', size: 'auto', referenceImages: [reference, 'second-data'],
      params: { referenceImageMetadata: metadata },
    });
    expect(request.size).toBe('3x4');
    expect(mocks.naturalSize).not.toHaveBeenCalled();
  });
});

describe('Seedream resolution intent', () => {
  it('uses the binding model for tier validation and submission instead of a stale lite model', async () => {
    await seedreamImageAdapter.generateImage({ ...context,
      binding: { modelId: 'doubao-seedream-5-0-pro-260628' } as AdapterContext['binding'],
    }, {
      model: 'doubao-seedream-5-0-260128', prompt: 'test', size: '1x1',
      params: { resolution: '4k' },
    });
    expect(JSON.parse(mocks.send.mock.calls[0][1].body)).toMatchObject({
      model: 'doubao-seedream-5-0-pro-260628', size: '4096x4096',
    });
  });

  it('rejects 4K for the effective lite model even when the old model supported it', async () => {
    await expect(seedreamImageAdapter.generateImage(context, {
      model: 'doubao-seedream-4-5-251128', prompt: 'test', size: '1x1',
      modelRef: { profileId: 'custom', modelId: 'doubao-seedream-5-0-260128' },
      params: { resolution: '4k' },
    })).rejects.toThrow('仅支持');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('preserves automatic sizing when no tier was explicitly requested', async () => {
    await seedreamImageAdapter.generateImage(context, {
      model: 'doubao-seedream-5-0-260128', prompt: 'test', size: 'auto',
    });
    expect(JSON.parse(mocks.send.mock.calls[0][1].body).size).toBeUndefined();
  });

  it.each([
    { model: 'doubao-seedream-5-0-260128', size: 'auto', params: { resolution: '2k' } },
    { model: 'doubao-seedream-5-0-260128', size: undefined, params: { seedream_quality: '3k' } },
    { model: 'doubao-seedream-4-5-251128', size: 'auto', params: { seedream_quality: '4k' } },
    { model: 'doubao-seedream-5-0-pro-260628', size: undefined, params: { resolution: '4k' } },
  ])('rejects $model auto sizing with an explicit tier and no reference image', async (request) => {
    await expect(seedreamImageAdapter.generateImage(context, {
      ...request, prompt: 'test',
    })).rejects.toThrow('必须明确图片比例或提供参考图');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(['1x1', '1024x1024'])('honors canonical 4K for %s', async (size) => {
    await seedreamImageAdapter.generateImage(context, {
      model: 'doubao-seedream-4-5-251128',
      prompt: 'test',
      size,
      params: { resolution: '4k', seedream_quality: '2k' },
    });
    expect(JSON.parse(mocks.send.mock.calls[0][1].body).size).toBe('4096x4096');
  });

  it('uses reference aspect ratio and legacy tier together', async () => {
    await seedreamImageAdapter.generateImage(context, {
      model: 'doubao-seedream-4-5-251128',
      prompt: 'test',
      size: 'auto',
      referenceImages: [reference],
      params: { seedream_quality: '4k' },
    });
    expect(JSON.parse(mocks.send.mock.calls[0][1].body).size).toBe('3520x4693');
  });

  it('rejects unsupported 4K on Seedream 5 lite', async () => {
    await expect(
      seedreamImageAdapter.generateImage(context, {
        model: 'doubao-seedream-5-0-260128',
        prompt: 'test',
        size: '1x1',
        params: { resolution: '4k' },
      })
    ).rejects.toThrow('仅支持');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

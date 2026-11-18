import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCompatibleParams,
  getStaticModelConfig,
  ModelVendor,
} from '../constants/model-config';
import { getViduVideoContract } from '../constants/vidu-video-models';
import { getVideoModelConfig } from '../constants/video-model-config';
import { buildTuziVideoRequest } from './tuzi-video-request';
import {
  submitVideoGeneration,
  queryVideoStatus,
  pollVideoUntilComplete,
} from './media-api/video-api';
import { inferBindingsForProviderModel } from './provider-routing/binding-inference';
import {
  extractInlineVideoUrl,
  getEffectiveVideoCompatibleParams,
  shouldDownloadVideoContent,
} from './video-binding-utils';

const first = 'https://images.example.test/first.png';
const last = 'https://images.example.test/last.png';
const models = [
  ['viduq3-ad', 3, 15, ['720p', '1080p']],
  ['viduq3-drama', 2, 16, ['720p', '1080p']],
  ['viduq3', 3, 16, ['540p', '720p', '1080p']],
  ['viduq3-turbo', 1, 16, ['540p', '720p', '1080p']],
  ['viduq3-pro-fast', 1, 16, ['720p', '1080p']],
  ['viduq3-pro', 1, 16, ['540p', '720p', '1080p']],
  ['viduq4-preview', 3, 16, ['540p', '720p', '1080p', '2K', '4K']],
  ['viduq3-mix', 3, 15, ['720p', '1080p']],
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Vidu video contracts', () => {
  it.each(models)(
    'exposes exact limits and Vidu identity for %s',
    (model, min, max, sizes) => {
      const config = getVideoModelConfig(model);
      expect(getStaticModelConfig(model)).toMatchObject({
        type: 'video',
        vendor: ModelVendor.VIDU,
      });
      expect(config.durationOptions[0].value).toBe(String(min));
      expect(config.durationOptions.at(-1)?.value).toBe(String(max));
      expect(config.sizeOptions.map((option) => option.value)).toEqual(sizes);
      const controls = getCompatibleParams(model).map((param) => param.id);
      expect(controls).not.toEqual(expect.arrayContaining(['ratio']));
      for (const id of ['audio', 'off_peak', 'video_media'])
        expect(controls).not.toContain(id);
      expect(controls.includes('watermark')).toBe(model === 'viduq3-mix');
      const modelConfig = getStaticModelConfig(model);
      if (!modelConfig) throw new Error(`Missing model ${model}`);
      const binding = inferBindingsForProviderModel(
        {
          id: 'vidu-test',
          name: 'test',
          providerType: 'openai-compatible',
          baseUrl: 'https://apioss.tu-zi.com/v1',
          apiKey: 'test',
          enabled: true,
        },
        modelConfig
      );
      expect(
        binding.find((entry) => entry.protocol === 'openai.async.video')
      ).toMatchObject({
        submitPath: '/videos',
        baseUrlStrategy: 'ensure-v1',
        requestSchema: 'tuzi.video.generation-json',
        metadata: { video: { durationField: 'duration' } },
      });
    }
  );

  it('does not apply these contracts to unknown Vidu versions', async () => {
    expect(getViduVideoContract('viduq3-ad-preview')).toBeUndefined();
    expect(getViduVideoContract('constructor')).toBeUndefined();
    expect(
      await buildTuziVideoRequest({ model: 'viduq5', prompt: 'test' })
    ).toBeNull();
  });

  it.each([
    ['viduq3-ad', [first], 'referenceGenerate'],
    ['viduq3-drama', [first], 'referenceGenerate'],
    ['viduq3', [first, last], 'referenceGenerate'],
    ['viduq3-mix', [first], 'referenceGenerate'],
    ['viduq3-turbo', [], 'textGenerate'],
    ['viduq3-turbo', [first], 'generate'],
    ['viduq3-turbo', [first, last], 'firstTailGenerate'],
    ['viduq3-turbo', [first, last, first], 'referenceGenerate'],
    ['viduq3-pro', [], 'textGenerate'],
    ['viduq3-pro', [first], 'generate'],
    ['viduq3-pro', [first, last], 'firstTailGenerate'],
    ['viduq3-pro-fast', [first], 'generate'],
    ['viduq3-pro-fast', [first, last], 'firstTailGenerate'],
    ['viduq4-preview', [first], 'generate'],
    ['viduq4-preview', [first, last], 'referenceGenerate'],
  ])('builds the native %s action %s', async (model, images, action) => {
    const result = await buildTuziVideoRequest({
      model: String(model),
      prompt: 'animate',
      referenceImages: images as string[],
      params: model === 'viduq3-mix'
        ? { aspect_ratio: '9:16', watermark: false, seed: 0 }
        : { ratio: '9:16', audio: false, watermark: true, off_peak: true },
    });
    expect(result).toEqual({
      model,
      prompt: 'animate',
      duration: model === 'viduq3-drama' ? 8 : 5,
      ...(model === 'viduq3-mix'
        ? { resolution: '720p', aspect_ratio: '9:16', watermark: false, seed: 0 }
        : { size: model === 'viduq3-drama' ? '1080p' : '720p' }),
      metadata: { action },
      ...((images as string[]).length ? { images } : {}),
    });
  });

  it('preserves an explicit reference action and the complete image order', async () => {
    expect(
      await buildTuziVideoRequest({
        model: 'viduq3-turbo',
        prompt: 'animate',
        duration: 3,
        referenceImages: [last, first],
        params: { vidu_action: 'referenceGenerate' },
      })
    ).toMatchObject({
      images: [last, first],
      metadata: { action: 'referenceGenerate' },
    });
    expect(
      await buildTuziVideoRequest({
        model: 'viduq4-preview',
        prompt: 'animate',
        size: '4K',
        params: { images: [first], metadata: { action: 'referenceGenerate' } },
      })
    ).toMatchObject({
      size: '4K',
      images: [first],
      metadata: { action: 'referenceGenerate' },
    });
  });

  it.each([
    { model: 'viduq3-ad', referenceImages: [] },
    { model: 'viduq3-pro-fast', referenceImages: [] },
    {
      model: 'viduq3-pro',
      referenceImages: [first],
      params: { vidu_action: 'textGenerate' },
    },
    {
      model: 'viduq3-pro',
      referenceImages: [first],
      params: { vidu_action: 'firstTailGenerate' },
    },
    {
      model: 'viduq3-pro',
      referenceImages: [first, last],
      params: { vidu_action: 'generate' },
    },
    {
      model: 'viduq3-pro-fast',
      referenceImages: [first],
      params: { vidu_action: 'referenceGenerate' },
    },
    { model: 'viduq3-ad', referenceImages: [first], size: '540p' },
    {
      model: 'viduq3-turbo',
      referenceImages: [first],
      duration: 1,
      params: { vidu_action: 'referenceGenerate' },
    },
    {
      model: 'viduq3-turbo',
      referenceImages: [first],
      duration: 16,
      params: { vidu_action: 'referenceGenerate' },
    },
    { model: 'viduq3-ad', referenceImages: [first], duration: 3.5 },
    {
      model: 'viduq3-ad',
      referenceImages: [first],
      params: { metadata: { duration: 15 } },
    },
    {
      model: 'viduq3-ad',
      referenceImages: ['https://media.example.test/a.mp4'],
    },
    {
      model: 'viduq3-ad',
      referenceImages: [first],
      params: { video_media: [{ type: 'video', url: last }] },
    },
    {
      model: 'viduq3-ad',
      referenceImages: [first],
      params: { sounds: ['https://media.example.test/a.mp3'] },
    },
  ])('rejects an invalid Vidu request: %j', async (request) => {
    await expect(
      buildTuziVideoRequest({ prompt: 'animate', ...request })
    ).rejects.toThrow();
  });

  it.each([
    ['viduq3-ad', 7],
    ['viduq4-preview', 15],
  ] as const)('enforces the reference count for %s', async (model, count) => {
    const request = {
      model,
      prompt: 'animate',
      params: { vidu_action: 'referenceGenerate' },
    };
    expect(
      (
        await buildTuziVideoRequest({
          ...request,
          referenceImages: Array(count).fill(first),
        })
      )?.images
    ).toHaveLength(count);
    await expect(
      buildTuziVideoRequest({
        ...request,
        referenceImages: Array(count + 1).fill(first),
      })
    ).rejects.toThrow(`1–${count}`);
  });

  it('accepts documented Mix audio URLs and rejects protected or excessive audio', async () => {
    const request = {
      model: 'viduq3-mix',
      prompt: 'animate',
      referenceImages: [first],
    };
    const sounds = ['https://media.example.test/a.mp3'];
    expect(
      (await buildTuziVideoRequest({ ...request, params: { sounds } }))?.sounds
    ).toEqual(sounds);
    await expect(
      buildTuziVideoRequest({
        ...request,
        params: { sounds: Array(4).fill(sounds[0]) },
      })
    ).rejects.toThrow('3');
    await expect(
      buildTuziVideoRequest({
        ...request,
        params: { sounds: ['blob:private-audio'] },
      })
    ).rejects.toThrow('公网');
  });

  it('sends the effective Mix controls on the shared JSON transport', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ id: 'task_mix', status: 'queued' }));
    await submitVideoGeneration({
      model: 'viduq3-mix', prompt: 'animate', referenceImages: [first, last],
      duration: 5, size: '720p', params: {
        resolution: '720p', aspect_ratio: '1:1', seed: 89, watermark: true, wm_position: '4',
        vidu_sound_urls: 'https://media.example.test/overridden.mp3',
        wm_url: first, payload: ' trace ', meta_data: '{"Label":"mix"}',
        callback_url: 'https://media.example.test/events',
        metadata: { resolution: '1080P', duration: 7, aspect_ratio: 'auto', seed: 0, watermark: false,
          sounds: ['https://media.example.test/a.mp3'], model: 'another-model' },
      },
    }, { baseUrl: 'https://api.example.test/v1', apiKey: 'test', fetchImpl });
    const [endpoint, init] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe('https://api.example.test/v1/videos');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'viduq3-mix', prompt: 'animate', images: [first, last], metadata: { action: 'referenceGenerate' },
      duration: 7, resolution: '1080p', aspect_ratio: 'auto', seed: 0, watermark: false,
      wm_position: 4, wm_url: first, payload: ' trace ', meta_data: '{"Label":"mix"}',
      callback_url: 'https://media.example.test/events', sounds: ['https://media.example.test/a.mp3'],
    });
  });

  it.each([
    { referenceImages: [] }, { prompt: '猫'.repeat(5001) },
    { params: { metadata: { audio: false } } }, { params: { off_peak: true } },
    { params: { action: 'textGenerate' } }, { params: { subjects: [] } },
    { params: { wm_position: 5 } }, { params: { meta_data: 'invalid' } },
    { params: { payload: {} } }, { params: { aspect_ratio: '21:9' } },
    { params: { seed: '9007199254740993' } },
  ])('rejects invalid Mix input before submitting', async (input) => {
    const fetchImpl = vi.fn();
    await expect(submitVideoGeneration(
      { model: 'viduq3-mix', prompt: 'animate', referenceImages: [first], ...input },
      { baseUrl: 'https://api.example.test/v1', apiKey: 'test', fetchImpl }
    )).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('narrows Turbo duration controls for explicit reference mode without changing other models', () => {
    const options = (action: string) =>
      getEffectiveVideoCompatibleParams(
        'viduq3-turbo',
        'viduq3-turbo',
        { vidu_action: action },
        null
      )
        .find((param) => param.id === 'duration')
        ?.options?.map((option) => option.value) || [];
    expect(options('referenceGenerate')).toHaveLength(13);
    expect(options('referenceGenerate')).not.toContain('1');
    expect(options('referenceGenerate')).not.toContain('16');
    expect(options('generate')).toHaveLength(16);
  });

  it.each(['https://apioss.tu-zi.com', 'https://apioss.tu-zi.com/v1'])(
    'uses JSON submission and polling under exactly one v1 at %s',
    async (baseUrl) => {
      const fetchImpl = vi.fn(async () =>
        Response.json({ id: 'task_vidu', status: 'queued' })
      );
      const config = {
        baseUrl,
        apiKey: 'test',
        defaultModel: 'viduq3-ad',
        fetchImpl,
      };
      expect(
        await submitVideoGeneration(
          {
            model: 'viduq3-ad',
            prompt: 'animate',
            duration: 3,
            referenceImages: [first],
          },
          config
        )
      ).toBe('task_vidu');
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(
        'http://localhost:3000/__opentu_tuzi_apioss__/v1/videos'
      );
      const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(init.body))).toEqual({
        model: 'viduq3-ad',
        prompt: 'animate',
        duration: 3,
        size: '720p',
        images: [first],
        metadata: { action: 'referenceGenerate' },
      });
      await queryVideoStatus('task_vidu', config);
      expect(fetchImpl.mock.calls[1]?.[0]).toBe(
        'http://localhost:3000/__opentu_tuzi_apioss__/v1/videos/task_vidu'
      );
    }
  );

  it('materializes cached local image data and rejects excessive total request size', async () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
    const resolve = vi.fn(async () => png);
    expect(
      (
        await buildTuziVideoRequest(
          {
            model: 'viduq3-ad',
            prompt: 'animate',
            referenceImages: ['blob:cached-image'],
          },
          resolve
        )
      )?.images
    ).toEqual([png]);
    expect(resolve).toHaveBeenCalledOnce();
    const huge = `https://images.example.test/a.png?${'x'.repeat(
      20 * 1024 * 1024
    )}`;
    await expect(
      buildTuziVideoRequest({
        model: 'viduq3-ad',
        prompt: 'animate',
        referenceImages: [huge],
      })
    ).rejects.toThrow('20 MB');
  });

  it('extracts completed metadata URLs without downloading or submitting again', () => {
    const payload = {
      status: 'completed',
      metadata: { url: 'https://video.example.test/out.mp4' },
    };
    expect(extractInlineVideoUrl(payload)).toBe(payload.metadata.url);
    expect(shouldDownloadVideoContent('viduq3-ad', null, payload)).toBe(false);
    expect(
      shouldDownloadVideoContent('viduq3-ad', null, { status: 'completed' })
    ).toBe(true);
  });

  it('polls through an early completed_at field and recovers the original task only', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 'task_vidu',
          status: 'in_progress',
          completed_at: 123,
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'task_vidu',
          status: 'completed',
          metadata: { url: 'https://video.example.test/out.mp4' },
        })
      );
    const result = await pollVideoUntilComplete(
      'task_vidu',
      {
        baseUrl: 'https://apioss.tu-zi.com',
        apiKey: 'test',
        defaultModel: 'viduq3-ad',
        fetchImpl,
      },
      { interval: 1 }
    );
    expect(result.status).toBe('completed');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      fetchImpl.mock.calls.every(
        ([input]) =>
          input ===
          'http://localhost:3000/__opentu_tuzi_apioss__/v1/videos/task_vidu'
      )
    ).toBe(true);
  });

  it('surfaces a failed provider task without submitting or retrying it', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        id: 'task_vidu',
        status: 'failed',
        error: { message: 'invalid upstream reference' },
      })
    );
    await expect(
      pollVideoUntilComplete('task_vidu', {
        baseUrl: 'https://apioss.tu-zi.com/v1',
        apiKey: 'test',
        defaultModel: 'viduq3-ad',
        fetchImpl,
      })
    ).rejects.toThrow('invalid upstream reference');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

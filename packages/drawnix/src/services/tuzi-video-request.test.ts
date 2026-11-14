import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCompatibleParams,
  getStaticModelConfig,
} from '../constants/model-config';
import { TUZI_VIDEO_MODEL_CONFIGS } from '../constants/tuzi-video-models';
import { getVideoModelConfig } from '../constants/video-model-config';
import { queryVideoStatus, submitVideoGeneration } from './media-api/video-api';
import { submitHappyHorseVideo } from './model-adapters/happyhorse-adapter';
import { inferBindingsForProviderModel } from './provider-routing/binding-inference';
import { shouldDownloadVideoContent } from './video-binding-utils';
import { buildTuziVideoRequest } from './tuzi-video-request';

afterEach(() => vi.restoreAllMocks());

describe('Tuzi video model contracts', () => {
  it.each(Object.keys(TUZI_VIDEO_MODEL_CONFIGS))(
    'exposes compatible defaults and limits for %s',
    (id) => {
      const model = getStaticModelConfig(id)!;
      const config = getVideoModelConfig(id);
      const params = getCompatibleParams(id);
      expect(model.type).toBe('video');
      expect(model.videoDefaults?.duration).toBe(config.defaultDuration);
      expect(model.videoDefaults?.size).toBe(config.defaultSize);
      expect(
        params
          .find((param) => param.id === 'duration')
          ?.options?.map((option) => option.value)
      ).toEqual(config.durationOptions.map((option) => option.value));
      expect(
        params
          .find((param) => param.id === 'size')
          ?.options?.map((option) => option.value)
      ).toEqual(config.sizeOptions.map((option) => option.value));
      if (id.startsWith('gemini'))
        expect(params.some((param) => param.id === 'watermark')).toBe(false);
      if (id.endsWith('-i2v'))
        expect(params.some((param) => param.id === 'ratio')).toBe(false);
    }
  );

  it('keeps legacy HappyHorse resolution and unknown future versions separate', () => {
    expect(
      getVideoModelConfig('happyhorse-1.0-i2v').sizeOptions.map(
        (option) => option.value
      )
    ).not.toContain('480P');
    expect(getStaticModelConfig('happyhorse-1.1-video-edit')).toBeUndefined();
    expect(
      getStaticModelConfig('gemini-omni-1.2-flash-preview')
    ).toBeUndefined();
  });

  it('uses the async video binding for Kling 4.0 and preserves legacy Kling', () => {
    const profile = {
      id: 'test',
      name: 'test',
      providerType: 'openai-compatible' as const,
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'test',
      enabled: true,
    };
    const bindings = inferBindingsForProviderModel(
      profile,
      getStaticModelConfig('kling-4.0')!
    );
    expect(bindings.some((binding) => binding.protocol === 'kling.video')).toBe(
      false
    );
    expect(
      bindings.find((binding) => binding.protocol === 'openai.async.video')
    ).toMatchObject({
      submitPath: '/videos',
      pollPathTemplate: '/videos/{taskId}',
      metadata: {
        video: {
          defaultDuration: '10',
          downloadPathTemplate: '/videos/{taskId}/content',
        },
      },
    });
    expect(
      inferBindingsForProviderModel(
        profile,
        getStaticModelConfig('kling_video')!
      ).some((binding) => binding.protocol === 'kling.video')
    ).toBe(true);
  });

  it.each(['t2v', 'i2v', 'r2v'])(
    'builds HappyHorse 1.1 %s with its own image fields',
    async (mode) => {
      const images = [
        'https://images.example.test/first.png',
        'https://images.example.test/second.png',
      ];
      const body = await buildTuziVideoRequest({
        model: `happyhorse-1.1-${mode}`,
        prompt: mode === 'i2v' ? '' : 'animate [Image 1]',
        duration: 3,
        size: '480P',
        referenceImages:
          mode === 't2v' ? [] : mode === 'i2v' ? images.slice(0, 1) : images,
        params: {
          seed: '0',
          watermark: 'false',
          ratio: '9:16',
          audio_setting: 'origin',
        },
      });
      expect(body?.parameters).toMatchObject({
        duration: 3,
        resolution: '480P',
        seed: 0,
        watermark: false,
      });
      expect(body?.parameters).not.toHaveProperty('audio_setting');
      if (mode === 'i2v') {
        expect(body?.image).toBe(images[0]);
        expect(body?.parameters).not.toHaveProperty('ratio');
        expect(body).not.toHaveProperty('images');
      } else {
        expect(body?.parameters).toHaveProperty('ratio', '9:16');
        expect(body).not.toHaveProperty('image');
        if (mode === 'r2v') expect(body?.images).toEqual(images);
        else expect(body).not.toHaveProperty('images');
      }
    }
  );

  it('maps Wan duration/resolution and first/last frames without generic fields', async () => {
    expect(
      await buildTuziVideoRequest({
        model: 'wan3.0-video',
        prompt: 'animate',
        duration: 30,
        size: '480P',
        params: { ratio: '9:16', watermark: 'false' },
        referenceImages: [
          'https://example.test/first.png',
          'https://example.test/last.png',
        ],
      })
    ).toEqual({
      model: 'wan3.0-video',
      prompt: 'animate',
      duration: 30,
      resolution: '480P',
      ratio: '9:16',
      watermark: false,
      first_frame: 'https://example.test/first.png',
      last_frame: 'https://example.test/last.png',
    });
  });

  it('omits unsupported Omni controls and keeps public image URLs', async () => {
    expect(
      await buildTuziVideoRequest({
        model: 'gemini-omni-1.2-flash',
        prompt: 'animate',
        duration: 15,
        size: '2160x3840',
        referenceImages: ['https://example.test/image.webp'],
        params: { watermark: true, model_name: 'old', generate_audio: false },
      })
    ).toEqual({
      model: 'gemini-omni-1.2-flash',
      prompt: 'animate',
      seconds: '15',
      size: '2160x3840',
      input_reference: 'https://example.test/image.webp',
    });
  });

  it.each([0, 1, 10])(
    'submits %s Kling images with the EPhone contents contract',
    async (count) => {
      const referenceImages = Array.from(
        { length: count },
        (_, index) => `https://example.test/${index}.png`
      );
      const fetchImpl = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          // EPhone rejects input_reference and mixing prompt with contents. Assert
          // the full wire body, including stable IDs required by multiple images.
          expect(JSON.parse(String(init?.body))).toEqual({
            model: 'kling-4.0',
            contents: [
              { type: 'prompt', text: 'animate' },
              ...referenceImages.map((url, index) => ({
                type: 'refer_image',
                url,
                id: `image_${index + 1}`,
              })),
            ],
            settings: { duration: 3, resolution: '720p', aspect_ratio: '21:9' },
            options: { watermark_info: { enabled: false } },
          });
          return new Response(JSON.stringify({ id: 'task', status: 'queued' }));
        }
      );
      await submitVideoGeneration(
        {
          model: 'kling-4.0',
          prompt: 'animate',
          duration: 3,
          size: '1680x720',
          referenceImages,
          params: { watermark: 'false' },
        },
        {
          baseUrl: 'https://api.example.test/v1',
          apiKey: 'test',
          fetchImpl,
        }
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  );

  it.each(getVideoModelConfig('kling-4.0').sizeOptions)(
    'preserves Kling resolution and ratio for $label',
    async (option) => {
      const body = await buildTuziVideoRequest({
        model: 'kling-4.0',
        prompt: 'animate',
        size: option.value,
        params: { watermark: true },
      });
      expect(body).toMatchObject({
        settings: {
          duration: 10,
          resolution: option.label.startsWith('720p') ? '720p' : '1080p',
          aspect_ratio: option.aspectRatio,
        },
        options: { watermark_info: { enabled: true } },
      });
      expect(body).not.toHaveProperty('prompt');
      expect(body).not.toHaveProperty('size');
      expect(body).not.toHaveProperty('seconds');
      expect(body).not.toHaveProperty('input_reference');
    }
  );

  it('keeps local PNG references and omits unset Kling watermark options', async () => {
    const resolveImage = vi.fn(async () => 'data:image/png;base64,AQID');
    const body = await buildTuziVideoRequest(
      {
        model: 'kling-4.0',
        prompt: 'animate',
        referenceImages: ['blob:local'],
      },
      resolveImage
    );
    expect(body?.contents).toEqual([
      { type: 'prompt', text: 'animate' },
      { type: 'refer_image', url: 'data:image/png;base64,AQID', id: 'image_1' },
    ]);
    expect(body).not.toHaveProperty('options');
    expect(resolveImage).toHaveBeenCalledWith('blob:local');
  });

  it.each([9, 10])(
    'enforces the HappyHorse R2V reference limit for %s images',
    async (count) => {
      const request = buildTuziVideoRequest({
        model: 'happyhorse-1.1-r2v',
        prompt: 'animate [Image 1]',
        referenceImages: Array.from(
          { length: count },
          (_, i) => `https://example.test/${i}.png`
        ),
      });
      if (count === 9) expect((await request)?.images).toHaveLength(9);
      else await expect(request).rejects.toThrow('最多支持 9 张参考图');
    }
  );

  it('materializes local frames in the shared path without FileReader or DOM APIs', async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === 'blob:local-image')
          return new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'Content-Type': 'image/png' },
          });
        expect(JSON.parse(String(init?.body))).toHaveProperty(
          'first_frame',
          'data:image/png;base64,AQID'
        );
        return new Response(JSON.stringify({ id: 'task', status: 'queued' }));
      }
    );
    expect(
      await submitVideoGeneration(
        {
          model: 'wan3.0-video',
          prompt: 'animate',
          referenceImages: ['blob:local-image'],
        },
        {
          apiKey: 'test',
          baseUrl: 'https://example.test/v1',
          fetchImpl,
        }
      )
    ).toBe('task');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('sends HappyHorse 1.1 through its adapter without the 1.0 fallback', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: 'happyhorse-1.1-i2v',
          image: 'https://example.test/a.png',
          parameters: { duration: 3, resolution: '480P' },
        });
        return new Response(JSON.stringify({ id: 'task', status: 'queued' }));
      }
    );
    await submitHappyHorseVideo(
      { baseUrl: 'https://example.test/v1', apiKey: 'test', fetcher },
      {
        model: 'happyhorse-1.1-i2v',
        prompt: '',
        duration: 3,
        size: '480P',
        referenceImages: ['https://example.test/a.png'],
      }
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['https://api.example.test', 'https://api.example.test/v1'])(
    'queries a known video model without losing or duplicating v1: %s',
    async (baseUrl) => {
      const fetchImpl = vi.fn(
        async (_input: RequestInfo | URL) =>
          new Response(JSON.stringify({ id: 'task', status: 'queued' }))
      );
      await queryVideoStatus('task', {
        baseUrl,
        apiKey: 'test',
        fetchImpl,
        defaultModel: 'kling-4.0',
      });
      expect(fetchImpl.mock.calls[0][0]).toBe(
        'https://api.example.test/v1/videos/task'
      );
    }
  );

  it.each([
    { model: 'wan3.0-video', duration: 1 },
    { model: 'kling-4.0', duration: 31 },
    { model: 'gemini-omni-1.2-flash', duration: 2 },
    { model: 'happyhorse-1.1-t2v', duration: 3.5 },
    { model: 'happyhorse-1.1-t2v', params: { seed: -1 } },
    { model: 'happyhorse-1.1-t2v', params: { seed: true } },
    { model: 'happyhorse-1.1-t2v', params: { watermark: 'off' } },
    {
      model: 'happyhorse-1.1-t2v',
      referenceImages: ['https://example.test/a.png'],
    },
    { model: 'happyhorse-1.1-i2v' },
    { model: 'happyhorse-1.1-r2v' },
    {
      model: 'wan3.0-video',
      referenceImages: ['', 'https://example.test/last.png'],
    },
    { model: 'kling-4.0', size: '3840x2160' },
    {
      model: 'kling-4.0',
      referenceImages: Array.from(
        { length: 11 },
        (_, i) => `https://example.test/${i}.png`
      ),
    },
    { model: 'kling-4.0', referenceImages: ['data:image/webp;base64,AQID'] },
    { model: 'gemini-omni-1.2-flash', referenceImages: ['blob:local-image'] },
  ])('rejects invalid generation input before sending: %j', async (request) => {
    const fetchImpl = vi.fn();
    await expect(
      submitVideoGeneration(
        { prompt: 'animate', ...request },
        {
          baseUrl: 'https://api.example.test/v1',
          apiKey: 'test',
          fetchImpl,
        }
      )
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'gemini-omni-1.2-flash',
    'wan3.0-video',
    'kling-4.0',
    'happyhorse-1.1-t2v',
  ])(
    'sends the actual shared submission as JSON and supports content recovery: %s',
    async (model) => {
      const fetchImpl = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          expect(JSON.parse(String(init?.body))).toHaveProperty('model', model);
          expect(new Headers(init?.headers).get('Content-Type')).toBe(
            'application/json'
          );
          return new Response(JSON.stringify({ id: 'task', status: 'queued' }));
        }
      );
      expect(
        await submitVideoGeneration(
          { model, prompt: 'animate' },
          {
            apiKey: 'test',
            baseUrl: 'https://api.example.test/v1',
            fetchImpl,
          }
        )
      ).toBe('task');
      expect(fetchImpl.mock.calls[0][0]).toBe(
        'https://api.example.test/v1/videos'
      );
      expect(
        shouldDownloadVideoContent(model, null, { status: 'completed' })
      ).toBe(true);
      expect(
        shouldDownloadVideoContent(model, null, {
          status: 'completed',
          url: 'https://example.test/v.mp4',
        })
      ).toBe(false);
    }
  );
});

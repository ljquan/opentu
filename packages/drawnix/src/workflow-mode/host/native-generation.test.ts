import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateNative } from './native-generation';
import { readNativeModels } from './native-models';
import { resolveAdapterForInvocation } from '../../services/model-adapters';
import { describeNativeModel } from './native-parameters';
import { getAllBuiltInModelConfigs } from '../../constants/model-config';
import { fallbackMediaExecutor } from '../../services/media-executor/fallback-executor';

vi.mock('./native-models', () => ({ readNativeModels: vi.fn() }));
vi.mock('../../services/media-executor/fallback-executor', () => ({
  fallbackMediaExecutor: { generateText: vi.fn() },
}));
vi.mock('../../services/model-adapters', () => ({
  resolveAdapterForInvocation: vi.fn(),
  getAdapterContextFromSettings: () => ({
    baseUrl: 'https://example.test',
    apiKey: 'private-key',
  }),
  GPT_IMAGE_EDIT_REQUEST_SCHEMAS: ['edit'],
}));
afterEach(() => vi.resetAllMocks());
const request = {
  capability: 'image' as const,
  channelId: 'native',
  model: 'image-model',
  prompt: 'test',
  images: ['data:image/png;base64,YQ=='],
  count: 2,
};
const catalog = {
  channels: [
    {
      id: 'native',
      name: 'Native',
      opentuProfileId: 'profile',
      baseUrl: '',
      apiKey: '',
      apiFormat: 'openai' as const,
      models: [{ name: 'image-model', capability: 'image' as const }],
    },
  ],
  defaults: { image: '', video: '', text: '', audio: '' },
  warnings: [],
};

describe('native generation', () => {
  it('maps every Suno top-level option and returns every audio clip', async () => {
    vi.mocked(readNativeModels).mockResolvedValue({
      ...catalog,
      channels: [
        {
          ...catalog.channels[0],
          models: [
            {
              name: 'suno_music',
              capability: 'audio',
              ...describeNativeModel('suno_music', 'audio'),
            },
          ],
        },
      ],
    });
    const generateAudio = vi
      .fn()
      .mockResolvedValue({
        url: 'https://example.test/1.mp3',
        urls: ['https://example.test/1.mp3', 'https://example.test/2.mp3'],
      });
    vi.mocked(resolveAdapterForInvocation).mockReturnValue({
      id: 'suno-audio-adapter',
      kind: 'audio',
      label: 'Suno',
      generateAudio,
    });
    const params = {
      title: 'title',
      tags: 'jazz',
      instrumental: 'true',
      continueClipId: 'clip-id',
      continueAt: 5,
      mv: 'chirp-v3-5',
    };
    const result = await generateNative(
      {
        ...request,
        capability: 'audio',
        model: 'suno_music',
        images: [],
        params,
      },
      new AbortController().signal
    );
    expect(generateAudio).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ...params,
        instrumental: true,
        params: expect.objectContaining(params),
      })
    );
    expect(result).toEqual({
      resultKind: 'audio',
      urls: ['https://example.test/1.mp3', 'https://example.test/2.mp3'],
    });
  });

  it('maps ordered Seedance video/audio references and refuses local video input', async () => {
    const id = 'doubao-seedance-2-0-260128';
    vi.mocked(readNativeModels).mockResolvedValue({
      ...catalog,
      channels: [
        {
          ...catalog.channels[0],
          models: [
            {
              name: id,
              capability: 'video',
              ...describeNativeModel(id, 'video'),
            },
          ],
        },
      ],
    });
    const generateVideo = vi
      .fn()
      .mockResolvedValue({ url: 'https://example.test/result.mp4' });
    vi.mocked(resolveAdapterForInvocation).mockReturnValue({
      id: 'seedance-2-video-adapter',
      kind: 'video',
      label: 'Seedance',
      generateVideo,
    });
    const videos = ['https://example.test/a.mp4', 'https://example.test/b.mp4'];
    const audios = ['asset://audio-1'];
    await generateNative(
      {
        ...request,
        capability: 'video',
        model: id,
        params: {},
        videos,
        audios,
      },
      new AbortController().signal
    );
    expect(generateVideo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        params: expect.objectContaining({
          input_videos: videos,
          input_audios: audios,
        }),
      })
    );
    await expect(
      generateNative(
        {
          ...request,
          capability: 'video',
          model: id,
          params: {},
          videos: ['data:video/mp4;base64,YQ=='],
        },
        new AbortController().signal
      )
    ).rejects.toThrow('格式');
  });
  it('rejects a model outside the current host catalog before execution', async () => {
    vi.mocked(readNativeModels).mockResolvedValue(catalog);
    await expect(
      generateNative(
        { ...request, model: 'unapproved' },
        new AbortController().signal
      )
    ).rejects.toThrow('模型');
    expect(resolveAdapterForInvocation).not.toHaveBeenCalled();
  });
  it('routes references to the exact profile and returns media only', async () => {
    vi.mocked(readNativeModels).mockResolvedValue(catalog);
    const signal = new AbortController().signal;
    const generateImage = vi.fn().mockResolvedValue({
      url: 'https://example.test/1.png',
      urls: ['https://example.test/1.png', 'https://example.test/2.png'],
      raw: { secret: 'private-key' },
    });
    vi.mocked(resolveAdapterForInvocation).mockReturnValue({
      id: 'test',
      label: 'Test',
      kind: 'image',
      generateImage,
    });
    expect(await generateNative(request, signal)).toEqual({
      urls: ['https://example.test/1.png', 'https://example.test/2.png'],
      resultKind: 'image',
    });
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
      expect.objectContaining({
        modelRef: { profileId: 'profile', modelId: 'image-model' },
        referenceImages: request.images,
        generationMode: 'image_to_image',
        params: expect.objectContaining({ n: 2 }),
      })
    );
    expect(resolveAdapterForInvocation).toHaveBeenCalledWith(
      'image',
      'image-model',
      { profileId: 'profile', modelId: 'image-model' },
      { preferredRequestSchema: ['edit'] }
    );
  });
  it('does not submit an already canceled request', async () => {
    vi.mocked(readNativeModels).mockResolvedValue(catalog);
    const controller = new AbortController();
    controller.abort();
    await expect(generateNative(request, controller.signal)).rejects.toThrow();
    expect(resolveAdapterForInvocation).not.toHaveBeenCalled();
  });
  it('preserves Seedance resolution and aspect ratio in adapter size', async () => {
    vi.mocked(readNativeModels).mockResolvedValue({
      ...catalog,
      channels: [
        {
          ...catalog.channels[0],
          models: [{ name: 'seedance', capability: 'video' }],
        },
      ],
    });
    const generateVideo = vi
      .fn()
      .mockResolvedValue({ url: 'https://example.test/result.mp4' });
    vi.mocked(resolveAdapterForInvocation).mockReturnValue({
      id: 'seedance-video-adapter',
      label: 'Test',
      kind: 'video',
      generateVideo,
    });
    const result = await generateNative(
      {
        ...request,
        capability: 'video',
        model: 'seedance',
        resolution: '1080p',
        aspectRatio: '9:16',
        duration: 5,
      },
      new AbortController().signal
    );
    expect(result).toEqual({
      urls: ['https://example.test/result.mp4'],
      resultKind: 'video',
    });
    expect(generateVideo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ size: '1080p@9:16', duration: 5 })
    );
  });
  it('returns audio URLs but does not treat lyrics as an audio file', async () => {
    vi.mocked(readNativeModels).mockResolvedValue({
      ...catalog,
      channels: [
        {
          ...catalog.channels[0],
          models: [{ name: 'suno_music', capability: 'audio' }],
        },
      ],
    });
    const generateAudio = vi
      .fn()
      .mockResolvedValueOnce({
        url: 'https://example.test/result.mp3',
        resultKind: 'audio',
      })
      .mockResolvedValueOnce({
        url: '',
        resultKind: 'lyrics',
        lyricsText: 'words',
      });
    vi.mocked(resolveAdapterForInvocation).mockReturnValue({
      id: 'suno',
      label: 'Test',
      kind: 'audio',
      generateAudio,
    });
    const audio = {
      ...request,
      capability: 'audio' as const,
      model: 'suno_music',
      images: [],
    };
    expect(await generateNative(audio, new AbortController().signal)).toEqual({
      urls: ['https://example.test/result.mp3'],
      resultKind: 'audio',
    });
    expect(await generateNative(audio, new AbortController().signal)).toEqual({
      text: 'words',
      resultKind: 'lyrics',
    });
  });

  it('rejects a stale H3 size before adapter selection', async () => {
    vi.mocked(readNativeModels).mockResolvedValue({
      ...catalog,
      channels: [
        {
          ...catalog.channels[0],
          models: [
            {
              name: 'MiniMax-H3',
              capability: 'video',
              ...describeNativeModel('MiniMax-H3', 'video'),
            },
          ],
        },
      ],
    });
    await expect(
      generateNative(
        {
          ...request,
          capability: 'video',
          model: 'MiniMax-H3',
          params: { size: '720p' },
        },
        new AbortController().signal
      )
    ).rejects.toThrow('参数值');
    expect(resolveAdapterForInvocation).not.toHaveBeenCalled();
  });

  it('passes text context and sampling without losing system/assistant messages', async () => {
    vi.mocked(readNativeModels).mockResolvedValue({
      ...catalog,
      channels: [
        {
          ...catalog.channels[0],
          models: [
            {
              name: 'gpt-5.5',
              capability: 'text',
              ...describeNativeModel('gpt-5.5', 'text'),
            },
          ],
        },
      ],
    });
    vi.mocked(fallbackMediaExecutor.generateText).mockResolvedValue({
      content: 'answer',
    });
    const messages = [
      { role: 'system' as const, content: 'system' },
      { role: 'assistant' as const, content: 'previous' },
    ];
    await generateNative(
      {
        ...request,
        capability: 'text',
        model: 'gpt-5.5',
        params: { temperature: 0.4, max_tokens: 512 },
        messages,
      },
      new AbortController().signal
    );
    expect(fallbackMediaExecutor.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
        params: { temperature: 0.4, top_p: 1, max_tokens: 512 },
      }),
      expect.anything()
    );
  });

  it.each(
    getAllBuiltInModelConfigs()
      .filter((model) => model.type !== 'text')
      .map((model) => [model.id, model.type] as const)
  )('maps the complete %s contract to its adapter', async (id, capability) => {
    const metadata = describeNativeModel(id, capability);
    const selected = { name: id, capability, ...metadata };
    vi.mocked(readNativeModels).mockResolvedValue({
      ...catalog,
      channels: [{ ...catalog.channels[0], models: [selected] }],
    });
    const generate = vi
      .fn()
      .mockResolvedValue({ url: 'https://example.test/result' });
    vi.mocked(resolveAdapterForInvocation).mockReturnValue({
      id: 'test',
      label: 'Test',
      kind: capability,
      [`generate${capability[0].toUpperCase()}${capability.slice(1)}`]:
        generate,
    } as never);
    const params = Object.fromEntries(
      (metadata.parameters || []).map((parameter) => [
        parameter.id,
        parameter.defaultValue ??
          (parameter.valueType === 'enum'
            ? parameter.options![0].value
            : parameter.valueType === 'number'
            ? parameter.min ?? 0
            : parameter.id === 'size'
            ? '512x512'
            : 'test'),
      ])
    ) as Record<string, string | number | boolean>;
    const images = Array(metadata.referenceInputs?.images?.minCount || 0).fill(
      'https://example.test/ref.png'
    );
    const videos = Array(metadata.referenceInputs?.videos?.minCount || 0).fill(
      'https://example.test/ref.mp4'
    );
    await generateNative(
      {
        capability,
        channelId: 'native',
        model: id,
        prompt: 'test',
        images,
        videos,
        params,
      },
      new AbortController().signal
    );
    expect(generate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        params: expect.objectContaining(params),
        ...(params.size ? { size: params.size } : {}),
        ...(params.duration ? { duration: Number(params.duration) } : {}),
      })
    );
  });
});

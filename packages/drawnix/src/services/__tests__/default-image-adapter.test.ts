import { afterEach, describe, expect, it, vi } from 'vitest';
import { geminiImageAdapter } from '../model-adapters/default-adapters';

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  generateWithPolling: vi.fn(),
  extractUrlAndFormat: vi.fn(),
}));

vi.mock('../../utils/gemini-api', () => ({
  defaultGeminiClient: {
    generateImage: mocks.generateImage,
  },
}));

vi.mock('../async-image-api-service', () => ({
  asyncImageAPIService: {
    generateWithPolling: mocks.generateWithPolling,
    extractUrlAndFormat: mocks.extractUrlAndFormat,
  },
}));

vi.mock('../audio-api-service', () => ({
  audioAPIService: {},
  extractAudioGenerationResult: vi.fn(),
}));

vi.mock('../video-api-service', () => ({
  videoAPIService: {},
}));

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {},
}));

describe('default image adapter compatibility', () => {
  it('forwards an explicit GPT Image 2.6 size in basic compatibility mode', async () => {
    const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    mocks.generateImage.mockResolvedValue({ data: [{ b64_json: gif, width: 1, height: 1 }] });
    await geminiImageAdapter.generateImage({ baseUrl: 'https://gateway.example.com/v1' }, {
      model: 'gpt-image-2.6-1k', prompt: '静态图', size: '4096x4096',
      params: { size: '1536x1024', quality: 'high', resolution: '4k' },
    });
    expect(mocks.generateImage).toHaveBeenCalledWith('静态图', expect.objectContaining({
      model: 'gpt-image-2.6-1k', size: '1536x1024', quality: undefined,
      count: 1, response_format: 'b64_json',
    }));
  });

  it('keeps GPT Image 2.6 GIF bytes and batch URLs consistent in basic compatibility mode', async () => {
    const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    mocks.generateImage.mockResolvedValue({ data: [{ b64_json: gif, width: 1, height: 1 }] });
    const result = await geminiImageAdapter.generateImage({ baseUrl: 'https://gateway.example.com/v1' }, {
      model: 'gpt-image-2.6-1k', prompt: '生成 GIF 图', size: '16x9',
      params: { quality: '4k', resolution: '4k', response_format: 'url' },
    });
    expect(mocks.generateImage).toHaveBeenCalledWith('生成 GIF 图', expect.objectContaining({
      model: 'gpt-image-2.6-1k', size: '16x9', quality: undefined,
      count: 1, response_format: 'b64_json',
    }));
    expect(result).toMatchObject({url: `data:image/gif;base64,${gif}`,
      urls: [`data:image/gif;base64,${gif}`], format: 'gif'});
  });
  afterEach(() => {
    mocks.generateImage.mockReset();
    mocks.generateWithPolling.mockReset();
    mocks.extractUrlAndFormat.mockReset();
  });

  it.each([
    'nano-banana',
    'nano-banana-2',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image',
  ])(
    'preserves the exact model ID %s when forwarding image options',
    async (model) => {
      mocks.generateImage.mockResolvedValue({
        data: [{ url: 'https://example.com/result.png' }],
      });

      await geminiImageAdapter.generateImage({
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }, {
        model,
        modelRef: { profileId: 'provider', modelId: model },
        prompt: 'Test',
        size: '16x9',
        params: model === 'nano-banana' ? {} : { quality: '2k' },
      });

      expect(mocks.generateImage).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({
          model,
          modelRef: { profileId: 'provider', modelId: model },
          size: '16x9',
          quality: model === 'nano-banana' ? undefined : '2k',
        })
      );
    }
  );

  it('keeps generic GPT image fallback on the basic compatibility request shape', async () => {
    mocks.generateImage.mockResolvedValue({
      data: [
        {
          url: 'https://example.com/basic.png',
        },
      ],
    });

    const result = await geminiImageAdapter.generateImage(
      {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
        requestId: 'task-image-1',
      },
      {
        model: 'gpt-image-2',
        prompt: 'Draw a clean product photo',
        size: '1024x1024',
        referenceImages: ['data:image/png;base64,abc123'],
        params: {
          resolution: '4k',
          quality: 'high',
          n: 2,
        },
      }
    );

    expect(mocks.generateImage).toHaveBeenCalledWith(
      'Draw a clean product photo',
      {
        size: '1024x1024',
        image: ['data:image/png;base64,abc123'],
        quality: '4k',
        count: 2,
        model: 'gpt-image-2',
        modelRef: null,
        omitDefaultResponseFormat: true,
        requestId: 'task-image-1',
      }
    );
    expect(result).toMatchObject({
      url: 'https://example.com/basic.png',
      format: 'png',
    });
  });

  it('defaults GPT Image 2 generic fallback quality to 1k when resolution is unset', async () => {
    mocks.generateImage.mockResolvedValue({
      data: [
        {
          url: 'https://example.com/basic.png',
        },
      ],
    });

    await geminiImageAdapter.generateImage(
      {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      },
      {
        model: 'gpt-image-2',
        prompt: 'Draw a clean product photo',
        size: '16x9',
        params: {
          quality: 'high',
        },
      }
    );

    expect(mocks.generateImage).toHaveBeenCalledWith(
      'Draw a clean product photo',
      expect.objectContaining({
        quality: '1k',
      })
    );
  });

  it('forwards the formal submission callback to the basic image client', async () => {
    const onSubmissionAttempt = vi.fn();
    mocks.generateImage.mockResolvedValue({
      data: [{ url: 'https://example.com/basic.png' }],
    });

    await geminiImageAdapter.generateImage(
      {
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
        requestId: 'task-image-submit-1',
        onSubmissionAttempt,
      },
      {
        model: 'gpt-image-2',
        prompt: 'Draw a clean product photo',
      }
    );

    expect(mocks.generateImage).toHaveBeenCalledWith(
      'Draw a clean product photo',
      expect.objectContaining({ onSubmissionAttempt })
    );
  });

  it('uses async image polling when provider binding comes from pricing async-image endpoint', async () => {
    const onSubmissionAttempt = vi.fn();
    mocks.generateWithPolling.mockResolvedValue({
      id: 'task-1',
      status: 'completed',
      video_url: 'https://example.com/async.png',
    });
    mocks.extractUrlAndFormat.mockReturnValue({
      url: 'https://example.com/async.png',
      format: 'png',
    });

    const result = await geminiImageAdapter.generateImage(
      {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
        requestId: 'task-image-async-1',
        onSubmissionAttempt,
        binding: {
          id: 'binding',
          profileId: 'provider',
          modelId: 'gpt-image-1-vip',
          operation: 'image',
          protocol: 'openai.async.media',
          requestSchema: 'openai.async.image.form',
          responseSchema: 'openai.async.task',
          submitPath: '/videos',
          pollPathTemplate: '/videos/{taskId}',
          priority: 700,
          confidence: 'medium',
          source: 'discovered',
        },
      },
      {
        model: 'gpt-image-1-vip',
        modelRef: {
          profileId: 'provider',
          modelId: 'gpt-image-1-vip',
        },
        prompt: 'Draw async',
        size: '1:1',
        referenceImages: ['data:image/png;base64,abc123'],
        maskImage: 'data:image/png;base64,mask123',
      }
    );

    expect(mocks.generateWithPolling).toHaveBeenCalledWith(
      {
        model: 'gpt-image-1-vip',
        modelRef: {
          profileId: 'provider',
          modelId: 'gpt-image-1-vip',
        },
        prompt: 'Draw async',
        size: '1:1',
        referenceImages: ['data:image/png;base64,abc123'],
        maskImage: 'data:image/png;base64,mask123',
      },
      expect.objectContaining({
        interval: 5000,
        requestId: 'task-image-async-1',
        onSubmissionAttempt,
      })
    );
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      url: 'https://example.com/async.png',
      format: 'png',
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { geminiImageAdapter } from '../model-adapters/default-adapters';

describe('default image adapter compatibility', () => {
  afterEach(() => {
    mocks.generateImage.mockReset();
    mocks.generateWithPolling.mockReset();
    mocks.extractUrlAndFormat.mockReset();
  });

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

  it('uses async image polling when provider binding comes from pricing async-image endpoint', async () => {
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
      })
    );
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      url: 'https://example.com/async.png',
      format: 'png',
    });
  });
});

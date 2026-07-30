import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTuziGPTImageRequestBody,
  tuziGPTImageAdapter,
} from '../model-adapters/tuzi-gpt-image-adapter';

const mocks = vi.hoisted(() => ({
  sendAdapterRequest: vi.fn(),
}));

vi.mock('../model-adapters/context', () => ({
  sendAdapterRequest: mocks.sendAdapterRequest,
}));

describe('tuzi GPT image adapter', () => {
  afterEach(() => {
    mocks.sendAdapterRequest.mockReset();
  });

  it('builds the Tuzi GPT request body with official GPT size and quality semantics', () => {
    expect(
      buildTuziGPTImageRequestBody({
        model: 'gpt-image-2',
        prompt: 'Draw a clean product photo',
        size: '16x9',
        referenceImages: ['data:image/png;base64,abc123'],
        params: {
          resolution: '4k',
          quality: 'high',
          n: 2,
        },
      })
    ).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '3840x2160',
      image: ['data:image/png;base64,abc123'],
      quality: 'high',
      n: 2,
    });
  });

  it('treats legacy 1K/2K/4K quality values as resolution compatibility hints', () => {
    expect(
      buildTuziGPTImageRequestBody({
        model: 'gpt-image-2',
        prompt: 'Draw a clean product photo',
        size: '4x3',
        params: {
          quality: '2k',
        },
      })
    ).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '2368x1776',
    });
  });

  it('preserves official quality and defaults GPT Image 2 sizing to 1k when resolution is unset', async () => {
    mocks.sendAdapterRequest.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ url: 'https://example.com/tuzi.png' }],
      }),
    });

    const result = await tuziGPTImageAdapter.generateImage(
      {
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
        binding: {
          id: 'binding',
          profileId: 'tuzi',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.generations',
          requestSchema: 'tuzi.image.gpt-generation-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
          priority: 10,
          confidence: 'high',
          source: 'template',
        },
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

    expect(mocks.sendAdapterRequest).toHaveBeenCalledTimes(1);
    const request = mocks.sendAdapterRequest.mock.calls[0]?.[1];
    expect(request.path).toBe('/images/generations');
    expect(request.baseUrlStrategy).toBe('ensure-v1');
    expect(JSON.parse(request.body)).toMatchObject({
      size: '1360x768',
      quality: 'high',
    });
    expect(JSON.parse(request.body).response_format).toBeUndefined();
    expect(result).toMatchObject({
      url: 'https://example.com/tuzi.png',
      format: 'png',
    });
  });

  it('routes edit requests through the dedicated Tuzi edit schema', async () => {
    mocks.sendAdapterRequest.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ b64_json: 'ZmFrZQ==' }],
      }),
    });

    await tuziGPTImageAdapter.generateImage(
      {
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
        binding: {
          id: 'binding',
          profileId: 'tuzi',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.generations',
          requestSchema: 'tuzi.image.gpt-edit-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
          priority: 10,
          confidence: 'high',
          source: 'template',
        },
      },
      {
        model: 'gpt-image-2',
        prompt: 'Edit this image',
        size: '16x9',
        referenceImages: ['data:image/png;base64,source'],
        generationMode: 'image_to_image',
        params: {
          resolution: '2k',
          quality: 'medium',
          response_format: 'b64_json',
        },
      }
    );

    const request = mocks.sendAdapterRequest.mock.calls[0]?.[1];
    expect(request.path).toBe('/images/generations');
    expect(request.baseUrlStrategy).toBe('ensure-v1');
    expect(JSON.parse(request.body)).toEqual({
      model: 'gpt-image-2',
      prompt: 'Edit this image',
      size: '2736x1536',
      image: ['data:image/png;base64,source'],
      response_format: 'b64_json',
      quality: 'medium',
    });
  });

  it('repairs legacy Tuzi edit bindings to the JSON generations endpoint', async () => {
    mocks.sendAdapterRequest.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ url: 'https://example.com/tuzi-edit.png' }],
      }),
    });

    await tuziGPTImageAdapter.generateImage(
      {
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
        binding: {
          id: 'binding',
          profileId: 'tuzi',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.edits',
          requestSchema: 'tuzi.image.gpt-edit-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/edits',
          priority: 10,
          confidence: 'high',
          source: 'template',
        },
      },
      {
        model: 'gpt-image-2',
        prompt: 'Continue this PPT slide style',
        size: '2736x1536',
        referenceImages: ['data:image/png;base64,source'],
        generationMode: 'image_to_image',
      }
    );

    const request = mocks.sendAdapterRequest.mock.calls[0]?.[1];
    expect(request.path).toBe('/images/generations');
    expect(request.baseUrlStrategy).toBe('ensure-v1');
    expect(JSON.parse(request.body)).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'Continue this PPT slide style',
      size: '2736x1536',
      image: ['data:image/png;base64,source'],
    });
    expect(JSON.parse(request.body).response_format).toBeUndefined();
  });

  it('includes the final endpoint when a 404 response has no JSON error', async () => {
    mocks.sendAdapterRequest.mockResolvedValue({
      ok: false,
      status: 404,
      url: 'https://api.tu-zi.com/v1/v1/images/generations?token=hidden',
      text: async () => '<!doctype html><title>Not Found</title>',
    });

    await expect(
      tuziGPTImageAdapter.generateImage(
        {
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'test-key',
          authType: 'bearer',
          binding: {
            id: 'binding',
            profileId: 'tuzi',
            modelId: 'gpt-image-2',
            operation: 'image',
            protocol: 'openai.images.generations',
            requestSchema: 'tuzi.image.gpt-generation-json',
            responseSchema: 'openai.image.data',
            submitPath: '/v1/images/generations',
            priority: 10,
            confidence: 'high',
            source: 'manual',
          },
        },
        {
          model: 'gpt-image-2',
          prompt: 'Draw a clean product photo',
        }
      )
    ).rejects.toThrow(
      'Tuzi GPT Image request failed: 404 (api.tu-zi.com/v1/v1/images/generations)'
    );
  });
});

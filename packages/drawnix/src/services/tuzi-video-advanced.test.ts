import { getEffectiveVideoCompatibleParams } from './video-binding-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTuziVideoRequest } from './tuzi-video-request';
import { submitVideoGeneration } from './media-api/video-api';
import { inferBindingsForProviderModel } from './provider-routing/binding-inference';
import { getStaticModelConfig } from '../constants/model-config';
import {
  validateGenerationParams,
  sanitizeGenerationParams,
} from '../utils/validation-utils';
import { TaskType } from '../types/task.types';

// Real PNG fixtures at the relevant pixel boundaries.
const png = {
  png1: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  png299:
    'iVBORw0KGgoAAAANSUhEUgAAASsAAAErCAIAAAAJxjLjAAADUElEQVR4nO3TMQEAAAiAMPuX1hgcbgl4mAU6UwfAaw6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhJIDoeRAKDkQSg6EkgOh5EAoORBKDoSSA6HkQCg5EEoOhNIBly/Qc7T3zJsAAAAASUVORK5CYII=',
  png300:
    'iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAIAAAD2HxkiAAADUklEQVR4nO3TMQEAAAiAMPuX1hgcbgl4mAVSUwfAdyaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIWZCiJkQYiaEmAkhZkKImRBiJoSYCSFmQoiZEGImhJgJIXb0mc7X2VRTSgAAAABJRU5ErkJggg==',
  png399:
    'iVBORw0KGgoAAAANSUhEUgAAAY8AAAGPCAIAAAAr+MuwAAAFLUlEQVR4nO3UMQ0AMAzAsPIn3VLYN0WyEeTKLEDB/A4AeOJWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQINbAQ1uBTS4FdDgVkCDWwENbgU0uBXQ4FZAg1sBDW4FNLgV0OBWQMMBKijGPKd88x8AAAAASUVORK5CYII=',
  png400:
    'iVBORw0KGgoAAAANSUhEUgAAAZAAAAGQCAIAAAAP3aGbAAAFMElEQVR4nO3UMQ0AMAzAsPIn3VLYN0WyEeTKLEDE/A4AeGVYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARkHfD8adYB8frcAAAAASUVORK5CYII=',
};
const dataUrl = (size: keyof typeof png) =>
  `data:image/png;base64,${png[size]}`;
const endpoint = { baseUrl: 'https://video.example.test/v1', apiKey: 'test' };
afterEach(() => vi.restoreAllMocks());

async function wire(request: Parameters<typeof submitVideoGeneration>[0]) {
  let body = {} as Record<string, unknown> & {
    input: Record<string, unknown>[];
    contents: Record<string, unknown>[];
    parameters: Record<string, unknown>;
  };
  const fetchImpl = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ id: 'task_accepted', status: 'queued' })
      );
    }
  );
  expect(await submitVideoGeneration(request, { ...endpoint, fetchImpl })).toBe(
    'task_accepted'
  );
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  return body;
}

describe('complete Tuzi video input contracts', () => {
  it('sends a local Gemini image as raw Base64 with MIME and a text part', async () => {
    const body = await wire({
      model: 'gemini-omni-1.2-flash',
      prompt: 'animate',
      size: '1080p',
      params: { ratio: '9:16', watermark: true },
      referenceImages: [dataUrl('png400')],
    });
    expect(body).toEqual({
      model: 'gemini-omni-1.2-flash',
      seconds: '10',
      size: '1080x1920',
      input: [
        { type: 'text', text: 'animate' },
        { type: 'image', mime_type: 'image/png', data: png.png400 },
      ],
    });
  });

  it.each(['video/mp4', 'application/octet-stream'])(
    'reads a cached Gemini video with %s in the shared path before submitting once',
    async (mime) => {
      const calls: string[] = [];
      const fetchImpl = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          calls.push(String(input));
          if (String(input) === '/asset-library/input.mp4')
            return new Response(new Uint8Array([1, 2, 3]), {
              headers: { 'Content-Type': mime },
            });
          expect(JSON.parse(String(init?.body))).toMatchObject({
            input: [{ type: 'video', mime_type: 'video/mp4', data: 'AQID' }],
          });
          return new Response(
            JSON.stringify({ id: 'task_cached', status: 'queued' })
          );
        }
      );
      await submitVideoGeneration(
        {
          model: 'gemini-omni-1.2-flash',
          prompt: '',
          params: {
            video_media: JSON.stringify([
              {
                type: 'video',
                url: '/asset-library/input.mp4',
                mime_type: 'video/mp4',
              },
            ]),
          },
        },
        { ...endpoint, fetchImpl }
      );
      expect(calls).toEqual([
        '/asset-library/input.mp4',
        'https://video.example.test/v1/videos',
      ]);
    }
  );

  it('keeps explicit MIME for signed URLs without a file suffix', async () => {
    const body = await wire({
      model: 'gemini-omni-1.2-flash',
      prompt: '',
      params: {
        video_media: [
          {
            type: 'image',
            url: 'https://media.example.test/object?signature=example',
            mime_type: 'image/webp',
          },
        ],
      },
    });
    expect(body.input[0]).toEqual({
      type: 'image',
      mime_type: 'image/webp',
      uri: 'https://media.example.test/object?signature=example',
    });
  });

  it.each(['edit', 'extend'])(
    'sends Gemini %s with the public previous task identity',
    async (task) => {
      const body = await wire({
        model: 'gemini-omni-1.2-flash',
        prompt: 'continue the scene',
        duration: 10,
        params: {
          video_task: task,
          previous_interaction_id: 'task_previous',
          ratio: '16:9',
        },
      });
      expect(body).toMatchObject({
        previous_interaction_id: 'task_previous',
        generation_config: { video_config: { task } },
      });
    }
  );

  it('accepts Gemini native content arrays without requiring a separate prompt', async () => {
    const body = await wire({
      model: 'gemini-omni-1.2-flash',
      prompt: '',
      params: {
        input: [
          { type: 'text', text: 'animate' },
          {
            type: 'video',
            mime_type: 'video/mp4',
            uri: 'https://media.example.test/a.mp4',
          },
        ],
      },
    });
    expect(body).not.toHaveProperty('prompt');
    expect(body.input).toHaveLength(2);
  });

  it('preserves all Wan mixed-reference controls on the wire, including false and zero', async () => {
    const body = await wire({
      model: 'wan3.0-video',
      prompt: 'use the motion and voice',
      duration: 2,
      size: '480P',
      params: {
        reference_mode: 'mixed',
        audio: false,
        prompt_extend: true,
        seed: 0,
        watermark: false,
        file: 'https://media.example.test/brief.pdf',
        ratio: '21:9',
        video_media: [
          { type: 'reference_images', url: dataUrl('png400') },
          {
            type: 'reference_videos',
            url: 'https://media.example.test/a.mp4',
            duration: 2,
          },
          { type: 'reference_audio', url: 'https://media.example.test/a.wav' },
        ],
      },
    });
    expect(body).toMatchObject({
      model: 'wan3.0-video',
      duration: 2,
      resolution: '480P',
      ratio: '21:9',
      seed: 0,
      audio: false,
      prompt_extend: true,
      watermark: false,
      file: 'https://media.example.test/brief.pdf',
      reference_images: [dataUrl('png400')],
      reference_videos: ['https://media.example.test/a.mp4'],
      reference_audio: ['https://media.example.test/a.wav'],
    });
    expect(body).not.toHaveProperty('first_frame');
  });

  it('supports Wan smart duration through an inferred binding and task sanitation', async () => {
    const bindings = inferBindingsForProviderModel(
      {
        id: 'test',
        name: 'test',
        providerType: 'openai-compatible',
        ...endpoint,
        enabled: true,
      },
      getStaticModelConfig('wan3.0-video') ||
        (() => {
          throw new Error('Wan config missing');
        })()
    );
    const binding = bindings.find(
      (item) => item.protocol === 'openai.async.video'
    );
    if (!binding) throw new Error('Wan binding missing');
    expect(getEffectiveVideoCompatibleParams('wan3.0-video', 'wan3.0-video', {}, binding).find((param) => param.id === 'duration')?.options).toContainEqual({ value: '-1', label: '智能时长' });
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toHaveProperty('duration', -1);
        return new Response(JSON.stringify({ id: 'task_smart' }));
      }
    );
    await submitVideoGeneration(
      {
        model: 'wan3.0-video',
        prompt: 'animate',
        duration: -1,
        params: { seed: -1 },
      },
      { ...endpoint, binding, fetchImpl }
    );
    const params = { model: 'wan3.0-video', prompt: 'animate', duration: -1 };
    expect(validateGenerationParams(params, TaskType.VIDEO).valid).toBe(true);
    expect(sanitizeGenerationParams(params).duration).toBe(-1);
  });

  it('sends every Kling media role, keeping IDs out of media URLs', async () => {
    const body = await wire({
      model: 'kling-4.0',
      prompt: 'animate @subject with @narrator',
      params: {
        video_media: [
          { type: 'first_frame', url: dataUrl('png400') },
          {
            type: 'middle_frame',
            url: 'https://media.example.test/m.png',
            id: 'middle',
          },
          { type: 'last_frame', url: 'https://media.example.test/l.png' },
          { type: 'refer_image', url: 'https://media.example.test/r.png' },
          {
            type: 'feature_video',
            url: 'https://media.example.test/f.mp4',
            duration: 3,
          },
          {
            type: 'base_video',
            url: 'https://media.example.test/b.mp4',
            duration: 2,
          },
          { type: 'element', element_id: 'existing_element', id: 'subject' },
          { type: 'voice', voice_id: 'existing_voice', id: 'narrator' },
        ],
      },
    });
    expect(body.contents.map((item) => item.type)).toEqual([
      'prompt',
      'first_frame',
      'middle_frame',
      'last_frame',
      'refer_image',
      'feature_video',
      'base_video',
      'element',
      'voice',
    ]);
    expect(body.contents[7]).toEqual({
      type: 'element',
      id: 'subject',
      element_id: 'existing_element',
    });
    expect(body.contents[8]).toEqual({
      type: 'voice',
      id: 'narrator',
      voice_id: 'existing_voice',
    });
    expect(body.contents[5]).not.toHaveProperty('duration');
    expect(body).not.toHaveProperty('prompt');
  });

  it('allows HappyHorse I2V with no prompt across shared validation and wire serialization', async () => {
    expect(
      validateGenerationParams(
        {
          model: 'happyhorse-1.1-i2v',
          prompt: '',
          referenceImages: ['https://media.example.test/a.png'],
        },
        TaskType.VIDEO
      ).valid
    ).toBe(true);
    const body = await wire({
      model: 'happyhorse-1.1-i2v',
      prompt: '',
      referenceImages: [dataUrl('png300')],
    });
    expect(body.image).toBe(dataUrl('png300'));
    expect(body.parameters).not.toHaveProperty('ratio');
    expect(
      validateGenerationParams(
        { model: 'happyhorse-1.1-t2v', prompt: '' },
        TaskType.VIDEO
      ).valid
    ).toBe(false);
  });

  it.each([
    {
      model: 'gemini-omni-1.2-flash',
      prompt: '',
      params: {
        input: [
          {
            type: 'image',
            mime_type: 'video/mp4',
            uri: 'https://media.example.test/a.png',
          },
        ],
      },
    },
    {
      model: 'gemini-omni-1.2-flash',
      params: {
        video_task: 'extend',
        previous_interaction_id: 'task_previous',
      },
      duration: 11,
    },
    {
      model: 'gemini-omni-1.2-flash',
      params: {
        video_task: 'edit',
        previous_interaction_id: 'upstream_private_id',
      },
    },
    {
      model: 'gemini-omni-1.2-flash',
      prompt: '',
      params: {
        input: [
          {
            type: 'image',
            mime_type: 'image/png',
            uri: 'https://media.example.test/a.png',
            data: png.png400,
          },
        ],
      },
    },
    {
      model: 'wan3.0-video',
      params: {
        first_frame: 'https://media.example.test/a.png',
        reference_audio: ['https://media.example.test/a.wav'],
      },
    },
    {
      model: 'wan3.0-video',
      params: { last_frame: 'https://media.example.test/l.png' },
    },
    {
      model: 'wan3.0-video',
      params: { link: 'https://media.example.test/', prompt_extend: false },
    },
    {
      model: 'wan3.0-video',
      params: {
        link: 'https://media.example.test/',
        file: 'https://media.example.test/a.pdf',
      },
    },
    { model: 'wan3.0-video', params: { audio: 'off' } },
    { model: 'wan3.0-video', params: { seed: -2 } },
    { model: 'wan3.0-video', params: { reference_videos: ['blob:local'] } },
    {
      model: 'wan3.0-video',
      params: { reference_videos: ['https://media.example.test/a.mp4'] },
      duration: 30,
    },
    {
      model: 'kling-4.0',
      params: {
        video_media: [
          { type: 'element', id: 'x', element_id: 'one' },
          { type: 'voice', id: 'x', voice_id: 'two' },
        ],
      },
    },
    { model: 'kling-4.0', params: { video_media: [{ type: 'voice' }] } },
    {
      model: 'kling-4.0',
      params: { video_media: [{ type: 'feature_video', url: 'blob:local' }] },
    },
    {
      model: 'kling-4.0',
      params: {
        video_media: [
          { type: 'base_video', url: 'https://media.example.test/a.mp4' },
          { type: 'base_video', url: 'https://media.example.test/b.mp4' },
        ],
      },
    },
    {
      model: 'kling-4.0',
      params: {
        video_media: [
          {
            type: 'feature_video',
            url: 'https://media.example.test/a.mp4',
            duration: 31,
          },
        ],
      },
    },
    { model: 'happyhorse-1.1-i2v', referenceImages: [dataUrl('png299')] },
    { model: 'happyhorse-1.1-r2v', referenceImages: [dataUrl('png399')] },
  ])(
    'rejects invalid advanced input without submitting or retrying: %j',
    async (request) => {
      const fetchImpl = vi.fn();
      await expect(
        submitVideoGeneration(
          { prompt: 'animate', ...request },
          { ...endpoint, fetchImpl }
        )
      ).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['reference_images', 10],
    ['reference_videos', 5],
    ['reference_audio', 5],
  ] as const)(
    'accepts the Wan %s limit and rejects one extra',
    async (field, max) => {
      const values = Array.from(
        { length: max },
        (_, i) => `https://media.example.test/${i}.png`
      );
      expect(
        await buildTuziVideoRequest({
          model: 'wan3.0-video',
          prompt: 'animate',
          duration: 2,
          params: { [field]: values },
        })
      ).toHaveProperty(field);
      await expect(
        buildTuziVideoRequest({
          model: 'wan3.0-video',
          prompt: 'animate',
          duration: 2,
          params: {
            [field]: [...values, 'https://media.example.test/extra.png'],
          },
        })
      ).rejects.toThrow('数量超限');
    }
  );

  it.each([
    ['refer_image', 10],
    ['feature_video', 5],
    ['element', 7],
    ['voice', 3],
  ] as const)(
    'accepts the Kling %s boundary and rejects one extra',
    async (type, max) => {
      const make = (count: number) =>
        Array.from({ length: count }, (_, index) => ({
          type,
          id: `asset_${index}`,
          ...(type === 'element'
            ? { element_id: `subject_${index}` }
            : type === 'voice'
            ? { voice_id: `voice_${index}` }
            : {
                url: `https://media.example.test/${index}.${
                  type === 'feature_video' ? 'mp4' : 'png'
                }`,
              }),
        }));
      expect(
        (
          await buildTuziVideoRequest({
            model: 'kling-4.0',
            prompt: 'animate',
            params: { video_media: make(max) },
          })
        )?.contents
      ).toHaveLength(max + 1);
      await expect(
        buildTuziVideoRequest({
          model: 'kling-4.0',
          prompt: 'animate',
          params: { video_media: make(max + 1) },
        })
      ).rejects.toThrow('超限');
    }
  );

  it('enforces the total Kling asset budget independently of each media limit', async () => {
    const media = [
      ...Array.from({ length: 10 }, (_, index) => ({
        type: 'refer_image',
        url: `https://media.example.test/${index}.png`,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        type: 'feature_video',
        url: `https://media.example.test/${index}.mp4`,
      })),
      { type: 'voice', voice_id: 'existing_voice' },
    ];
    await expect(
      buildTuziVideoRequest({
        model: 'kling-4.0',
        prompt: 'animate',
        params: { video_media: media },
      })
    ).rejects.toThrow('超限');
  });

  it('accepts ten Gemini references and rejects the eleventh', async () => {
    const references = Array.from(
      { length: 10 },
      (_, index) => `https://media.example.test/${index}.png`
    );
    expect(
      (
        await buildTuziVideoRequest({
          model: 'gemini-omni-1.2-flash',
          prompt: '',
          referenceImages: references,
        })
      )?.input
    ).toHaveLength(10);
    await expect(
      buildTuziVideoRequest({
        model: 'gemini-omni-1.2-flash',
        prompt: '',
        referenceImages: [...references, references[0]],
      })
    ).rejects.toThrow('最多支持 10');
  });

  it('does not pass a protected task download URL off as a public Wan reference', async () => {
    const fetchImpl = vi.fn();
    await expect(
      submitVideoGeneration(
        {
          model: 'wan3.0-video',
          prompt: 'animate',
          params: {
            reference_videos: [
              'https://api.tu-zi.com/v1/videos/task_private/content',
            ],
          },
        },
        { ...endpoint, fetchImpl }
      )
    ).rejects.toThrow('公网');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts bare image Base64 and rejects an invalid HappyHorse image aspect ratio', async () => {
    expect(
      await buildTuziVideoRequest({
        model: 'happyhorse-1.1-r2v',
        prompt: 'animate',
        referenceImages: [png.png400],
      })
    ).toHaveProperty('images', [dataUrl('png400')]);
    const wide =
      'data:image/png;base64,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';
    await expect(
      buildTuziVideoRequest({
        model: 'happyhorse-1.1-i2v',
        prompt: '',
        referenceImages: [wide],
      })
    ).rejects.toThrow('宽高比');
  });

  it('preserves a provider rejection and never automatically repeats creation', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: 'unsupported video model' } }),
          { status: 400 }
        )
    );
    await expect(
      submitVideoGeneration(
        { model: 'gemini-omni-1.2-flash', prompt: 'animate' },
        { ...endpoint, fetchImpl }
      )
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { videoGenerationTool } from './video-generation';
import {
  validateGenerationParams,
  sanitizeGenerationParams,
} from '../../utils/validation-utils';

const mocks = vi.hoisted(() => ({ create: vi.fn(), generate: vi.fn() }));
vi.mock('../../services/task-queue', () => ({
  taskQueueService: { createTask: mocks.create },
}));
vi.mock('../../services/model-adapters', () => ({
  resolveAdapterForInvocation: () => ({
    kind: 'video',
    generateVideo: mocks.generate,
  }),
  getAdapterContextFromSettings: () => ({
    baseUrl: 'https://media.example.test/v1',
    apiKey: 'test',
  }),
}));
afterEach(() => vi.clearAllMocks());

describe('Tuzi MCP video generation', () => {
  it.each(['async', 'queue'] as const)(
    'allows image-only I2V through the %s tool entry',
    async (mode) => {
      mocks.generate.mockResolvedValue({
        url: 'https://media.example.test/result.mp4',
      });
      mocks.create.mockImplementation((params, type) => {
        expect(validateGenerationParams(params, type).valid).toBe(true);
        return { id: 'local_task', params: sanitizeGenerationParams(params) };
      });
      const result = await videoGenerationTool.execute(
        {
          model: 'happyhorse-1.1-i2v',
          referenceImages: ['https://media.example.test/a.png'],
        },
        { mode }
      );
      expect(result.success).toBe(true);
      if (mode === 'async')
        expect(mocks.generate.mock.calls[0][1]).toMatchObject({
          prompt: '',
          referenceImages: ['https://media.example.test/a.png'],
        });
      else expect(mocks.create.mock.calls[0][0].prompt).toBe('');
    }
  );
  it('preserves smart duration and media options while creating a task', async () => {
    mocks.create.mockImplementation((params, type) => {
      expect(validateGenerationParams(params, type).valid).toBe(true);
      expect(sanitizeGenerationParams(params).duration).toBe(-1);
      return { id: 'local_task', params };
    });
    const params = {
      reference_mode: 'mixed',
      audio: false,
      seed: 0,
      video_media: [
        { type: 'reference_videos', url: 'https://media.example.test/a.mp4' },
      ],
    };
    const result = await videoGenerationTool.execute(
      { model: 'wan3.0-video', prompt: 'animate', seconds: '-1', params },
      { mode: 'queue' }
    );
    expect(result.success).toBe(true);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      duration: -1,
      params,
    });
  });
  it('restores the ratio encoded in a historical Gemini size before adapter execution', async () => {
    mocks.generate.mockResolvedValue({
      url: 'https://media.example.test/result.mp4',
    });
    await videoGenerationTool.execute(
      { model: 'gemini-omni-1.2-flash', prompt: 'animate', size: '2160x3840' },
      { mode: 'async' }
    );
    expect(mocks.generate.mock.calls[0][1]).toMatchObject({
      size: '4k',
      params: { ratio: '9:16' },
    });
  });
  it('allows native Gemini and Kling content through async and queue prompt checks', async () => {
    mocks.generate.mockResolvedValue({
      url: 'https://media.example.test/result.mp4',
    });
    mocks.create.mockImplementation((params, type) => {
      expect(validateGenerationParams(params, type).valid).toBe(true);
      return { id: 'local_task', params };
    });
    for (const mode of ['async', 'queue'] as const) {
      expect(
        (
          await videoGenerationTool.execute(
            {
              model: 'gemini-omni-1.2-flash',
              params: { input: [{ type: 'text', text: 'animate' }] },
            },
            { mode }
          )
        ).success
      ).toBe(true);
      expect(
        (
          await videoGenerationTool.execute(
            {
              model: 'kling-4.0',
              params: { contents: [{ type: 'prompt', text: 'animate' }] },
            },
            { mode }
          )
        ).success
      ).toBe(true);
    }
  });
  it.each(['async', 'queue'] as const)(
    'still requires prompt for text-only models in %s mode',
    async (mode) => {
      expect(
        (
          await videoGenerationTool.execute(
            { model: 'happyhorse-1.1-t2v', prompt: '' },
            { mode }
          )
        ).success
      ).toBe(false);
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    }
  );
});

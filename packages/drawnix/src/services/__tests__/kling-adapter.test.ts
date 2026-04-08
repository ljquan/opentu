import { afterEach, describe, expect, it, vi } from 'vitest';
import { klingAdapter } from '../model-adapters/kling-adapter';
import type { ProviderModelBinding } from '../provider-routing';

function createKlingBinding(): ProviderModelBinding {
  return {
    id: 'kling-binding',
    profileId: 'provider-kling',
    modelId: 'kling_video',
    operation: 'video',
    protocol: 'kling.video',
    requestSchema: 'kling.video.auto-action-json',
    responseSchema: 'kling.video.task',
    submitPath: '/kling/v1/videos/{action}',
    pollPathTemplate: '/kling/v1/videos/{action}/{taskId}',
    priority: 620,
    confidence: 'high',
    source: 'template',
    metadata: {
      video: {
        versionField: 'model_name',
        defaultVersion: 'kling-v1-6',
        versionOptions: [
          'kling-v3',
          'kling-v2-6',
          'kling-v2-1',
          'kling-v1-6',
          'kling-v1-5',
        ],
        versionOptionsByAction: {
          text2video: [
            'kling-v3',
            'kling-v2-6',
            'kling-v2-1',
            'kling-v1-6',
            'kling-v1-5',
          ],
          image2video: [
            'kling-v3',
            'kling-v2-6',
            'kling-v2-1',
            'kling-v1-6',
            'kling-v1-5',
          ],
        },
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('kling adapter', () => {
  it('builds camera_control from flat params for text2video requests', async () => {
    vi.useFakeTimers();

    let submitBody: Record<string, unknown> | null = null;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) => {
        submitBody = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'ok',
            request_id: 'req-submit',
            data: {
              task_id: 'task-1',
              task_status: 'submitted',
              created_at: 1,
              updated_at: 1,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
      .mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'ok',
            request_id: 'req-poll',
            data: {
              task_id: 'task-1',
              task_status: 'succeed',
              task_result: {
                videos: [
                  {
                    id: 'video-1',
                    url: 'https://example.com/video.mp4',
                    duration: '5',
                  },
                ],
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      });

    const generation = klingAdapter.generateVideo(
      {
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
        binding: createKlingBinding(),
        fetcher,
      },
      {
        prompt: '一只猫在奔跑',
        model: 'kling_video',
        params: {
          klingAction2: 'text2video',
          model_name: 'kling-v2-6',
          mode: 'pro',
          cfg_scale: '0.7',
          negative_prompt: '模糊',
          camera_control_type: 'simple',
          camera_horizontal: '2',
          camera_zoom: '6',
        },
      }
    );

    await vi.runAllTimersAsync();
    const result = await generation;

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(submitBody).toMatchObject({
      model_name: 'kling-v2-6',
      mode: 'pro',
      cfg_scale: 0.7,
      negative_prompt: '模糊',
      camera_control: {
        type: 'simple',
        config: {
          horizontal: 2,
          zoom: 6,
        },
      },
    });
    expect(submitBody).not.toHaveProperty('camera_control_type');
    expect(submitBody).not.toHaveProperty('camera_horizontal');
    expect(submitBody).not.toHaveProperty('camera_zoom');
    expect(result.url).toBe('https://example.com/video.mp4');
    expect(result.duration).toBe(5);
  });

  it('strips data url prefixes from kling image inputs', async () => {
    vi.useFakeTimers();

    let submitBody: Record<string, unknown> | null = null;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) => {
        submitBody = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'ok',
            request_id: 'req-submit',
            data: {
              task_id: 'task-2',
              task_status: 'submitted',
              created_at: 1,
              updated_at: 1,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
      .mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'ok',
            request_id: 'req-poll',
            data: {
              task_id: 'task-2',
              task_status: 'succeed',
              task_result: {
                videos: [
                  {
                    id: 'video-2',
                    url: 'https://example.com/video-2.mp4',
                    duration: '10',
                  },
                ],
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      });

    const generation = klingAdapter.generateVideo(
      {
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
        binding: createKlingBinding(),
        fetcher,
      },
      {
        prompt: '让角色动起来',
        model: 'kling_video',
        referenceImages: [
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
          'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD',
        ],
        params: {
          model_name: 'kling-v3',
        },
      }
    );

    await vi.runAllTimersAsync();
    const result = await generation;

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(submitBody).toMatchObject({
      model_name: 'kling-v3',
      image: 'iVBORw0KGgoAAAANSUhEUgAAAAUA',
      image_tail: '/9j/4AAQSkZJRgABAQAAAQABAAD',
    });
    expect(result.url).toBe('https://example.com/video-2.mp4');
    expect(result.duration).toBe(10);
  });

  it('rejects unsupported kling data url mime types', async () => {
    await expect(
      klingAdapter.generateVideo(
        {
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'test-key',
          authType: 'bearer',
          binding: createKlingBinding(),
          fetcher: vi.fn<typeof fetch>(),
        },
        {
          prompt: '让角色动起来',
          model: 'kling_video',
          referenceImages: ['data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA=='],
        }
      )
    ).rejects.toThrow('Kling image 仅支持 JPG/JPEG/PNG 的 Data URL');
  });

  it('rejects cfg_scale values outside the supported range', async () => {
    await expect(
      klingAdapter.generateVideo(
        {
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'test-key',
          authType: 'bearer',
          binding: createKlingBinding(),
          fetcher: vi.fn<typeof fetch>(),
        },
        {
          prompt: '一只猫在奔跑',
          model: 'kling_video',
          params: {
            klingAction2: 'text2video',
            cfg_scale: '1.2',
          },
        }
      )
    ).rejects.toThrow('Kling 自由度 cfg_scale 必须在 0 到 1 之间');
  });

  it('rejects invalid camera_control values before submit', async () => {
    await expect(
      klingAdapter.generateVideo(
        {
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'test-key',
          authType: 'bearer',
          binding: createKlingBinding(),
          fetcher: vi.fn<typeof fetch>(),
        },
        {
          prompt: '一只猫在奔跑',
          model: 'kling_video',
          params: {
            klingAction2: 'text2video',
            camera_control: {
              type: 'simple',
              config: {
                zoom: 10.5,
              },
            },
          },
        }
      )
    ).rejects.toThrow('Kling 变焦 必须是 -10 到 10 之间的整数');
  });
});

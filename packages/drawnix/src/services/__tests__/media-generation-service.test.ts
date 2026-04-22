import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTaskMock = vi.fn();
const generateImageExecutorMock = vi.fn();
const generateVideoExecutorMock = vi.fn();
const waitForTaskCompletionMock = vi.fn();
const trackExternalTaskMock = vi.fn();
const syncTaskFromStorageMock = vi.fn();

vi.mock('../../utils/task-utils', () => ({
  generateTaskId: vi.fn(() => 'task-1'),
}));

vi.mock('../../utils/validation-utils', () => ({
  validateGenerationParams: vi.fn(() => ({ valid: true, errors: [] })),
  sanitizeGenerationParams: vi.fn((params) => params),
}));

vi.mock('../../utils/settings-manager', () => ({
  hasInvocationRouteCredentials: vi.fn(() => true),
  settingsManager: {
    waitForInitialization: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../media-executor/task-storage-writer', () => ({
  taskStorageWriter: {
    createTask: createTaskMock,
  },
}));

vi.mock('../media-executor', () => ({
  executorFactory: {
    getFallbackExecutor: vi.fn(() => ({
      generateImage: generateImageExecutorMock,
      generateVideo: generateVideoExecutorMock,
    })),
    getExecutor: vi.fn().mockResolvedValue({
      generateImage: generateImageExecutorMock,
      generateVideo: generateVideoExecutorMock,
    }),
  },
  waitForTaskCompletion: waitForTaskCompletionMock,
}));

vi.mock('../task-queue-service', () => ({
  taskQueueService: {
    trackExternalTask: trackExternalTaskMock,
    syncTaskFromStorage: syncTaskFromStorageMock,
  },
}));

describe('media generation services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitForTaskCompletionMock.mockResolvedValue({
      success: true,
      task: {
        id: 'task-1',
        type: 'image',
        status: 'completed',
        params: {
          prompt: '生成一个苹果',
          autoInsertToCanvas: true,
        },
        createdAt: 1,
        updatedAt: 2,
        result: {
          url: 'https://example.com/apple.png',
          format: 'png',
          size: 1,
        },
      },
    });
  });

  it('image generation tracks external tasks with autoInsertToCanvas enabled', async () => {
    const { generateImage } = await import('../media-generation/image-generation-service');

    await generateImage('生成一个苹果', {
      forceMainThread: true,
      model: 'gemini-3-pro-image-preview-vip',
      size: '1x1',
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      'task-1',
      'image',
      expect.objectContaining({
        prompt: '生成一个苹果',
        autoInsertToCanvas: true,
      })
    );
    expect(trackExternalTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        params: expect.objectContaining({
          prompt: '生成一个苹果',
          autoInsertToCanvas: true,
        }),
      })
    );
  });

  it('video generation tracks external tasks with autoInsertToCanvas enabled', async () => {
    waitForTaskCompletionMock.mockResolvedValueOnce({
      success: true,
      task: {
        id: 'task-1',
        type: 'video',
        status: 'completed',
        params: {
          prompt: '生成一个苹果视频',
          autoInsertToCanvas: true,
        },
        createdAt: 1,
        updatedAt: 2,
        result: {
          url: 'https://example.com/apple.mp4',
          format: 'mp4',
          size: 1,
        },
      },
    });

    const { generateVideo } = await import('../media-generation/video-generation-service');

    await generateVideo('生成一个苹果视频', {
      forceMainThread: true,
      model: 'veo3',
      size: '1280x720',
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      'task-1',
      'video',
      expect.objectContaining({
        prompt: '生成一个苹果视频',
        autoInsertToCanvas: true,
      })
    );
    expect(trackExternalTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        params: expect.objectContaining({
          prompt: '生成一个苹果视频',
          autoInsertToCanvas: true,
        }),
      })
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskType } from '../../types/shared/core.types';
import { TaskExecutionPhase, TaskStatus } from '../../types/task.types';
import type { Task } from '../../types/shared/core.types';

const createTaskMock = vi.fn(async () => undefined);
const getStoredTaskMock = vi.fn();
const trackExternalTaskMock = vi.fn();
const syncTaskFromStorageMock = vi.fn();
const markImageSubmissionAttemptedMock = vi.fn(async () => undefined);
const markImageAttemptRecoveringMock = vi.fn(async () => true);
const updateTaskStatusMock = vi.fn();
const getTaskMock = vi.fn();
const generateImageMock = vi.fn(async (_params?: any, _options?: any) => undefined);
const waitForTaskCompletionMock = vi.fn();
const waitForInitializationMock = vi.fn(async () => undefined);
const hasInvocationRouteCredentialsMock = vi.fn(() => true);
const getFallbackExecutorMock = vi.fn(() => ({
  generateImage: generateImageMock,
}));

vi.mock('../media-executor/task-storage-writer', () => ({
  taskStorageWriter: {
    createTask: createTaskMock,
    getTask: getStoredTaskMock,
  },
}));

vi.mock('../media-executor', () => ({
  executorFactory: {
    getFallbackExecutor: getFallbackExecutorMock,
    getExecutor: vi.fn(),
  },
  waitForTaskCompletion: waitForTaskCompletionMock,
}));

vi.mock('../../utils/settings-manager', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../utils/settings-manager')
  >();
  return {
    ...actual,
    settingsManager: {
      waitForInitialization: waitForInitializationMock,
    },
    hasInvocationRouteCredentials: hasInvocationRouteCredentialsMock,
  };
});

vi.mock('../task-queue-service', () => ({
  taskQueueService: {
    trackExternalTask: trackExternalTaskMock,
    syncTaskFromStorage: syncTaskFromStorageMock,
    markImageSubmissionAttempted: markImageSubmissionAttemptedMock,
    markImageAttemptRecovering: markImageAttemptRecoveringMock,
    updateTaskStatus: updateTaskStatusMock,
    getTask: getTaskMock,
  },
}));

vi.mock('../image-generation-recovery-service', () => ({
  createImageSubmissionParams: (
    params: Record<string, unknown>,
    requestId: string,
    attempted = false
  ) => ({
    ...params,
    submissionRequestId: requestId,
    imageSubmissionAttempted: attempted,
  }),
  getImageSubmissionRequestId: (task: Task) =>
    task.params.submissionRequestId || task.id,
  shouldRecoverImageSubmission: (task: Task, error: unknown) =>
    task.params.imageSubmissionAttempted === true &&
    error instanceof Error &&
    error.message === 'Failed to fetch',
}));

vi.mock('../../utils/task-utils', () => ({
  generateTaskId: () => 'task-image-1',
}));

describe('image-generation-service', () => {
  let currentTask: Task | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    currentTask = undefined;
    trackExternalTaskMock.mockImplementation((task: Task) => {
      currentTask = task;
    });
    getTaskMock.mockImplementation(() => currentTask);
    markImageSubmissionAttemptedMock.mockImplementation(async () => {
      if (currentTask) {
        currentTask = {
          ...currentTask,
          params: {
            ...currentTask.params,
            imageSubmissionAttempted: true,
          },
        };
      }
    });
    markImageAttemptRecoveringMock.mockImplementation(async () => {
      if (currentTask) {
        currentTask = {
          ...currentTask,
          status: TaskStatus.PROCESSING,
          executionPhase: TaskExecutionPhase.POLLING,
        };
      }
      return true;
    });
    updateTaskStatusMock.mockImplementation(
      (_taskId: string, status: TaskStatus, updates: Partial<Task>) => {
        if (currentTask) {
          currentTask = { ...currentTask, ...updates, status };
        }
      }
    );
    getStoredTaskMock.mockResolvedValue({
      id: 'task-image-1',
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      params: {
        prompt: 'Draw a rabbit',
        submissionRequestId: 'task-image-1',
        imageSubmissionAttempted: false,
      },
      createdAt: 1,
      updatedAt: 2,
      error: {
        code: 'IMAGE_GENERATION_ERROR',
        message: 'validation failed',
      },
    });

    waitForTaskCompletionMock.mockResolvedValue({
      success: true,
      task: {
        id: 'task-image-1',
        type: TaskType.IMAGE,
        status: TaskStatus.COMPLETED,
        params: { prompt: 'Edit this' },
        createdAt: 1,
        updatedAt: 1,
        result: {
          url: 'https://example.com/out.png',
          format: 'png',
          size: 1,
        },
      } satisfies Task,
    });
  });

  it('persists the full image contract for edit-capable GPT requests', async () => {
    const { generateImage } = await import(
      '../media-generation/image-generation-service'
    );

    await generateImage('Edit this', {
      forceMainThread: true,
      model: 'gpt-image-2',
      size: '16x9',
      resolution: '2k',
      quality: 'high',
      generationMode: 'image_to_image',
      referenceImages: ['https://example.com/reference.png'],
      maskImage: 'https://example.com/mask.png',
      inputFidelity: 'high',
      background: 'transparent',
      outputFormat: 'png',
      outputCompression: 80,
      uploadedImages: [{ url: 'https://example.com/reference.png' }],
      count: 2,
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      'task-image-1',
      'image',
      expect.objectContaining({
        prompt: 'Edit this',
        model: 'gpt-image-2',
        size: '16x9',
        resolution: '2k',
        quality: 'high',
        generationMode: 'image_to_image',
        referenceImages: ['https://example.com/reference.png'],
        maskImage: 'https://example.com/mask.png',
        inputFidelity: 'high',
        background: 'transparent',
        outputFormat: 'png',
        outputCompression: 80,
        uploadedImages: [{ url: 'https://example.com/reference.png' }],
        count: 2,
        params: {
          resolution: '2k',
          quality: 'high',
          n: 2,
        },
        submissionRequestId: 'task-image-1',
        imageSubmissionAttempted: false,
      }),
      expect.objectContaining({
        operation: 'image',
        modelId: 'gpt-image-2',
      })
    );

    expect(trackExternalTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-image-1',
        type: TaskType.IMAGE,
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.SUBMITTING,
        params: expect.objectContaining({
          resolution: '2k',
          quality: 'high',
          generationMode: 'image_to_image',
          referenceImages: ['https://example.com/reference.png'],
          maskImage: 'https://example.com/mask.png',
          params: {
            resolution: '2k',
            quality: 'high',
            n: 2,
          },
          submissionRequestId: 'task-image-1',
          imageSubmissionAttempted: false,
        }),
      })
    );

    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-image-1',
        requestId: 'task-image-1',
      }),
      expect.objectContaining({
        signal: undefined,
        isCurrentAttempt: expect.any(Function),
        onSubmissionAttempt: expect.any(Function),
      })
    );

    const executionOptions = generateImageMock.mock.calls[0]?.[1];
    expect(executionOptions?.isCurrentAttempt()).toBe(true);
    await executionOptions?.onSubmissionAttempt();
    expect(markImageSubmissionAttemptedMock).toHaveBeenCalledWith(
      'task-image-1',
      'task-image-1'
    );

    if (currentTask) {
      currentTask = {
        ...currentTask,
        params: {
          ...currentTask.params,
          submissionRequestId: 'retry-request-id',
        },
      };
    }
    expect(executionOptions?.isCurrentAttempt()).toBe(false);
  });

  it('continues waiting through recovery after an attempted submission disconnects', async () => {
    generateImageMock.mockImplementationOnce(async (_params, executionOptions) => {
      await executionOptions?.onSubmissionAttempt?.();
      throw new Error('Failed to fetch');
    });
    const { generateImage } = await import(
      '../media-generation/image-generation-service'
    );

    const result = await generateImage('Draw a rabbit', {
      forceMainThread: true,
      model: 'gpt-image-2',
    });

    expect(markImageAttemptRecoveringMock).toHaveBeenCalledWith(
      'task-image-1',
      'task-image-1'
    );
    expect(updateTaskStatusMock).not.toHaveBeenCalled();
    expect(waitForTaskCompletionMock).toHaveBeenCalledWith(
      'task-image-1',
      expect.objectContaining({ signal: undefined })
    );
    expect(result.url).toBe('https://example.com/out.png');
  });

  it('syncs a real pre-submission failure instead of entering recovery', async () => {
    generateImageMock.mockRejectedValueOnce(new Error('validation failed'));
    const { generateImage } = await import(
      '../media-generation/image-generation-service'
    );

    await expect(
      generateImage('Draw a rabbit', {
        forceMainThread: true,
        model: 'gpt-image-2',
      })
    ).rejects.toThrow('validation failed');

    expect(updateTaskStatusMock).not.toHaveBeenCalled();
    expect(syncTaskFromStorageMock).toHaveBeenCalledWith(
      'task-image-1',
      expect.objectContaining({
        status: TaskStatus.FAILED,
        error: expect.objectContaining({ message: 'validation failed' }),
      })
    );
    expect(waitForTaskCompletionMock).not.toHaveBeenCalled();
  });
});

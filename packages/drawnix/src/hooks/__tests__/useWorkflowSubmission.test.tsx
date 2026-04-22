// @vitest-environment jsdom
import { Subject } from 'rxjs';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition } from '../../components/ai-input-bar/workflow-converter';
import type { ParsedGenerationParams } from '../../utils/ai-input-parser';
import type { WorkflowCompletionEvent } from '../../services/workflow-completion-service';

const startWorkflowMock = vi.fn();
const restoreWorkflowMock = vi.fn();
const updateStepMock = vi.fn();
const addStepsMock = vi.fn();
const addStepsFromAIResponseMock = vi.fn();
const resetWorkflowMock = vi.fn();
const abortWorkflowMock = vi.fn();
const resumeWorkflowMock = vi.fn();
const getWorkflowMock = vi.fn(() => null);

const sendWorkflowMessageMock = vi.fn().mockResolvedValue(undefined);
const updateWorkflowMessageMock = vi.fn();

const initMock = vi.fn();
const registerCanvasHandlerMock = vi.fn();
const subscribeToAllEventsMock = vi.fn(() => ({
  unsubscribe: vi.fn(),
}));
const recoverWorkflowsMock = vi.fn().mockResolvedValue([]);
const subscribeToWorkflowMock = vi.fn(() => ({
  unsubscribe: vi.fn(),
}));
const submitMock = vi.fn().mockResolvedValue(undefined);
const cancelMock = vi.fn();
const observeCompletionEventsMock = vi.fn();
const isPostProcessingCompletedMock = vi.fn(() => false);
const getPostProcessingStatusMock = vi.fn();
const getTaskMock = vi.fn();
const completionEvents$ = new Subject<WorkflowCompletionEvent>();

vi.mock('../../contexts/WorkflowContext', () => ({
  useWorkflowControl: () => ({
    startWorkflow: startWorkflowMock,
    restoreWorkflow: restoreWorkflowMock,
    updateStep: updateStepMock,
    addSteps: addStepsMock,
    addStepsFromAIResponse: addStepsFromAIResponseMock,
    resetWorkflow: resetWorkflowMock,
    abortWorkflow: abortWorkflowMock,
    resumeWorkflow: resumeWorkflowMock,
    getWorkflow: getWorkflowMock,
  }),
}));

vi.mock('../../contexts/ChatDrawerContext', () => ({
  useChatDrawerControl: () => ({
    sendWorkflowMessage: sendWorkflowMessageMock,
    updateWorkflowMessage: updateWorkflowMessageMock,
  }),
}));

vi.mock('../useTaskWorkflowSync', () => ({
  useTaskWorkflowSync: vi.fn(),
}));

vi.mock('../../services/workflow-submission-service', () => ({
  workflowSubmissionService: {
    init: initMock,
    registerCanvasHandler: registerCanvasHandlerMock,
    subscribeToAllEvents: subscribeToAllEventsMock,
    recoverWorkflows: recoverWorkflowsMock,
    subscribeToWorkflow: subscribeToWorkflowMock,
    submit: submitMock,
    cancel: cancelMock,
  },
}));

vi.mock('../../services/workflow-completion-service', () => ({
  workflowCompletionService: {
    observeCompletionEvents: observeCompletionEventsMock,
    isPostProcessingCompleted: isPostProcessingCompletedMock,
    getPostProcessingStatus: getPostProcessingStatusMock,
  },
}));

vi.mock('../../services/task-queue-service', () => ({
  taskQueueService: {
    getTask: getTaskMock,
  },
}));

vi.mock('../../utils/settings-manager', () => ({
  geminiSettings: {
    get: () => ({
      textModelName: 'text-route-model',
      imageModelName: 'image-route-model',
      videoModelName: 'video-route-model',
      audioModelName: 'audio-route-model',
    }),
  },
  providerPricingCacheSettings: {
    get: () => [],
    set: vi.fn(),
  },
}));

vi.mock('../../plugins/with-workzone', () => ({
  WorkZoneTransforms: {
    updateWorkflow: vi.fn(),
    removeWorkZone: vi.fn(),
  },
}));

const createParsedInput = (
  overrides: Partial<ParsedGenerationParams> = {}
): ParsedGenerationParams => ({
  prompt: '生成一个苹果',
  userInstruction: '生成一个苹果',
  rawInput: '生成一个苹果',
  modelId: 'gemini-3-pro-image-preview-2k',
  modelRef: {
    profileId: 'image-profile',
    modelId: 'gemini-3-pro-image-preview-2k',
  },
  isModelExplicit: true,
  generationType: 'image',
  count: 1,
  scenario: 'direct_generation',
  selection: { texts: [], images: [], videos: [], graphics: [] },
  parseResult: {} as ParsedGenerationParams['parseResult'],
  hasExtraContent: false,
  ...overrides,
});

const createWorkflow = (
  overrides: Partial<WorkflowDefinition> = {}
): WorkflowDefinition => ({
  id: 'workflow-1',
  name: '图片生成',
  description: '生成图片',
  scenarioType: 'direct_generation',
  generationType: 'image',
  status: 'pending',
  createdAt: 123,
  updatedAt: 123,
  steps: [
    {
      id: 'step-1',
      mcp: 'generate_image',
      args: {
        prompt: '生成一个苹果',
        model: 'gemini-3-pro-image-preview-2k',
      },
      description: '生成图片 1/1',
      status: 'pending',
    },
  ],
  metadata: {
    prompt: '生成一个苹果',
    userInstruction: '生成一个苹果',
    rawInput: '生成一个苹果',
    modelId: 'gemini-3-pro-image-preview-2k',
    modelRef: {
      profileId: 'image-profile',
      modelId: 'gemini-3-pro-image-preview-2k',
    },
    isModelExplicit: true,
    count: 1,
    selection: { texts: [], images: [], videos: [], graphics: [] },
  },
  context: {
    userInput: '生成一个苹果',
    model: 'gemini-3-pro-image-preview-2k',
    modelRef: {
      profileId: 'image-profile',
      modelId: 'gemini-3-pro-image-preview-2k',
    },
    referenceImages: [],
  },
  ...overrides,
});

describe('useWorkflowSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkflowMock.mockReturnValue(null);
    recoverWorkflowsMock.mockResolvedValue([]);
    submitMock.mockResolvedValue(undefined);
    observeCompletionEventsMock.mockReturnValue(completionEvents$.asObservable());
    isPostProcessingCompletedMock.mockReturnValue(false);
    getPostProcessingStatusMock.mockReturnValue(undefined);
    getTaskMock.mockReturnValue(undefined);
  });

  it('默认 caller-owned 模式下只创建工作流消息，不立即提交执行', async () => {
    const { useWorkflowSubmission } = await import('../useWorkflowSubmission');
    const { result } = renderHook(() =>
      useWorkflowSubmission({
        boardRef: { current: null },
        workZoneIdRef: { current: null },
      })
    );

    const workflow = createWorkflow();
    const parsedInput = createParsedInput();

    await act(async () => {
      await result.current.submitWorkflow(parsedInput, [], undefined, workflow);
    });

    expect(startWorkflowMock).toHaveBeenCalledWith(workflow);
    expect(sendWorkflowMessageMock).toHaveBeenCalledTimes(1);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('service-owned 模式下会在发送工作流消息后真正提交执行', async () => {
    const { useWorkflowSubmission } = await import('../useWorkflowSubmission');
    const { result } = renderHook(() =>
      useWorkflowSubmission({
        boardRef: { current: null },
        workZoneIdRef: { current: null },
      })
    );

    const workflow = createWorkflow();
    const parsedInput = createParsedInput();

    await act(async () => {
      await result.current.submitWorkflow(parsedInput, [], undefined, workflow, {
        autoOpen: false,
        continueInCurrentSession: true,
        activateTargetSession: false,
        executionMode: 'service-owned',
      });
    });

    expect(sendWorkflowMessageMock).toHaveBeenCalledTimes(1);
    expect(sendWorkflowMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activateTargetSession: false,
      })
    );
    expect(subscribeToWorkflowMock).toHaveBeenCalledWith(
      workflow.id,
      expect.any(Function)
    );
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(submitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: workflow.id,
        name: workflow.name,
        status: 'pending',
        steps: expect.arrayContaining([
          expect.objectContaining({
            id: 'step-1',
            mcp: 'generate_image',
            status: 'pending',
          }),
        ]),
        context: expect.objectContaining({
          userInput: '生成一个苹果',
          model: 'gemini-3-pro-image-preview-2k',
          referenceImages: [],
        }),
      })
    );
  });

  it('service-owned 提交失败时会把当前工作流同步为 failed', async () => {
    submitMock.mockRejectedValueOnce(new Error('submit failed'));

    const { useWorkflowSubmission } = await import('../useWorkflowSubmission');
    const { result } = renderHook(() =>
      useWorkflowSubmission({
        boardRef: { current: null },
        workZoneIdRef: { current: null },
      })
    );

    const workflow = createWorkflow();
    const parsedInput = createParsedInput();

    await act(async () => {
      await expect(
        result.current.submitWorkflow(parsedInput, [], undefined, workflow, {
          executionMode: 'service-owned',
        })
      ).rejects.toThrow('submit failed');
    });

    await waitFor(() => {
      expect(restoreWorkflowMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workflow.id,
          status: 'failed',
          error: 'submit failed',
        })
      );
      expect(updateWorkflowMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workflow.id,
          status: 'failed',
          error: 'submit failed',
        })
      );
    });
  });

  it('后处理开始和完成事件会同步更新工作流消息状态', async () => {
    const { useWorkflowSubmission } = await import('../useWorkflowSubmission');
    const { result } = renderHook(() =>
      useWorkflowSubmission({
        boardRef: { current: null },
        workZoneIdRef: { current: null },
      })
    );

    const workflow = createWorkflow({
      status: 'running',
      steps: [
        {
          id: 'step-1',
          mcp: 'generate_image',
          args: {
            prompt: '生成一个苹果',
            model: 'gemini-3-pro-image-preview-2k',
          },
          description: '生成图片 1/1',
          status: 'completed',
          result: {
            taskId: 'task-1',
            result: { url: 'https://example.com/apple.png' },
          },
        },
      ],
    });
    const parsedInput = createParsedInput();

    getWorkflowMock.mockReturnValue(workflow);

    await act(async () => {
      await result.current.submitWorkflow(parsedInput, [], undefined, workflow);
    });

    act(() => {
      completionEvents$.next({
        type: 'postProcessingStarted',
        taskId: 'task-1',
        result: {
          taskId: 'task-1',
          status: 'processing',
          type: 'direct_insert',
        },
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(updateWorkflowMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workflow.id,
          postProcessingStatus: 'processing',
        })
      );
    });

    act(() => {
      completionEvents$.next({
        type: 'postProcessingCompleted',
        taskId: 'task-1',
        result: {
          taskId: 'task-1',
          status: 'completed',
          type: 'direct_insert',
          insertedCount: 1,
        },
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(updateWorkflowMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workflow.id,
          postProcessingStatus: 'completed',
          insertedCount: 1,
        })
      );
    });
  });

  it('后处理完成时会触发调用方提供的完成回调', async () => {
    const onPostProcessingCompleted = vi.fn();
    const { useWorkflowSubmission } = await import('../useWorkflowSubmission');
    const { result } = renderHook(() =>
      useWorkflowSubmission({
        boardRef: { current: null },
        workZoneIdRef: { current: null },
        onPostProcessingCompleted,
      })
    );

    const workflow = createWorkflow({
      status: 'running',
      steps: [
        {
          id: 'step-1',
          mcp: 'generate_image',
          args: {
            prompt: '生成一个苹果',
            model: 'gemini-3-pro-image-preview-2k',
          },
          description: '生成图片 1/1',
          status: 'completed',
          result: {
            taskId: 'task-2',
            result: { url: 'https://example.com/apple.png' },
          },
        },
      ],
    });
    const parsedInput = createParsedInput();

    getWorkflowMock.mockReturnValue(workflow);

    await act(async () => {
      await result.current.submitWorkflow(parsedInput, [], undefined, workflow);
    });

    act(() => {
      completionEvents$.next({
        type: 'postProcessingCompleted',
        taskId: 'task-2',
        result: {
          taskId: 'task-2',
          status: 'completed',
          type: 'direct_insert',
          insertedCount: 1,
          firstElementPosition: [120, 180],
        },
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(onPostProcessingCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-2',
          result: expect.objectContaining({
            insertedCount: 1,
            firstElementPosition: [120, 180],
          }),
        })
      );
    });
  });

  it('后处理失败事件会把工作流消息切到 failed', async () => {
    const { useWorkflowSubmission } = await import('../useWorkflowSubmission');
    const { result } = renderHook(() =>
      useWorkflowSubmission({
        boardRef: { current: null },
        workZoneIdRef: { current: null },
      })
    );

    const workflow = createWorkflow({
      status: 'running',
      steps: [
        {
          id: 'step-1',
          mcp: 'generate_image',
          args: {
            prompt: '生成一个苹果',
            model: 'gemini-3-pro-image-preview-2k',
          },
          description: '生成图片 1/1',
          status: 'completed',
          result: {
            taskId: 'task-3',
            result: { url: 'https://example.com/apple.png' },
          },
        },
      ],
    });
    const parsedInput = createParsedInput();

    getWorkflowMock.mockReturnValue(workflow);

    await act(async () => {
      await result.current.submitWorkflow(parsedInput, [], undefined, workflow);
    });

    act(() => {
      completionEvents$.next({
        type: 'postProcessingFailed',
        taskId: 'task-3',
        result: {
          taskId: 'task-3',
          status: 'failed',
          type: 'direct_insert',
          error: 'insert failed',
        },
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(updateWorkflowMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workflow.id,
          postProcessingStatus: 'failed',
        })
      );
    });
  });

  it('步骤已完成且任务已插入画布时会回填 completed 后处理状态', async () => {
    let workflowCallback:
      | ((event: {
          type: 'step';
          workflowId: string;
          stepId: string;
          status: 'completed';
          result: { taskId: string; url: string };
        }) => Promise<void>)
      | undefined;

    subscribeToWorkflowMock.mockImplementation(
      (_workflowId: string, callback: typeof workflowCallback) => {
        workflowCallback = callback;
        return { unsubscribe: vi.fn() };
      }
    );

    const { useWorkflowSubmission } = await import('../useWorkflowSubmission');
    const { result } = renderHook(() =>
      useWorkflowSubmission({
        boardRef: { current: null },
        workZoneIdRef: { current: null },
      })
    );

    const workflow = createWorkflow({
      status: 'running',
      steps: [
        {
          id: 'step-1',
          mcp: 'generate_image',
          args: {
            prompt: '生成一个苹果',
            model: 'gemini-3-pro-image-preview-2k',
          },
          description: '生成图片 1/1',
          status: 'running',
          result: {
            taskId: 'task-4',
          },
        },
      ],
    });

    const completedWorkflow = {
      ...workflow,
      steps: [
        {
          ...workflow.steps[0],
          status: 'completed' as const,
          result: {
            taskId: 'task-4',
            url: 'https://example.com/apple.png',
          },
        },
      ],
    };

    getWorkflowMock.mockReturnValue(completedWorkflow);
    getTaskMock.mockReturnValue({
      id: 'task-4',
      insertedToCanvas: true,
    });

    await act(async () => {
      await result.current.submitWorkflow(
        createParsedInput(),
        [],
        undefined,
        workflow,
        {
          executionMode: 'service-owned',
        }
      );
    });

    await act(async () => {
      await workflowCallback?.({
        type: 'step',
        workflowId: workflow.id,
        stepId: 'step-1',
        status: 'completed',
        result: {
          taskId: 'task-4',
          url: 'https://example.com/apple.png',
        },
      });
    });

    await waitFor(() => {
      expect(updateWorkflowMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: workflow.id,
          postProcessingStatus: 'completed',
          insertedCount: 1,
        })
      );
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildImageGenerationAnchorViewModel,
  deriveImageGenerationAnchorPhase,
} from '../image-generation-anchor-view-model';
import { workflowCompletionService } from '../../services/workflow-completion-service';
import type { WorkflowMessageData } from '../../types/chat.types';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';
import type { PlaitImageGenerationAnchor } from '../../types/image-generation-anchor.types';

function createAnchor(
  overrides: Partial<PlaitImageGenerationAnchor> = {}
): PlaitImageGenerationAnchor {
  return {
    id: 'anchor-1',
    type: 'generation-anchor',
    points: [
      [10, 20],
      [330, 200],
    ],
    angle: 0,
    anchorType: 'ratio',
    phase: 'submitted',
    title: '图片生成',
    subtitle: '已提交，等待执行',
    progress: null,
    error: undefined,
    transitionMode: 'hold',
    createdAt: 1,
    workflowId: 'wf-1',
    taskIds: ['task-1'],
    primaryTaskId: 'task-1',
    expectedInsertPosition: [10, 20],
    targetFrameId: undefined,
    targetFrameDimensions: undefined,
    requestedSize: '16x9',
    requestedCount: 1,
    zoom: 1,
    children: [],
    ...overrides,
  };
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.PENDING,
    params: {
      prompt: '生成图片',
      workflowId: 'wf-1',
      size: '16x9',
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createWorkflow(
  overrides: Partial<WorkflowMessageData> = {}
): WorkflowMessageData {
  return {
    id: 'wf-1',
    name: '图片生成',
    generationType: 'image',
    prompt: '生成图片',
    count: 1,
    steps: [],
    ...overrides,
  };
}

describe('image-generation-anchor-view-model', () => {
  afterEach(() => {
    vi.useRealTimers();
    workflowCompletionService.clear();
  });

  it('maps processing + submitting task to queued phase', () => {
    const phase = deriveImageGenerationAnchorPhase({
      anchor: createAnchor(),
      task: createTask({
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.SUBMITTING,
      }),
    });

    expect(phase).toBe('queued');
  });

  it('uses simulated image progress during queued processing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T08:00:00.000Z'));

    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({ phase: 'submitted' }),
      task: createTask({
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.SUBMITTING,
        startedAt: Date.now() - 90_000,
      }),
    });

    expect(viewModel.phase).toBe('queued');
    expect(viewModel.progressMode).toBe('determinate');
    expect(viewModel.progress).toBeGreaterThan(0);
  });

  it('maps processing task without submitting phase to generating', () => {
    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({ phase: 'queued' }),
      task: createTask({
        status: TaskStatus.PROCESSING,
        progress: 42,
      }),
    });

    expect(viewModel.phase).toBe('generating');
    expect(viewModel.progress).toBe(42);
    expect(viewModel.progressMode).toBe('determinate');
    expect(viewModel.phaseLabel).toBe('生成中');
    expect(viewModel.subtitle).toBe('图片正在生成，请稍候');
  });

  it('prefers shared task display progress when provided', () => {
    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({ phase: 'queued', progress: 0 }),
      task: createTask({
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.SUBMITTING,
        startedAt: Date.now(),
      }),
      taskDisplayProgress: 42,
    });

    expect(viewModel.phase).toBe('queued');
    expect(viewModel.progressMode).toBe('determinate');
    expect(viewModel.progress).toBe(42);
  });

  it('uses developing phase during post-processing and falls back to derived subtitle', () => {
    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({
        phase: 'submitted',
        subtitle: '旧提示文案',
      }),
      task: createTask({
        status: TaskStatus.COMPLETED,
      }),
      postProcessingStatus: 'processing',
    });

    expect(viewModel.phase).toBe('developing');
    expect(viewModel.progressMode).toBe('hidden');
    expect(viewModel.subtitle).toBe('结果已返回，正在准备显影');
    expect(viewModel.tone).toBe('warning');
  });

  it('marks inserted result as completed and terminal', () => {
    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({ phase: 'inserting' }),
      task: createTask({
        status: TaskStatus.COMPLETED,
        insertedToCanvas: true,
      }),
      hasInserted: true,
    });

    expect(viewModel.phase).toBe('completed');
    expect(viewModel.subtitle).toBe('图片已稳定落位');
    expect(viewModel.progressMode).toBe('hidden');
    expect(viewModel.tone).toBe('success');
    expect(viewModel.isTerminal).toBe(true);
  });

  it('marks failed post-processing as failed and surfaces workflow error', () => {
    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({ phase: 'developing' }),
      task: createTask({
        status: TaskStatus.COMPLETED,
      }),
      workflow: createWorkflow({
        postProcessingStatus: 'failed',
        error: '插入失败',
      }),
    });

    expect(viewModel.phase).toBe('failed');
    expect(viewModel.failureStage).toBe('post-processing');
    expect(viewModel.phaseLabel).toBe('已生成，插入失败');
    expect(viewModel.subtitle).toBe('图片已生成，加载或插入失败，可重试插入已有结果');
    expect(viewModel.primaryAction.label).toBe('重试插入');
    expect(viewModel.error).toBe('插入失败');
    expect(viewModel.primaryAction.type).toBe('retry');
    expect(viewModel.progressMode).toBe('hidden');
    expect(viewModel.secondaryAction?.type).toBe('dismiss');
  });

  it('overrides an old generation-failed subtitle for a completed task', () => {
    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({ phase: 'failed', subtitle: '生成失败，请重试' }),
      task: createTask({ status: TaskStatus.COMPLETED }),
      postProcessingStatus: 'failed',
    });

    expect(viewModel.phaseLabel).toBe('已生成，插入失败');
    expect(viewModel.subtitle).not.toContain('生成失败');
    expect(viewModel.primaryAction.label).toBe('重试插入');
  });

  it('keeps generation failures distinct from result insertion failures', () => {
    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor(),
      task: createTask({ status: TaskStatus.FAILED }),
      postProcessingStatus: 'failed',
    });

    expect(viewModel.failureStage).toBe('generation');
    expect(viewModel.subtitle).toBe('生成失败，可从当前位置重试');
    expect(viewModel.primaryAction.label).toBe('重试');
  });

  it('labels a completed batch with failed insertion as already generated', () => {
    const tasks = ['task-1', 'task-2'].map((id) => {
      workflowCompletionService.failPostProcessing(id, '图片加载失败');
      return createTask({
        id,
        status: TaskStatus.COMPLETED,
        result: { url: `https://example.com/${id}.png`, format: 'png', size: 0 },
      });
    });
    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({ anchorType: 'stack', requestedCount: 2 }),
      task: tasks[0],
      tasks,
      postProcessingStatus: 'failed',
    });

    expect(viewModel.batchPreview?.statusText).toBe('已生成，插入失败');
    expect(viewModel.batchPreview?.failedSlotCount).toBe(2);
    expect(viewModel.batchPreview?.slots.every(
      (slot) => slot.failureStage === 'post-processing'
    )).toBe(true);
    expect(viewModel.primaryAction.label).toBe('重试插入');
  });

  it('builds batch preview slots for stack anchors during generation', () => {
    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({
        anchorType: 'stack',
        requestedCount: 4,
        taskIds: ['task-1'],
      }),
      task: createTask({
        status: TaskStatus.PROCESSING,
        progress: 18,
      }),
      tasks: [
        createTask({
          status: TaskStatus.PROCESSING,
          progress: 18,
        }),
      ],
    });

    expect(viewModel.batchPreview).toEqual({
      totalCount: 4,
      visibleSlotCount: 4,
      overflowCount: 0,
      readySlotCount: 0,
      generatingSlotCount: 4,
      pendingSlotCount: 0,
      failedSlotCount: 0,
      hasPreviewImage: false,
      progress: 18,
      statusText: '分析提示词...',
      slots: [
        {
          id: 'task-1',
          taskId: 'task-1',
          status: 'generating',
        },
        {
          id: 'placeholder-1',
          status: 'generating',
        },
        {
          id: 'placeholder-2',
          status: 'generating',
        },
        {
          id: 'placeholder-3',
          status: 'generating',
        },
      ],
    });
  });

  it('maps inserted and failed task results into per-slot batch previews', () => {
    workflowCompletionService.completePostProcessing('task-1', 1, [10, 20]);
    workflowCompletionService.failPostProcessing('task-2', '插入失败');

    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({
        anchorType: 'stack',
        phase: 'developing',
        requestedCount: 4,
      }),
      task: createTask({
        status: TaskStatus.COMPLETED,
      }),
      tasks: [
        createTask({
          id: 'task-1',
          status: TaskStatus.COMPLETED,
          result: {
            url: 'https://example.com/1.png',
          } as Task['result'],
        }),
        createTask({
          id: 'task-2',
          status: TaskStatus.FAILED,
          error: {
            code: 'POST_PROCESSING',
            message: '插入失败',
          },
        }),
      ],
      postProcessingStatus: 'processing',
    });

    expect(viewModel.batchPreview).toEqual({
      totalCount: 4,
      visibleSlotCount: 4,
      overflowCount: 0,
      readySlotCount: 1,
      generatingSlotCount: 2,
      pendingSlotCount: 0,
      failedSlotCount: 1,
      hasPreviewImage: true,
      progress: 100,
      statusText: '1/4 已完成',
      slots: [
        {
          id: 'task-1-0',
          taskId: 'task-1',
          status: 'ready',
          previewImageUrl: 'https://example.com/1.png',
          error: undefined,
        },
        {
          id: 'task-2',
          taskId: 'task-2',
          status: 'failed',
          error: '插入失败',
        },
        {
          id: 'placeholder-2',
          status: 'generating',
        },
        {
          id: 'placeholder-3',
          status: 'generating',
        },
      ],
    });
  });

  it('keeps batch slot ordering stable by creation time', () => {
    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({
        anchorType: 'stack',
        requestedCount: 2,
      }),
      tasks: [
        createTask({
          id: 'task-b',
          createdAt: 2,
          updatedAt: 99,
          status: TaskStatus.PROCESSING,
        }),
        createTask({
          id: 'task-a',
          createdAt: 1,
          updatedAt: 1000,
          status: TaskStatus.PROCESSING,
        }),
      ],
    });

    expect(viewModel.batchPreview?.slots.map((slot) => slot.taskId)).toEqual([
      'task-a',
      'task-b',
    ]);
  });

  it('does not collapse the whole stack anchor into failed when only one slot fails', () => {
    workflowCompletionService.failPostProcessing('task-2', '插入失败');

    const viewModel = buildImageGenerationAnchorViewModel({
      anchor: createAnchor({
        anchorType: 'stack',
        requestedCount: 2,
      }),
      task: createTask({
        id: 'task-1',
        status: TaskStatus.PROCESSING,
        progress: 32,
      }),
      tasks: [
        createTask({
          id: 'task-1',
          status: TaskStatus.PROCESSING,
          progress: 32,
        }),
        createTask({
          id: 'task-2',
          status: TaskStatus.FAILED,
          error: {
            code: 'POST_PROCESSING',
            message: '插入失败',
          },
        }),
      ],
    });

    expect(viewModel.phase).toBe('generating');
    expect(viewModel.batchPreview?.failedSlotCount).toBe(1);
    expect(viewModel.batchPreview?.statusText).toBe('1/2 已处理');
  });
});

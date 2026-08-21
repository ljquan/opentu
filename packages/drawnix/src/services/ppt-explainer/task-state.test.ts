import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';
import type { PptExplainerTaskState } from './types';
import {
  confirmPptExplainerOutline,
  createPptExplainerRootTask,
  persistDetachedPptExplainerRootTask,
  trackPptExplainerRootTask,
  updatePptExplainerRootTask,
} from './task-state';

const mocks = vi.hoisted(() => ({
  tasks: new Map<string, Task>(),
  saveTask: vi.fn(),
  trackExternalTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  generateTaskId: vi.fn(),
  callOrder: [] as string[],
}));

vi.mock('../../utils/task-utils', () => ({
  generateTaskId: mocks.generateTaskId,
}));

vi.mock('../media-executor/task-storage-writer', () => ({
  taskStorageWriter: { saveTask: mocks.saveTask },
}));

vi.mock('../task-queue', () => ({
  taskQueueService: {
    getTask: (taskId: string) => mocks.tasks.get(taskId),
    trackExternalTask: mocks.trackExternalTask,
    updateTaskStatus: mocks.updateTaskStatus,
  },
}));

function createState(
  overrides: Partial<PptExplainerTaskState> = {}
): PptExplainerTaskState {
  return {
    schemaVersion: 1,
    jobId: 'job-detached',
    source: 'topic',
    sourceBoardId: 'board-1',
    topic: '季度复盘',
    reviewMode: 'confirm',
    presenterMode: 'single_voice',
    speakers: [{ id: 'host', displayName: '主持人', voiceId: 'voice-1' }],
    stage: 'preparing',
    slides: [],
    idempotencyKey: 'job-detached',
    presentationInput: 'slide_images',
    originalRoute: {
      schemaVersion: 2,
      operation: 'video',
      providerProfileId: 'profile-1',
      canonicalBaseUrl: 'https://api.example.com/v1',
      modelRef: { profileId: 'profile-1', modelId: 'video-model' },
      binding: {
        id: 'ppt-explainer',
        protocol: 'tuzi.ppt-explainer',
        requestSchema: 'tuzi.ppt-explainer.multipart-v1',
        responseSchema: 'tuzi.ppt-explainer.task-v1',
        submitPath: '/ppt/jobs',
        pollPathTemplate: '/ppt/jobs/{remoteId}',
        pptExplainer: {
          capabilities: {
            sources: ['topic'],
            presentationInputs: ['slide_images'],
            presenterModes: ['single_voice'],
            finalComposition: true,
          },
          responsePaths: {
            submit: { remoteId: 'id' },
            poll: { status: 'status', finalVideoUrl: 'url' },
          },
          statusMapping: {
            queued: ['queued'],
            processing: ['processing'],
            completed: ['completed'],
            failed: ['failed'],
          },
        },
      },
    },
    models: {
      textModel: 'text-model',
      videoModel: 'video-model',
      videoModelRef: { profileId: 'profile-1', modelId: 'video-model' },
    },
    delivery: { resultSaved: false, canvasInserted: false },
    executionAttempt: 0,
    ...overrides,
  };
}

function createTask(
  state: PptExplainerTaskState,
  overrides: Partial<Task> = {}
): Task {
  return {
    id: 'root-task',
    type: TaskType.VIDEO,
    status: TaskStatus.PROCESSING,
    params: { prompt: state.topic || 'PPT 讲解视频', pptExplainer: state },
    createdAt: 1,
    updatedAt: 1,
    progress: 5,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.tasks.clear();
  mocks.callOrder.length = 0;
  vi.clearAllMocks();
  mocks.generateTaskId.mockReturnValue('root-task');
  mocks.saveTask.mockImplementation(async (task: Task) => {
    mocks.callOrder.push('persist');
    expect(JSON.stringify(task)).not.toContain('apiKey');
  });
  mocks.trackExternalTask.mockImplementation((task: Task) => {
    mocks.callOrder.push('track');
    mocks.tasks.set(task.id, task);
  });
  mocks.updateTaskStatus.mockImplementation(
    (taskId: string, status: TaskStatus, updates: Partial<Task> = {}) => {
      const current = mocks.tasks.get(taskId);
      if (!current) return;
      mocks.tasks.set(taskId, {
        ...current,
        ...updates,
        status,
        updatedAt: current.updatedAt + 1,
      });
    }
  );
});

describe('PPT explainer root task state', () => {
  it('persists and registers a detached preparing root before orchestration', async () => {
    const state = createState();

    const task = await createPptExplainerRootTask(state);

    expect(task).toMatchObject({
      id: 'root-task',
      type: TaskType.VIDEO,
      status: TaskStatus.PENDING,
      params: {
        autoInsertToCanvas: true,
        pptExplainer: {
          stage: 'preparing',
          idempotencyKey: 'job-detached',
        },
      },
    });
    expect(mocks.callOrder).toEqual(['persist', 'track']);
    expect(mocks.tasks.get('root-task')).toBe(task);
  });

  it('keeps a partial source checkpoint detached until explicitly registered', async () => {
    const initialState = createState({ source: 'pptx' });
    const detached = await createPptExplainerRootTask(initialState, {
      track: false,
    });

    expect(mocks.trackExternalTask).not.toHaveBeenCalled();
    expect(mocks.saveTask).toHaveBeenCalledTimes(1);

    const checkpointed = await persistDetachedPptExplainerRootTask(detached, {
      state: {
        ...initialState,
        diagnostics: ['已保存第 1 页检查点'],
      },
      status: TaskStatus.PENDING,
      progress: 12,
    });

    expect(checkpointed).toMatchObject({
      id: detached.id,
      status: TaskStatus.PENDING,
      progress: 12,
      params: {
        pptExplainer: { diagnostics: ['已保存第 1 页检查点'] },
      },
    });
    expect(mocks.saveTask).toHaveBeenCalledTimes(2);
    expect(mocks.trackExternalTask).not.toHaveBeenCalled();

    trackPptExplainerRootTask(checkpointed);
    expect(mocks.trackExternalTask).toHaveBeenCalledWith(checkpointed);
    expect(mocks.tasks.get(detached.id)).toBe(checkpointed);
  });

  it('rejects stale execution attempts and terminal late writes', async () => {
    const state = createState({ executionAttempt: 2, stage: 'polling' });
    mocks.tasks.set('root-task', createTask(state));

    await expect(
      updatePptExplainerRootTask(
        'root-task',
        {
          state: { ...state, stage: 'completed' },
          status: TaskStatus.COMPLETED,
        },
        { expectedExecutionAttempt: 1 }
      )
    ).resolves.toBeNull();
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();

    mocks.tasks.set(
      'root-task',
      createTask(
        { ...state, stage: 'cancelled' },
        { status: TaskStatus.CANCELLED }
      )
    );
    await expect(
      updatePptExplainerRootTask(
        'root-task',
        {
          state: { ...state, stage: 'completed' },
          status: TaskStatus.COMPLETED,
        },
        { expectedExecutionAttempt: 2 }
      )
    ).resolves.toBeNull();
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();

    mocks.tasks.set(
      'root-task',
      createTask({ ...state, stage: 'failed' }, { status: TaskStatus.FAILED })
    );
    await expect(
      updatePptExplainerRootTask(
        'root-task',
        {
          state: { ...state, stage: 'completed' },
          status: TaskStatus.COMPLETED,
        },
        { expectedExecutionAttempt: 2 }
      )
    ).resolves.toBeNull();
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('confirms a review-pending outline exactly once', async () => {
    const state = createState({ stage: 'review_pending' });
    mocks.tasks.set(
      'root-task',
      createTask(state, { status: TaskStatus.PENDING })
    );

    const confirmed = await confirmPptExplainerOutline('root-task', {
      frameIds: ['frame-2', 'frame-1'],
      frameRevisions: {
        'frame-2': 'revision-2',
        'frame-1': 'revision-1',
      },
    });

    expect(confirmed).toMatchObject({
      status: TaskStatus.PENDING,
      progress: 10,
      params: {
        pptExplainer: {
          stage: 'snapshotting',
          reviewAcceptedAt: expect.any(Number),
          outlineFrameIds: ['frame-2', 'frame-1'],
          sourceFrameRevisions: {
            'frame-2': 'revision-2',
            'frame-1': 'revision-1',
          },
        },
      },
    });
    await expect(confirmPptExplainerOutline('root-task')).rejects.toThrow(
      '不在大纲确认阶段'
    );
  });

  it('preserves remoteId and the idempotency key across guarded updates', async () => {
    const state = createState({
      stage: 'polling',
      remoteId: 'remote-1',
      idempotencyKey: 'stable-idempotency-key',
      executionAttempt: 3,
    });
    mocks.tasks.set(
      'root-task',
      createTask(state, {
        remoteId: 'remote-1',
        executionPhase: TaskExecutionPhase.POLLING,
      })
    );

    const updated = await updatePptExplainerRootTask(
      'root-task',
      {
        state: { ...state, diagnostics: ['恢复轮询'] },
        progress: 75,
        executionPhase: TaskExecutionPhase.POLLING,
      },
      { expectedExecutionAttempt: 3 }
    );

    expect(updated).toMatchObject({
      remoteId: 'remote-1',
      params: {
        pptExplainer: {
          remoteId: 'remote-1',
          idempotencyKey: 'stable-idempotency-key',
        },
      },
    });
  });

  it('skips stale queued snapshots and persists only the latest task object', async () => {
    const state = createState({ executionAttempt: 1, stage: 'finalizing' });
    mocks.tasks.set('root-task', createTask(state));
    mocks.updateTaskStatus.mockImplementation(
      (taskId: string, status: TaskStatus, updates: Partial<Task> = {}) => {
        const current = mocks.tasks.get(taskId);
        if (!current) return;
        mocks.tasks.set(taskId, {
          ...current,
          ...updates,
          status,
          updatedAt: 2,
        });
      }
    );
    let releaseFirstSave!: () => void;
    const firstSaveBlocked = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const savedDiagnostics: Array<string | undefined> = [];
    mocks.saveTask.mockImplementation(async (task: Task) => {
      savedDiagnostics.push(task.params.pptExplainer?.diagnostics?.at(-1));
      if (savedDiagnostics.length === 1) await firstSaveBlocked;
    });

    const firstUpdate = updatePptExplainerRootTask(
      'root-task',
      {
        state: { ...state, diagnostics: ['第一笔'] },
        progress: 81,
      },
      { expectedExecutionAttempt: 1 }
    );
    await vi.waitFor(() => expect(mocks.saveTask).toHaveBeenCalledTimes(1));

    const secondUpdate = updatePptExplainerRootTask(
      'root-task',
      {
        state: { ...state, diagnostics: ['第二笔'] },
        progress: 82,
      },
      { expectedExecutionAttempt: 1 }
    );
    const secondTask = mocks.tasks.get('root-task');
    const thirdUpdate = updatePptExplainerRootTask(
      'root-task',
      {
        state: { ...state, diagnostics: ['第三笔'] },
        progress: 83,
      },
      { expectedExecutionAttempt: 1 }
    );
    const thirdTask = mocks.tasks.get('root-task');

    expect(secondTask).not.toBe(thirdTask);
    expect(secondTask?.updatedAt).toBe(thirdTask?.updatedAt);
    releaseFirstSave();
    await Promise.all([firstUpdate, secondUpdate, thirdUpdate]);

    expect(mocks.saveTask).toHaveBeenCalledTimes(2);
    expect(savedDiagnostics).toEqual(['第一笔', '第三笔']);
  });
});

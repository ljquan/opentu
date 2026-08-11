import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStatus, TaskType, type Task } from '../types/task.types';

const mocks = vi.hoisted(() => ({
  activeBoard: null as { children: Array<{ id: string }> } | null,
  boundBoardId: 'board-1' as string | null,
  createCanvasAssociationLines: vi.fn(),
  createLongVideoSegmentTask: vi.fn(),
  currentBoardId: 'board-1' as string | null,
  getCanvasBoard: vi.fn(),
  mergeVideos: vi.fn(),
  quickInsert: vi.fn(),
  retargetCanvasAssociationLines: vi.fn(),
  subscribers: [] as Array<(event: { type: string; task: Task }) => void>,
  workspaceSubscribers: [] as Array<(event: { type: string }) => void>,
}));

vi.mock('./task-queue', () => ({
  taskQueueService: {
    observeTaskUpdates: vi.fn(() => ({
      subscribe: (
        subscriber: (event: { type: string; task: Task }) => void
      ) => {
        mocks.subscribers.push(subscriber);
        return { unsubscribe: vi.fn() };
      },
    })),
  },
}));

vi.mock('@aitu/utils', () => ({
  extractLastFrame: vi.fn(),
}));

vi.mock('./video-merge-webcodecs', () => ({
  mergeVideos: mocks.mergeVideos,
}));

vi.mock('./canvas-operations/long-video', () => ({
  createLongVideoSegmentTask: mocks.createLongVideoSegmentTask,
}));

vi.mock('./canvas-operations/canvas-insertion', () => ({
  getCanvasBoard: mocks.getCanvasBoard,
  getCanvasBoardBinding: () =>
    mocks.activeBoard
      ? { board: mocks.activeBoard, boardId: mocks.boundBoardId }
      : null,
  quickInsert: mocks.quickInsert,
}));

vi.mock('../plugins/canvas-association', () => ({
  canInsertCanvasAssociationsOnBoard: (
    associations: Array<{ boardId: string }>,
    currentBoardId: string | null
  ) => {
    const boardIds = new Set(
      associations.map((association) => association.boardId.trim())
    );
    return boardIds.size === 1 && boardIds.has(currentBoardId || '');
  },
  createCanvasAssociationLines: mocks.createCanvasAssociationLines,
  retargetCanvasAssociationLines: mocks.retargetCanvasAssociationLines,
}));

vi.mock('./workspace-service', () => ({
  workspaceService: {
    getState: () => ({ currentBoardId: mocks.currentBoardId }),
    observeEvents: () => ({
      subscribe: (subscriber: (event: { type: string }) => void) => {
        mocks.workspaceSubscribers.push(subscriber);
        return { unsubscribe: vi.fn() };
      },
    }),
  },
}));

function createCompletedLongVideoTask(
  batchId: string,
  sourceBoardId: string,
  options: {
    sourceElementIds?: string[];
    workflowId?: string;
  } = {}
): Task {
  const sourceElementIds = options.sourceElementIds || [`source-${batchId}`];
  return {
    id: `task-${batchId}`,
    type: TaskType.VIDEO,
    status: TaskStatus.COMPLETED,
    completedAt: Date.now() + 1_000,
    params: {
      longVideoMeta: {
        batchId,
        canvasAssociations: sourceElementIds.map((elementId, index) => ({
          referenceId: `ref-${batchId}-${index + 1}`,
          boardId: sourceBoardId,
          elementId,
          kind: 'image',
          label: `来源图片${index + 1}`,
        })),
        model: 'veo3.1',
        needsLastFrame: false,
        scripts: [
          {
            duration: 8,
            index: 1,
            prompt: 'A continuous cinematic scene',
          },
        ],
        segmentIndex: 1,
        size: '16x9',
        totalSegments: 1,
        workflowId: options.workflowId,
      },
    },
    result: { url: `segment-${batchId}.mp4` },
  } as unknown as Task;
}

describe('long video canvas associations', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.activeBoard = { children: [] };
    mocks.boundBoardId = 'board-1';
    mocks.createCanvasAssociationLines.mockReset();
    mocks.createLongVideoSegmentTask.mockReset();
    mocks.currentBoardId = 'board-1';
    mocks.getCanvasBoard.mockReset();
    mocks.mergeVideos.mockReset();
    mocks.quickInsert.mockReset();
    mocks.retargetCanvasAssociationLines.mockReset();
    mocks.subscribers.length = 0;
    mocks.workspaceSubscribers.length = 0;

    mocks.getCanvasBoard.mockImplementation(() => mocks.activeBoard);
    mocks.mergeVideos.mockResolvedValue({
      duration: 8,
      url: 'merged-video.mp4',
    });
    mocks.quickInsert.mockImplementation(async () => {
      mocks.activeBoard?.children.push({ id: 'merged-result-1' });
      return {
        success: true,
        data: { firstElementId: 'merged-result-1' },
        type: 'video',
      };
    });
  });

  it('defers insertion until the source board is active and then retargets the task link', async () => {
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { initializeLongVideoChainService } = await import(
      './long-video-chain-service'
    );
    initializeLongVideoChainService();
    const subscriber = mocks.subscribers[0];
    const matchingTask = createCompletedLongVideoTask('matching', 'board-1', {
      sourceElementIds: ['source-first-frame', 'source-last-frame'],
      workflowId: 'workflow-matching',
    });
    const sourceBoard = mocks.activeBoard;

    subscriber({ type: 'taskUpdated', task: matchingTask });
    subscriber({ type: 'taskUpdated', task: matchingTask });

    await vi.waitFor(() => {
      expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledTimes(1);
    });
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledWith(
      sourceBoard,
      {
        boardId: 'board-1',
        resultElementId: 'merged-result-1',
        sourceElementIds: ['source-first-frame', 'source-last-frame'],
        workflowId: 'workflow-matching',
      }
    );
    expect(mocks.createCanvasAssociationLines).not.toHaveBeenCalled();

    mocks.currentBoardId = 'board-2';
    mocks.boundBoardId = 'board-2';
    mocks.activeBoard = { children: [] };
    const switchedTask = createCompletedLongVideoTask('switched', 'board-1', {
      workflowId: 'workflow-switched',
    });
    subscriber({
      type: 'taskUpdated',
      task: switchedTask,
    });

    await vi.waitFor(() =>
      expect(consoleWarn).toHaveBeenCalledWith(
        '[LongVideoChain] Source board is not active; merged result insertion deferred'
      )
    );
    expect(mocks.mergeVideos).toHaveBeenCalledTimes(1);
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledTimes(1);

    const reloadedSourceBoard = { children: [] };
    mocks.currentBoardId = 'board-1';
    mocks.boundBoardId = 'board-1';
    mocks.activeBoard = reloadedSourceBoard;
    mocks.workspaceSubscribers.forEach((subscriber) =>
      subscriber({ type: 'boardSwitched' })
    );

    await vi.waitFor(() => expect(mocks.quickInsert).toHaveBeenCalledTimes(2));
    expect(mocks.mergeVideos).toHaveBeenCalledTimes(2);
    expect(mocks.retargetCanvasAssociationLines).toHaveBeenLastCalledWith(
      reloadedSourceBoard,
      {
        boardId: 'board-1',
        resultElementId: 'merged-result-1',
        sourceElementIds: ['source-switched'],
        workflowId: 'workflow-switched',
      }
    );

    subscriber({ type: 'taskUpdated', task: switchedTask });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.mergeVideos).toHaveBeenCalledTimes(2);
    expect(mocks.quickInsert).toHaveBeenCalledTimes(2);
    expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledTimes(2);
    expect(mocks.createCanvasAssociationLines).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it('keeps concurrent batches for one source isolated by workflow ID', async () => {
    let insertionIndex = 0;
    mocks.quickInsert.mockImplementation(async () => {
      insertionIndex += 1;
      const firstElementId = `merged-result-${insertionIndex}`;
      mocks.activeBoard?.children.push({ id: firstElementId });
      return {
        success: true,
        data: { firstElementId },
        type: 'video',
      };
    });
    const { initializeLongVideoChainService } = await import(
      './long-video-chain-service'
    );
    initializeLongVideoChainService();
    const subscriber = mocks.subscribers[0];

    subscriber({
      type: 'taskUpdated',
      task: createCompletedLongVideoTask('concurrent-a', 'board-1', {
        sourceElementIds: ['shared-source'],
        workflowId: 'workflow-a',
      }),
    });
    subscriber({
      type: 'taskUpdated',
      task: createCompletedLongVideoTask('concurrent-b', 'board-1', {
        sourceElementIds: ['shared-source'],
        workflowId: 'workflow-b',
      }),
    });

    await vi.waitFor(() => {
      expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledTimes(2);
    });
    expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledWith(
      mocks.activeBoard,
      {
        boardId: 'board-1',
        resultElementId: 'merged-result-1',
        sourceElementIds: ['shared-source'],
        workflowId: 'workflow-a',
      }
    );
    expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledWith(
      mocks.activeBoard,
      {
        boardId: 'board-1',
        resultElementId: 'merged-result-2',
        sourceElementIds: ['shared-source'],
        workflowId: 'workflow-b',
      }
    );
    expect(mocks.createCanvasAssociationLines).not.toHaveBeenCalled();
  });

  it('retries a cached result after a transient association retarget failure', async () => {
    mocks.retargetCanvasAssociationLines.mockImplementationOnce(() => {
      throw new Error('temporary transform failure');
    });
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { initializeLongVideoChainService } = await import(
      './long-video-chain-service'
    );
    initializeLongVideoChainService();
    const subscriber = mocks.subscribers[0];
    const task = createCompletedLongVideoTask('retry-retarget', 'board-1', {
      workflowId: 'workflow-retry',
    });

    subscriber({ type: 'taskUpdated', task });
    await vi.waitFor(() =>
      expect(consoleWarn).toHaveBeenCalledWith(
        '[LongVideoChain] Failed to retarget canvas association lines:',
        expect.any(Error)
      )
    );
    expect(mocks.mergeVideos).toHaveBeenCalledTimes(1);
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledTimes(1);

    mocks.workspaceSubscribers.forEach((workspaceSubscriber) =>
      workspaceSubscriber({ type: 'boardSwitched' })
    );
    await vi.waitFor(() =>
      expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledTimes(2)
    );
    expect(mocks.mergeVideos).toHaveBeenCalledTimes(1);
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);

    subscriber({ type: 'taskUpdated', task });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledTimes(2);

    consoleWarn.mockRestore();
  });

  it('retries the cached merged result when the board changes during insertion', async () => {
    let resolveInsertion:
      | ((value: {
          success: boolean;
          data: { firstElementId: string };
          type: string;
        }) => void)
      | null = null;
    mocks.quickInsert.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInsertion = resolve;
      })
    );
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { initializeLongVideoChainService } = await import(
      './long-video-chain-service'
    );
    initializeLongVideoChainService();
    const subscriber = mocks.subscribers[0];
    const sourceBoard = mocks.activeBoard;

    subscriber({
      type: 'taskUpdated',
      task: createCompletedLongVideoTask('pending-switch', 'board-1'),
    });
    await vi.waitFor(() => expect(mocks.quickInsert).toHaveBeenCalledTimes(1));

    sourceBoard?.children.push({ id: 'merged-result-1' });
    mocks.currentBoardId = 'board-2';
    mocks.boundBoardId = 'board-2';
    mocks.activeBoard = { children: [{ id: 'merged-result-1' }] };
    resolveInsertion?.({
      success: true,
      data: { firstElementId: 'merged-result-1' },
      type: 'video',
    });

    await vi.waitFor(() =>
      expect(consoleWarn).toHaveBeenCalledWith(
        '[LongVideoChain] Active board changed while inserting; merged result insertion deferred'
      )
    );
    expect(mocks.retargetCanvasAssociationLines).not.toHaveBeenCalled();
    expect(mocks.createCanvasAssociationLines).not.toHaveBeenCalled();
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);

    mocks.currentBoardId = 'board-1';
    mocks.boundBoardId = 'board-1';
    mocks.activeBoard = sourceBoard;
    mocks.workspaceSubscribers.forEach((workspaceSubscriber) =>
      workspaceSubscriber({ type: 'boardSwitched' })
    );
    await vi.waitFor(() =>
      expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledTimes(1)
    );
    expect(mocks.mergeVideos).toHaveBeenCalledTimes(1);
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);

    subscriber({
      type: 'taskUpdated',
      task: createCompletedLongVideoTask('pending-switch', 'board-1'),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.mergeVideos).toHaveBeenCalledTimes(1);
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);

    consoleWarn.mockRestore();
  });

  it('keeps a successful insertion without an element ID and tombstones the batch', async () => {
    mocks.quickInsert.mockImplementationOnce(async () => {
      mocks.activeBoard?.children.push({ id: 'merged-without-returned-id' });
      return {
        success: true,
        data: {},
        type: 'video',
      };
    });
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { initializeLongVideoChainService } = await import(
      './long-video-chain-service'
    );
    initializeLongVideoChainService();
    const subscriber = mocks.subscribers[0];
    const task = createCompletedLongVideoTask('missing-id', 'board-1');

    subscriber({ type: 'taskUpdated', task });
    await vi.waitFor(() =>
      expect(consoleWarn).toHaveBeenCalledWith(
        '[LongVideoChain] Merged result has no stable element ID; association lines skipped'
      )
    );

    subscriber({ type: 'taskUpdated', task });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.mergeVideos).toHaveBeenCalledTimes(1);
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.createCanvasAssociationLines).not.toHaveBeenCalled();
    expect(mocks.retargetCanvasAssociationLines).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it('ignores a delayed completion replay after the successful batch was cleaned up', async () => {
    const { initializeLongVideoChainService } = await import(
      './long-video-chain-service'
    );
    initializeLongVideoChainService();
    const subscriber = mocks.subscribers[0];
    const task = createCompletedLongVideoTask('delayed-replay', 'board-1');

    subscriber({ type: 'taskUpdated', task });
    await vi.waitFor(() => {
      expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledTimes(1);
    });

    subscriber({ type: 'taskUpdated', task });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.mergeVideos).toHaveBeenCalledTimes(1);
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledTimes(1);
    expect(mocks.createCanvasAssociationLines).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PptExplainerCreateInput } from './types';
import {
  confirmAndRunPptExplainerTask,
  createPptExplainerTask,
} from './creation-service';

const mocks = vi.hoisted(() => ({
  generatePPT: vi.fn(),
  materializeOutline: vi.fn(),
  removeOwnedOutline: vi.fn(),
  waitForInitialization: vi.fn(),
  getCanvasBoardBinding: vi.fn(),
  getWorkspaceState: vi.fn(),
  resolveInvocationPlanFromRoute: vi.fn(),
  createTaskInvocationRouteSnapshot: vi.fn(),
  captureSelection: vi.fn(),
  listFrameIds: vi.fn(),
  needsImages: vi.fn(),
  createRootTask: vi.fn(),
  updateRootTask: vi.fn(),
  persistDetachedRootTask: vi.fn(),
  trackRootTask: vi.fn(),
  applyPptxCheckpoint: vi.fn(),
  confirmOutline: vi.fn(),
  registerPptxInput: vi.fn(),
  releasePptxInput: vi.fn(),
  putArtifact: vi.fn(),
  deleteArtifacts: vi.fn(),
  runTask: vi.fn(),
  getTask: vi.fn(),
  callOrder: [] as string[],
}));

vi.mock('../../mcp/tools/ppt-generation', () => ({
  generatePPT: mocks.generatePPT,
  materializePPTOutline: mocks.materializeOutline,
  removePptExplainerOwnedOutline: mocks.removeOwnedOutline,
}));

vi.mock('../../utils/settings-manager', () => ({
  settingsManager: {
    waitForInitialization: mocks.waitForInitialization,
  },
}));

vi.mock('../canvas-operations', () => ({
  getCanvasBoardBinding: mocks.getCanvasBoardBinding,
}));

vi.mock('../workspace-service', () => ({
  workspaceService: { getState: mocks.getWorkspaceState },
}));

vi.mock('../provider-routing', () => ({
  resolveInvocationPlanFromRoute: mocks.resolveInvocationPlanFromRoute,
}));

vi.mock('../task-invocation-route', () => ({
  createTaskInvocationRouteSnapshot: mocks.createTaskInvocationRouteSnapshot,
}));

vi.mock('../task-queue', () => ({
  taskQueueService: { getTask: mocks.getTask },
}));

vi.mock('../pptx-import', () => ({
  PptxImportError: class PptxImportError extends Error {
    constructor(readonly code: string, readonly kind: string, message: string) {
      super(message);
    }
  },
}));

vi.mock('./source-resolver', () => ({
  captureCurrentPptSourceSelection: mocks.captureSelection,
  currentPptNeedsGeneratedSlideImages: mocks.needsImages,
  applyPptxCheckpointToExplainerState: mocks.applyPptxCheckpoint,
  listCurrentPptFrameIds: mocks.listFrameIds,
}));

vi.mock('./task-state', () => ({
  createPptExplainerRootTask: mocks.createRootTask,
  updatePptExplainerRootTask: mocks.updateRootTask,
  persistDetachedPptExplainerRootTask: mocks.persistDetachedRootTask,
  trackPptExplainerRootTask: mocks.trackRootTask,
  confirmPptExplainerOutline: mocks.confirmOutline,
}));

vi.mock('./orchestrator', () => ({
  registerPptExplainerPptxInput: mocks.registerPptxInput,
  runPptExplainerBoardMutationExclusive: vi.fn(
    async (_boardId: string, run: () => unknown) => run()
  ),
  runPptExplainerTask: mocks.runTask,
}));

vi.mock('./internal-artifact-cache', () => ({
  putPptExplainerArtifact: mocks.putArtifact,
  deletePptExplainerArtifacts: mocks.deleteArtifacts,
}));

const board = { children: [] } as any;
const videoModelId = 'doubao-seedance-2-0-fast-260128';

function createInput(
  overrides: Partial<PptExplainerCreateInput> = {}
): PptExplainerCreateInput {
  return {
    source: 'topic',
    sourceBoardId: 'board-1',
    topic: '季度复盘',
    reviewMode: 'confirm',
    presenterMode: 'single_voice',
    speakers: [
      {
        id: 'speaker-a',
        displayName: '讲解者',
      },
    ],
    textModel: 'text-model',
    textModelRef: { profileId: 'profile-1', modelId: 'text-model' },
    imageModel: 'image-model',
    imageModelRef: { profileId: 'profile-1', modelId: 'image-model' },
    videoModel: videoModelId,
    videoModelRef: { profileId: 'profile-1', modelId: videoModelId },
    ...overrides,
  };
}

function createPlan(operation: 'text' | 'image' | 'video') {
  const modelId = operation === 'video' ? videoModelId : `${operation}-model`;
  return {
    provider: {
      profileId: 'profile-1',
      baseUrl: 'https://provider.example',
      apiKey: 'runtime-only-key',
    },
    modelRef: {
      profileId: 'profile-1',
      modelId,
    },
    binding: { id: `${operation}-binding` },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callOrder.length = 0;
  mocks.waitForInitialization.mockResolvedValue(undefined);
  mocks.putArtifact.mockResolvedValue(
    '/__aitu_internal__/ppt-explainer/job/source.pptx'
  );
  mocks.putArtifact.mockImplementation(async () => {
    mocks.callOrder.push('stage-pptx');
    return '/__aitu_internal__/ppt-explainer/job/source.pptx';
  });
  mocks.deleteArtifacts.mockResolvedValue(undefined);
  mocks.getCanvasBoardBinding.mockReturnValue({ board, boardId: 'board-1' });
  mocks.getWorkspaceState.mockReturnValue({ currentBoardId: 'board-1' });
  mocks.captureSelection.mockResolvedValue({
    frameIds: ['frame-1', 'frame-2'],
    frameRevisions: {
      'frame-1': 'revision-1',
      'frame-2': 'revision-2',
    },
  });
  mocks.listFrameIds.mockReturnValue(['frame-1', 'frame-2']);
  mocks.needsImages.mockReturnValue(true);
  mocks.generatePPT.mockImplementation(async () => {
    mocks.callOrder.push('generate-topic');
    return { success: true, type: 'text' };
  });
  mocks.resolveInvocationPlanFromRoute.mockImplementation(
    (operation: 'text' | 'image' | 'video') => createPlan(operation)
  );
  mocks.createTaskInvocationRouteSnapshot.mockImplementation((operation) => ({
    operation,
    providerProfileId: 'profile-1',
  }));
  mocks.createRootTask.mockImplementation(async (state) => {
    mocks.callOrder.push('create-root');
    return {
      id: 'root-task',
      type: 'video',
      status: 'pending',
      params: { prompt: state.topic || 'PPT 讲解视频', pptExplainer: state },
      createdAt: 1,
      updatedAt: 1,
    };
  });
  mocks.persistDetachedRootTask.mockImplementation(async (task, update) => ({
    ...task,
    status: update.status || task.status,
    progress: update.progress ?? task.progress,
    params: { ...task.params, pptExplainer: update.state },
    error: update.error,
    updatedAt: task.updatedAt + 1,
  }));
  mocks.trackRootTask.mockImplementation(() => {
    mocks.callOrder.push('track-root');
  });
  mocks.applyPptxCheckpoint.mockImplementation((state, checkpoint) => ({
    ...state,
    pptxImport: checkpoint,
    pptx: {
      filename: checkpoint.source.fileName,
      mimeType: checkpoint.source.mimeType,
      cacheUrl: checkpoint.source.cacheUrl,
      fingerprint: checkpoint.source.fingerprint,
    },
    deckFingerprint: checkpoint.source.fingerprint,
    slides: checkpoint.slides.map((slide) => ({
      pageIndex: slide.pageIndex,
      snapshotUrl: slide.cacheUrl,
      snapshotMimeType: 'image/svg+xml',
      notes: slide.notes,
      turns: [],
      diagnostics: [],
    })),
  }));
  mocks.updateRootTask.mockImplementation(async (_taskId, update) => ({
    id: 'root-task',
    type: 'video',
    status: update.status || 'pending',
    params: {
      prompt: update.state.topic || 'PPT 讲解视频',
      pptExplainer: update.state,
    },
    createdAt: 1,
    updatedAt: 2,
  }));
  mocks.runTask.mockImplementation(() => {
    mocks.callOrder.push('run-orchestrator');
  });
  mocks.registerPptxInput.mockImplementation(() => {
    mocks.callOrder.push('register-pptx');
    return mocks.releasePptxInput;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PPT explainer creation service', () => {
  it('rejects an empty topic before model preflight', async () => {
    await expect(
      createPptExplainerTask(createInput({ topic: '   ' }))
    ).rejects.toThrow('请输入 PPT 主题');

    expect(mocks.resolveInvocationPlanFromRoute).not.toHaveBeenCalled();
    expect(mocks.createRootTask).not.toHaveBeenCalled();
  });

  it('rejects an empty current PPT before model preflight', async () => {
    mocks.captureSelection.mockRejectedValue(
      new Error('当前画板没有 PPT 页面')
    );

    await expect(
      createPptExplainerTask(
        createInput({ source: 'current_ppt', topic: undefined })
      )
    ).rejects.toThrow('当前画板没有 PPT 页面');

    expect(mocks.resolveInvocationPlanFromRoute).not.toHaveBeenCalled();
    expect(mocks.createRootTask).not.toHaveBeenCalled();
  });

  it('captures the immutable current PPT frame set before creating the root', async () => {
    await createPptExplainerTask(
      createInput({ source: 'current_ppt', topic: undefined })
    );

    expect(mocks.captureSelection).toHaveBeenCalledWith(board);
    expect(mocks.needsImages).toHaveBeenCalledWith(board, [
      'frame-1',
      'frame-2',
    ]);
    expect(mocks.createRootTask.mock.calls[0][0]).toMatchObject({
      source: 'current_ppt',
      outlineFrameIds: ['frame-1', 'frame-2'],
      sourceFrameRevisions: {
        'frame-1': 'revision-1',
        'frame-2': 'revision-2',
      },
    });
  });

  it('requires explicit acknowledgement before skipping outline review', async () => {
    await expect(
      createPptExplainerTask({
        ...createInput({
          reviewMode: 'skip_after_warning',
        }),
        skipWarningAccepted: true,
      } as PptExplainerCreateInput & { skipWarningAccepted: boolean })
    ).rejects.toThrow('必须确认');

    expect(mocks.resolveInvocationPlanFromRoute).not.toHaveBeenCalled();
    expect(mocks.generatePPT).not.toHaveBeenCalled();
  });

  it('has zero source side effects when model preflight fails', async () => {
    mocks.resolveInvocationPlanFromRoute.mockImplementation((operation) => {
      if (operation === 'video') throw new Error('route unavailable');
      return createPlan(operation);
    });

    await expect(createPptExplainerTask(createInput())).rejects.toThrow(
      'route unavailable'
    );
    expect(mocks.generatePPT).not.toHaveBeenCalled();
    expect(mocks.putArtifact).not.toHaveBeenCalled();
    expect(mocks.createRootTask).not.toHaveBeenCalled();
  });

  it('registers a preparing root before generating a topic outline', async () => {
    const task = await createPptExplainerTask(createInput());

    expect(mocks.callOrder.slice(0, 2)).toEqual([
      'create-root',
      'run-orchestrator',
    ]);
    expect(mocks.generatePPT).not.toHaveBeenCalled();
    const initialState = mocks.createRootTask.mock.calls[0][0];
    expect(initialState).toMatchObject({
      source: 'topic',
      sourceBoardId: 'board-1',
      stage: 'preparing',
      presentationInput: 'slide_images',
      delivery: { resultSaved: false, canvasInserted: false },
    });
    expect(JSON.stringify(initialState)).not.toContain('runtime-only-key');
    expect(mocks.createTaskInvocationRouteSnapshot).toHaveBeenNthCalledWith(
      1,
      'text',
      { profileId: 'profile-1', modelId: 'text-model' },
      {
        bindingId: 'text-binding',
        metadataPolicy: 'capabilities-only',
      }
    );
    expect(mocks.createTaskInvocationRouteSnapshot).toHaveBeenNthCalledWith(
      2,
      'image',
      { profileId: 'profile-1', modelId: 'image-model' },
      {
        bindingId: 'image-binding',
        metadataPolicy: 'capabilities-only',
      }
    );
    expect(task.id).toBe('root-task');
    expect(mocks.runTask).toHaveBeenCalledWith('root-task');
  });

  it('persists an exact page count requested in the topic', async () => {
    await createPptExplainerTask(
      createInput({ topic: '2026 AI 办公自动化趋势，严格 5 页' })
    );

    expect(mocks.createRootTask.mock.calls[0][0]).toMatchObject({
      requestedPageCount: 5,
    });
  });

  it('creates a local audible-video task without legacy voice fields', async () => {
    await createPptExplainerTask(createInput());

    expect(mocks.createRootTask.mock.calls[0][0]).toMatchObject({
      executionMode: 'local',
      speakers: [{ id: 'speaker-a', displayName: '讲解者' }],
      models: {
        videoModel: videoModelId,
        videoModelRef: {
          profileId: 'profile-1',
          modelId: videoModelId,
        },
      },
    });
    expect(
      mocks.createRootTask.mock.calls[0][0].speakers[0]
    ).not.toHaveProperty('voiceId');
  });

  it('stages PPTX for local slide snapshot generation before creating the root', async () => {
    mocks.needsImages.mockReturnValue(false);
    const file = new File(['pptx'], 'deck.pptx', {
      type: 'application/octet-stream',
    });

    await createPptExplainerTask(
      createInput({
        source: 'pptx',
        topic: undefined,
        pptxFile: file,
      })
    );

    expect(mocks.callOrder).toEqual([
      'register-pptx',
      'stage-pptx',
      'create-root',
      'run-orchestrator',
    ]);
    const initialState = mocks.createRootTask.mock.calls[0][0];
    expect(initialState.presentationInput).toBe('slide_images');
    expect(initialState.stage).toBe('preparing');
    expect(initialState.slides).toEqual([]);
    expect(initialState.pptx).toMatchObject({
      filename: 'deck.pptx',
      cacheUrl: '/__aitu_internal__/ppt-explainer/job/source.pptx',
    });
    expect(mocks.registerPptxInput).toHaveBeenCalledWith(
      expect.any(String),
      file
    );
    expect(mocks.createRootTask).toHaveBeenCalledWith(initialState);
    expect(mocks.runTask).toHaveBeenCalledWith('root-task');
  });

  it('releases the pending PPTX file when root persistence fails', async () => {
    mocks.needsImages.mockReturnValue(false);
    mocks.createRootTask.mockRejectedValue(new Error('IndexedDB unavailable'));
    const file = new File(['pptx'], 'deck.pptx');

    await expect(
      createPptExplainerTask(
        createInput({ source: 'pptx', topic: undefined, pptxFile: file })
      )
    ).rejects.toThrow('IndexedDB unavailable');

    expect(mocks.releasePptxInput).toHaveBeenCalledTimes(1);
    expect(mocks.deleteArtifacts).toHaveBeenCalledTimes(1);
    expect(mocks.runTask).not.toHaveBeenCalled();
  });

  it('does not create a root when staging the PPTX source fails', async () => {
    mocks.needsImages.mockReturnValue(false);
    mocks.putArtifact.mockRejectedValue(new Error('Cache Storage unavailable'));

    await expect(
      createPptExplainerTask(
        createInput({
          source: 'pptx',
          topic: undefined,
          pptxFile: new File(['pptx'], 'deck.pptx'),
        })
      )
    ).rejects.toThrow('Cache Storage unavailable');

    expect(mocks.createRootTask).not.toHaveBeenCalled();
    expect(mocks.releasePptxInput).toHaveBeenCalledTimes(1);
    expect(mocks.runTask).not.toHaveBeenCalled();
  });

  it.each([
    { executionMode: 'provider' },
    { providerBindingId: 'invented-binding' },
    {
      speakers: [{ id: 'speaker-a', displayName: '讲解者', voiceId: 'alloy' }],
    },
    {
      speakers: [
        {
          id: 'speaker-a',
          displayName: '讲解者',
          referenceAudio: { filename: 'sample.mp3' },
        },
      ],
    },
    {
      speakers: [
        { id: 'speaker-a', displayName: '讲解者', avatarAssetId: 'avatar-1' },
      ],
    },
  ])(
    'rejects unsupported creation fields without side effects: %o',
    async (legacy) => {
      await expect(
        createPptExplainerTask({
          ...createInput(),
          ...legacy,
        } as PptExplainerCreateInput)
      ).rejects.toThrow();

      expect(mocks.resolveInvocationPlanFromRoute).not.toHaveBeenCalled();
      expect(mocks.putArtifact).not.toHaveBeenCalled();
      expect(mocks.createRootTask).not.toHaveBeenCalled();
    }
  );

  it.each([
    [{}, '模型或画板参数无效'],
    [{ ...createInput(), speakers: undefined }, '讲解者配置无效'],
    [{ ...createInput(), speakers: {} }, '讲解者配置无效'],
    [
      {
        ...createInput(),
        speakers: [{ id: undefined, displayName: '讲解者' }],
      },
      '讲解者名称和 ID 必须是文本',
    ],
    [{ ...createInput(), videoModel: undefined }, '模型或画板参数无效'],
  ])(
    'rejects malformed runtime input without trim errors: %o',
    async (input, message) => {
      await expect(
        createPptExplainerTask(input as PptExplainerCreateInput)
      ).rejects.toThrow(message);
      expect(mocks.createRootTask).not.toHaveBeenCalled();
    }
  );

  it('accepts a configured video route without a static narration tag', async () => {
    const modelId = 'doubao-seedance-1-5-pro_1080p';
    mocks.resolveInvocationPlanFromRoute.mockImplementation((operation) =>
      operation === 'video'
        ? {
            ...createPlan('video'),
            modelRef: { profileId: 'profile-1', modelId },
          }
        : createPlan(operation)
    );

    await expect(
      createPptExplainerTask(
        createInput({
          videoModel: modelId,
          videoModelRef: { profileId: 'profile-1', modelId },
        })
      )
    ).resolves.toMatchObject({ id: 'root-task' });
    expect(mocks.putArtifact).not.toHaveBeenCalled();
    expect(mocks.createRootTask).toHaveBeenCalledWith(
      expect.objectContaining({
        models: expect.objectContaining({
          videoModel: modelId,
          videoModelRef: { profileId: 'profile-1', modelId },
        }),
      })
    );
  });

  it('confirms review only once and starts the persisted task', async () => {
    const pendingTask = {
      id: 'root-task',
      type: 'video',
      status: 'pending',
      params: { pptExplainer: { schemaVersion: 1, stage: 'review_pending' } },
    };
    const confirmedTask = {
      ...pendingTask,
      params: {
        pptExplainer: { schemaVersion: 1, stage: 'snapshotting' },
      },
    };
    mocks.getTask.mockReturnValue(pendingTask);
    mocks.confirmOutline.mockResolvedValue(confirmedTask);

    await confirmAndRunPptExplainerTask('root-task');

    expect(mocks.confirmOutline).toHaveBeenCalledTimes(1);
    expect(mocks.runTask).toHaveBeenCalledWith('root-task');
  });

  it('confirms only the pages owned by the selected topic task', async () => {
    const pendingTask = {
      id: 'root-task',
      type: 'video',
      status: 'pending',
      params: {
        pptExplainer: {
          schemaVersion: 1,
          stage: 'review_pending',
          source: 'topic',
          sourceBoardId: 'board-1',
          jobId: 'job-a',
          topic: '季度复盘',
          topicOutline: {
            title: '季度复盘',
            pages: [
              { layout: 'cover', title: '首页' },
              { layout: 'title-body', title: '结论' },
            ],
          },
        },
      },
    };
    const confirmedTask = {
      ...pendingTask,
      params: {
        pptExplainer: {
          ...pendingTask.params.pptExplainer,
          stage: 'snapshotting',
        },
      },
    };
    mocks.getTask.mockReturnValue(pendingTask);
    mocks.confirmOutline.mockResolvedValue(confirmedTask);

    await confirmAndRunPptExplainerTask('root-task');

    expect(mocks.captureSelection).toHaveBeenCalledWith(board, 'job-a');
    expect(mocks.confirmOutline).toHaveBeenCalledWith('root-task', {
      frameIds: ['frame-1', 'frame-2'],
      frameRevisions: {
        'frame-1': 'revision-1',
        'frame-2': 'revision-2',
      },
    });
    expect(mocks.materializeOutline).not.toHaveBeenCalled();
  });

  it('restores an incomplete topic outline without replacing other decks', async () => {
    const topicOutline = {
      title: '季度复盘',
      pages: [
        { layout: 'cover', title: '首页' },
        { layout: 'title-body', title: '结论' },
      ],
    };
    const pendingTask = {
      id: 'root-task',
      type: 'video',
      status: 'pending',
      params: {
        pptExplainer: {
          schemaVersion: 1,
          stage: 'review_pending',
          source: 'topic',
          sourceBoardId: 'board-1',
          jobId: 'job-a',
          topic: '季度复盘',
          topicOutline,
        },
      },
    };
    mocks.getTask.mockReturnValue(pendingTask);
    mocks.listFrameIds.mockReturnValue(['remaining-frame']);
    mocks.confirmOutline.mockResolvedValue({
      ...pendingTask,
      params: {
        pptExplainer: {
          ...pendingTask.params.pptExplainer,
          stage: 'snapshotting',
        },
      },
    });

    await confirmAndRunPptExplainerTask('root-task');

    expect(mocks.removeOwnedOutline).toHaveBeenCalledWith(board, 'job-a');
    expect(mocks.materializeOutline).toHaveBeenCalledWith(
      board,
      topicOutline,
      { topic: '季度复盘' },
      expect.objectContaining({
        pptExplainerJobId: 'job-a',
        replaceExistingPpt: false,
      })
    );
  });

  it('fails only when both task pages and the persisted outline are missing', async () => {
    const pendingTask = {
      id: 'root-task',
      type: 'video',
      status: 'pending',
      params: {
        pptExplainer: {
          schemaVersion: 1,
          stage: 'review_pending',
          source: 'topic',
          sourceBoardId: 'board-1',
          jobId: 'job-a',
        },
      },
    };
    mocks.getTask.mockReturnValue(pendingTask);
    mocks.listFrameIds.mockReturnValue([]);

    await expect(confirmAndRunPptExplainerTask('root-task')).rejects.toThrow(
      '大纲快照已丢失'
    );
    expect(mocks.materializeOutline).not.toHaveBeenCalled();
    expect(mocks.confirmOutline).not.toHaveBeenCalled();
  });
});

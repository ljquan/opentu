import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PptExplainerCreateInput } from './types';
import {
  confirmAndRunPptExplainerTask,
  createPptExplainerTask,
  authorizePptExplainerUiCreation,
} from './creation-service';
import { PptExplainerProviderPreflightError } from './provider-contract';

const mocks = vi.hoisted(() => ({
  generatePPT: vi.fn(),
  waitForInitialization: vi.fn(),
  getCanvasBoardBinding: vi.fn(),
  getWorkspaceState: vi.fn(),
  resolveInvocationPlanFromRoute: vi.fn(),
  createTaskInvocationRouteSnapshot: vi.fn(),
  importPptx: vi.fn(),
  deletePptxImportCache: vi.fn(),
  preflightProvider: vi.fn(),
  createProviderSnapshot: vi.fn(),
  captureSelection: vi.fn(),
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
  getCachedBlob: vi.fn(),
  callOrder: [] as string[],
}));

vi.mock('../../mcp/tools/ppt-generation', () => ({
  generatePPT: mocks.generatePPT,
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

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: { getCachedBlob: mocks.getCachedBlob },
}));

vi.mock('../pptx-import', () => ({
  importPptx: mocks.importPptx,
  deletePptxImportCache: mocks.deletePptxImportCache,
  PptxImportError: class PptxImportError extends Error {
    constructor(readonly code: string, readonly kind: string, message: string) {
      super(message);
    }
  },
}));

vi.mock('./provider-contract', () => {
  class PptExplainerProviderPreflightError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    PptExplainerProviderPreflightError,
    preflightPptExplainerProviderFromSettings: mocks.preflightProvider,
    createPptExplainerProviderRouteSnapshot: mocks.createProviderSnapshot,
  };
});

vi.mock('./source-resolver', () => ({
  captureCurrentPptSourceSelection: mocks.captureSelection,
  currentPptNeedsGeneratedSlideImages: mocks.needsImages,
  applyPptxCheckpointToExplainerState: mocks.applyPptxCheckpoint,
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
const modelRef = { profileId: 'profile-1', modelId: 'model-1' };

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
        voiceId: 'voice-a',
      },
    ],
    textModel: 'text-model',
    textModelRef: { profileId: 'profile-1', modelId: 'text-model' },
    imageModel: 'image-model',
    imageModelRef: { profileId: 'profile-1', modelId: 'image-model' },
    videoModel: 'video-model',
    videoModelRef: { profileId: 'profile-1', modelId: 'video-model' },
    ...overrides,
  };
}

function createPlan(operation: 'text' | 'image') {
  return {
    provider: {
      profileId: 'profile-1',
      baseUrl: 'https://provider.example',
      apiKey: 'runtime-only-key',
    },
    modelRef: {
      profileId: 'profile-1',
      modelId: `${operation}-model`,
    },
    binding: { id: `${operation}-binding` },
  };
}

function createProvider(presentationInput: 'pptx' | 'slide_images') {
  return {
    provider: {
      profileId: 'profile-1',
      baseUrl: 'https://provider.example',
      apiKey: 'runtime-only-key',
    },
    modelRef,
    binding: { id: 'ppt-explainer-binding' },
    requirements: {
      source: presentationInput === 'pptx' ? 'pptx' : 'topic',
      presentationInput,
      presenterMode: 'single_voice',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callOrder.length = 0;
  mocks.waitForInitialization.mockResolvedValue(undefined);
  mocks.deletePptxImportCache.mockResolvedValue(undefined);
  mocks.putArtifact.mockResolvedValue(
    '/__aitu_internal__/ppt-explainer/job/source.pptx'
  );
  mocks.putArtifact.mockImplementation(async () => {
    mocks.callOrder.push('stage-pptx');
    return '/__aitu_internal__/ppt-explainer/job/source.pptx';
  });
  mocks.getCachedBlob.mockResolvedValue(
    new Blob(['reference-audio'], { type: 'audio/mpeg' })
  );
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
  mocks.needsImages.mockReturnValue(true);
  mocks.generatePPT.mockImplementation(async () => {
    mocks.callOrder.push('generate-topic');
    return { success: true, type: 'text' };
  });
  mocks.resolveInvocationPlanFromRoute.mockImplementation(
    (operation: 'text' | 'image') => createPlan(operation)
  );
  mocks.preflightProvider.mockReturnValue(createProvider('slide_images'));
  mocks.createProviderSnapshot.mockReturnValue({
    schemaVersion: 2,
    operation: 'video',
    providerProfileId: 'profile-1',
    canonicalBaseUrl: 'https://api.example.com/v1',
    modelRef,
    binding: { id: 'ppt-explainer-binding' },
  });
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
  it('rejects an empty topic before provider preflight', async () => {
    await expect(
      createPptExplainerTask(createInput({ topic: '   ' }))
    ).rejects.toThrow('请输入 PPT 主题');

    expect(mocks.preflightProvider).not.toHaveBeenCalled();
    expect(mocks.createRootTask).not.toHaveBeenCalled();
  });

  it('rejects an empty current PPT before provider preflight', async () => {
    mocks.captureSelection.mockRejectedValue(
      new Error('当前画板没有 PPT 页面')
    );

    await expect(
      createPptExplainerTask(
        createInput({ source: 'current_ppt', topic: undefined })
      )
    ).rejects.toThrow('当前画板没有 PPT 页面');

    expect(mocks.preflightProvider).not.toHaveBeenCalled();
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

    expect(mocks.preflightProvider).not.toHaveBeenCalled();
    expect(mocks.generatePPT).not.toHaveBeenCalled();
  });

  it('has zero source side effects when provider preflight fails', async () => {
    mocks.preflightProvider.mockImplementation(() => {
      throw new Error('binding unavailable');
    });

    await expect(createPptExplainerTask(createInput())).rejects.toThrow(
      'binding unavailable'
    );
    expect(mocks.generatePPT).not.toHaveBeenCalled();
    expect(mocks.importPptx).not.toHaveBeenCalled();
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

  it('falls back from PPTX passthrough to ordered slide snapshots', async () => {
    mocks.needsImages.mockReturnValue(false);
    mocks.preflightProvider
      .mockImplementationOnce(() => {
        throw new PptExplainerProviderPreflightError(
          'capability_unsupported',
          'no pptx passthrough'
        );
      })
      .mockReturnValueOnce({
        ...createProvider('slide_images'),
        requirements: {
          source: 'pptx',
          presentationInput: 'slide_images',
          presenterMode: 'single_voice',
        },
      });
    const file = new File(['pptx'], 'deck.pptx', {
      type: 'application/octet-stream',
    });

    await createPptExplainerTask(
      createInput({
        source: 'pptx',
        topic: undefined,
        pptxFile: file,
        executionMode: 'provider',
      })
    );

    expect(mocks.preflightProvider).toHaveBeenCalledTimes(2);
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

  it('prefers PPTX passthrough and exposes the root before source parsing', async () => {
    mocks.needsImages.mockReturnValue(false);
    mocks.preflightProvider.mockReturnValue({
      ...createProvider('pptx'),
      requirements: {
        source: 'pptx',
        presentationInput: 'pptx',
        presenterMode: 'single_voice',
      },
    });
    const file = new File(['pptx'], 'deck.pptx', {
      type: 'application/octet-stream',
    });

    await createPptExplainerTask(
      createInput({
        source: 'pptx',
        topic: undefined,
        pptxFile: file,
        executionMode: 'provider',
      })
    );

    expect(mocks.createRootTask.mock.calls[0][0]).toMatchObject({
      source: 'pptx',
      presentationInput: 'pptx',
      stage: 'preparing',
      slides: [],
    });
    expect(mocks.callOrder).toEqual([
      'register-pptx',
      'stage-pptx',
      'create-root',
      'run-orchestrator',
    ]);
    expect(mocks.importPptx).not.toHaveBeenCalled();
  });

  it('releases the pending PPTX file when root persistence fails', async () => {
    mocks.needsImages.mockReturnValue(false);
    mocks.preflightProvider.mockReturnValue({
      ...createProvider('pptx'),
      requirements: {
        source: 'pptx',
        presentationInput: 'pptx',
        presenterMode: 'single_voice',
      },
    });
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
    mocks.preflightProvider.mockReturnValue({
      ...createProvider('pptx'),
      requirements: {
        source: 'pptx',
        presentationInput: 'pptx',
        presenterMode: 'single_voice',
      },
    });
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

  it('stages reference audio after capability preflight without persisting File', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const input = createInput({
      speakers: [
        {
          id: 'speaker-a',
          displayName: '讲解者',
          voiceSource: 'reference_audio',
          referenceAudio: {
            file: new File(['sample'], 'host.mp3', { type: 'audio/mpeg' }),
            filename: 'host.mp3',
            mimeType: 'audio/mpeg',
            size: 6,
          },
        },
      ],
    });
    authorizePptExplainerUiCreation(input, {
      skipOutlineReview: false,
      replaceExistingPpt: false,
      voiceCloneConsent: true,
    });
    mocks.putArtifact.mockImplementation(async (_jobId, artifactName) => {
      mocks.callOrder.push('stage-' + artifactName);
      return '/__aitu_internal__/ppt-explainer/job/' + artifactName;
    });

    await createPptExplainerTask(input);

    expect(mocks.preflightProvider).toHaveBeenCalledWith(
      input.videoModelRef,
      expect.objectContaining({ requiresReferenceAudio: true }),
      expect.anything()
    );
    const initialState = mocks.createRootTask.mock.calls[0][0];
    expect(initialState.speakers[0]).toMatchObject({
      voiceSource: 'reference_audio',
      voiceReference: {
        assetName: 'voice-reference-01.mp3',
        filename: 'host.mp3',
        mimeType: 'audio/mpeg',
        size: 6,
      },
    });
    expect(initialState.speakers[0]).not.toHaveProperty('referenceAudio');
    expect(JSON.stringify(initialState)).not.toContain('sample');
    expect(mocks.putArtifact).toHaveBeenCalledWith(
      expect.any(String),
      'voice-reference-01.mp3',
      expect.any(Blob)
    );
    vi.unstubAllGlobals();
  });

  it('rejects reference audio without a current-page consent grant', async () => {
    const input = createInput({
      speakers: [
        {
          id: 'speaker-a',
          displayName: '讲解者',
          voiceSource: 'reference_audio',
          referenceAudio: {
            file: new File(['sample'], 'host.mp3', { type: 'audio/mpeg' }),
            filename: 'host.mp3',
            mimeType: 'audio/mpeg',
          },
        },
      ],
    });

    await expect(createPptExplainerTask(input)).rejects.toThrow('本人授权');
    expect(mocks.preflightProvider).not.toHaveBeenCalled();
    expect(mocks.putArtifact).not.toHaveBeenCalled();
    expect(mocks.createRootTask).not.toHaveBeenCalled();
  });

  it('copies a selected audio asset into job-private storage', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const input = createInput({
      speakers: [
        {
          id: 'speaker-a',
          displayName: '讲解者',
          voiceSource: 'reference_audio',
          referenceAudio: {
            sourceAssetId: 'audio-asset-1',
            sourceUrl: '/__aitu_cache__/audio/source.mp3',
            filename: 'source.mp3',
            mimeType: 'audio/mpeg',
            size: 15,
          },
        },
      ],
    });
    authorizePptExplainerUiCreation(input, {
      skipOutlineReview: false,
      replaceExistingPpt: false,
      voiceCloneConsent: true,
    });
    mocks.putArtifact.mockResolvedValue(
      '/__aitu_internal__/ppt-explainer/job/voice-reference-01.mp3'
    );

    await createPptExplainerTask(input);

    expect(mocks.getCachedBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/audio/source.mp3'
    );
    expect(mocks.putArtifact).toHaveBeenCalledWith(
      expect.any(String),
      'voice-reference-01.mp3',
      expect.objectContaining({ size: 15, type: 'audio/mpeg' })
    );
    expect(mocks.createRootTask.mock.calls[0][0].speakers[0]).toMatchObject({
      voiceReference: {
        sourceAssetId: 'audio-asset-1',
        cacheUrl: '/__aitu_internal__/ppt-explainer/job/voice-reference-01.mp3',
      },
    });
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
});

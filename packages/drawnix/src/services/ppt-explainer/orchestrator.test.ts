import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';
import type { PptExplainerTaskState } from './types';
import type {
  PptExplainerProviderSlideInput,
  PptExplainerProviderSlideSource,
  PptExplainerProviderVoiceReferenceInput,
  PptExplainerProviderVoiceReferenceSource,
} from './provider-adapter';
import type { PptxImportCheckpoint } from '../pptx-import';
import {
  buildPptExplainerVideoPrompt,
  cancelPptExplainerRemoteTask,
  cleanupPptExplainerTask,
  isPptExplainerRunActive,
  registerPptExplainerPptxInput,
  runPptExplainerTask,
  suspendPptExplainerRuns,
} from './orchestrator';

const mocks = vi.hoisted(() => ({
  tasks: new Map<string, Task>(),
  updateRootTask: vi.fn(),
  submitJob: vi.fn(),
  pollJob: vi.fn(),
  cancelJob: vi.fn(),
  resolveProviderRoute: vi.fn(),
  cacheRemoteUrl: vi.fn(),
  deleteArtifacts: vi.fn(),
  deleteArtifact: vi.fn(),
  getArtifact: vi.fn(),
  getCanvasBoardBinding: vi.fn(),
  getCachedBlob: vi.fn(),
  buildNarrationPlan: vi.fn(),
  freezeCurrentPptSource: vi.fn(),
  materializeSlideImages: vi.fn(),
  prepareMissingPptSlideImages: vi.fn(),
  applyPptxCheckpoint: vi.fn(),
  importPptx: vi.fn(),
  importPptxBlob: vi.fn(),
  resumePptxImport: vi.fn(),
  deletePptxImportCache: vi.fn(),
  deletePptxImportCacheByJobId: vi.fn(),
  deleteTask: vi.fn(),
  getAllCachedMedia: vi.fn(),
  deleteCache: vi.fn(),
  generatePPT: vi.fn(),
  materializePPTOutline: vi.fn(),
  listCurrentPptFrameIds: vi.fn(),
  getDraftOwners: vi.fn(),
  generateVideo: vi.fn(),
  resolveInvocationPlanFromRoute: vi.fn(),
  resolveTaskInvocationRouteModel: vi.fn(),
  downloadVideoContentToLocalUrl: vi.fn(),
  getEffectiveVideoModelConfigForSelection: vi.fn(),
  composeLocalPptVideo: vi.fn(),
  cacheMediaFromBlob: vi.fn(),
}));

async function collectSubmittedSlides(
  callIndex = mocks.submitJob.mock.calls.length - 1
): Promise<PptExplainerProviderSlideInput[]> {
  const input = mocks.submitJob.mock.calls[callIndex]?.[0] as
    | { slides?: PptExplainerProviderSlideSource }
    | undefined;
  const result: PptExplainerProviderSlideInput[] = [];
  if (!input?.slides) return result;
  for await (const slide of input.slides) result.push(slide);
  return result;
}

async function collectSubmittedVoiceReferences(
  callIndex = mocks.submitJob.mock.calls.length - 1
): Promise<PptExplainerProviderVoiceReferenceInput[]> {
  const input = mocks.submitJob.mock.calls[callIndex]?.[0] as
    | { voiceReferences?: PptExplainerProviderVoiceReferenceSource }
    | undefined;
  const result: PptExplainerProviderVoiceReferenceInput[] = [];
  if (!input?.voiceReferences) return result;
  for await (const reference of input.voiceReferences) result.push(reference);
  return result;
}

vi.mock('../../mcp/tools/ppt-generation', () => ({
  generatePPT: mocks.generatePPT,
  materializePPTOutline: mocks.materializePPTOutline,
}));

vi.mock('../ppt', () => ({
  validateOutline: vi.fn((outline: unknown) =>
    Boolean(
      outline &&
        typeof outline === 'object' &&
        Array.isArray((outline as { pages?: unknown }).pages)
    )
  ),
}));

vi.mock('../canvas-operations', () => ({
  getCanvasBoardBinding: mocks.getCanvasBoardBinding,
}));

vi.mock('../media-executor/fallback-utils', () => ({
  cacheRemoteUrl: mocks.cacheRemoteUrl,
}));

vi.mock('../task-invocation-route', () => ({
  assertTaskInvocationRouteAvailable: vi.fn(),
  resolveTaskInvocationRouteModel: mocks.resolveTaskInvocationRouteModel,
}));

vi.mock('../provider-routing', () => ({
  resolveInvocationPlanFromRoute: mocks.resolveInvocationPlanFromRoute,
}));

vi.mock('../video-binding-utils', () => ({
  downloadVideoContentToLocalUrl: mocks.downloadVideoContentToLocalUrl,
  getEffectiveVideoModelConfigForSelection:
    mocks.getEffectiveVideoModelConfigForSelection,
}));

vi.mock('../task-queue', () => ({
  taskQueueService: {
    getTask: (taskId: string) => mocks.tasks.get(taskId),
    deleteTask: mocks.deleteTask,
    cancelTask: vi.fn((taskId: string) => {
      const task = mocks.tasks.get(taskId);
      if (task) {
        mocks.tasks.set(taskId, {
          ...task,
          status: TaskStatus.CANCELLED,
        });
      }
    }),
  },
}));

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: mocks.getCachedBlob,
    getAllCachedMedia: mocks.getAllCachedMedia,
    deleteCache: mocks.deleteCache,
    cacheMediaFromBlob: mocks.cacheMediaFromBlob,
  },
}));

vi.mock('../media-generation/video-generation-service', () => ({
  generateVideo: mocks.generateVideo,
}));

vi.mock('./local-composer', () => ({
  composeLocalPptExplainerVideo: mocks.composeLocalPptVideo,
  isPptExplainerNarrationQualityError: (error: unknown) =>
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'PPT_NARRATION_QUALITY',
}));

vi.mock('../workspace-service', () => ({
  workspaceService: { getState: vi.fn(() => ({ currentBoardId: 'board-1' })) },
}));

vi.mock('./provider-adapter', () => ({
  submitPptExplainerProviderJob: mocks.submitJob,
  pollPptExplainerProviderJob: mocks.pollJob,
  cancelPptExplainerProviderJob: mocks.cancelJob,
}));

vi.mock('./provider-contract', () => ({
  resolvePptExplainerProviderRouteSnapshot: mocks.resolveProviderRoute,
}));

vi.mock('./internal-artifact-cache', () => ({
  deletePptExplainerArtifact: mocks.deleteArtifact,
  deletePptExplainerArtifacts: mocks.deleteArtifacts,
  getPptExplainerArtifact: mocks.getArtifact,
  isPptExplainerArtifactUrl: vi.fn(() => false),
}));

vi.mock('./narration-planner', () => ({
  buildPptExplainerNarrationPlan: mocks.buildNarrationPlan,
}));

vi.mock('./source-resolver', () => ({
  freezeCurrentPptSource: mocks.freezeCurrentPptSource,
  materializePptExplainerSlideImages: mocks.materializeSlideImages,
  prepareMissingPptSlideImages: mocks.prepareMissingPptSlideImages,
  applyPptxCheckpointToExplainerState: mocks.applyPptxCheckpoint,
  listCurrentPptFrameIds: mocks.listCurrentPptFrameIds,
  getCurrentPptExplainerDraftOwners: mocks.getDraftOwners,
}));

vi.mock('../pptx-import', () => ({
  importPptx: mocks.importPptx,
  importPptxBlob: mocks.importPptxBlob,
  resumePptxImport: mocks.resumePptxImport,
  deletePptxImportCache: mocks.deletePptxImportCache,
  deletePptxImportCacheByJobId: mocks.deletePptxImportCacheByJobId,
  PptxImportError: class PptxImportError extends Error {
    constructor(readonly code: string, readonly kind: string, message: string) {
      super(message);
    }
  },
}));

vi.mock('./task-state', () => ({
  updatePptExplainerRootTask: mocks.updateRootTask,
}));

function createState(
  overrides: Partial<PptExplainerTaskState> = {}
): PptExplainerTaskState {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    source: 'pptx',
    sourceBoardId: 'board-1',
    topic: '季度复盘',
    deckFingerprint: 'same-deck',
    reviewMode: 'skip_after_warning',
    reviewAcceptedAt: 1,
    presenterMode: 'single_voice',
    secondsPerSlide: 10,
    speakers: [
      {
        id: 'host',
        displayName: '主持人',
        voiceId: 'voice-1',
      },
    ],
    stage: 'polling',
    slides: [
      {
        pageIndex: 1,
        snapshotUrl: '/slide-1.png',
        snapshotMimeType: 'image/png',
        turns: [{ speakerId: 'host', text: '第一页讲解' }],
      },
    ],
    idempotencyKey: 'idem-1',
    remoteId: 'remote-1',
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
            sources: ['pptx'],
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
  id: string,
  stateOverrides: Partial<PptExplainerTaskState> = {}
): Task {
  const state = createState({ jobId: `job-${id}`, ...stateOverrides });
  return {
    id,
    type: TaskType.VIDEO,
    status: TaskStatus.PROCESSING,
    params: {
      prompt: state.topic || 'PPT 讲解视频',
      model: state.models.videoModel,
      pptExplainer: state,
    },
    createdAt: 1,
    updatedAt: 1,
    progress: 55,
    remoteId: state.remoteId,
    executionPhase: TaskExecutionPhase.POLLING,
  };
}

function createPptxCheckpoint(
  overrides: Partial<PptxImportCheckpoint> = {}
): PptxImportCheckpoint {
  return {
    schemaVersion: 1,
    jobId: 'job-pptx-resume',
    status: 'rendering',
    source: {
      cacheUrl: '/__aitu_cache__/pptx-import/source.pptx',
      fileName: 'deck.pptx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size: 1024,
      fingerprint: 'pptx-fingerprint',
      fingerprintAlgorithm: 'sha256',
    },
    slideSize: {
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
      aspectRatio: 16 / 9,
    },
    slideCount: 2,
    slides: [
      {
        pageIndex: 1,
        cacheUrl: '/__aitu_cache__/pptx-import/slide-1.svg',
        diagnostics: [],
      },
    ],
    diagnostics: [],
    renderer: {
      name: 'pptx-glimpse',
      version: '5.3.0',
      outputMimeType: 'image/svg+xml',
    },
    ...overrides,
  };
}

function installTask(task: Task): void {
  mocks.tasks.set(task.id, task);
}

beforeEach(() => {
  mocks.tasks.clear();
  vi.clearAllMocks();
  mocks.resolveProviderRoute.mockReturnValue({ provider: {}, binding: {} });
  mocks.resolveInvocationPlanFromRoute.mockReturnValue(null);
  mocks.resolveTaskInvocationRouteModel.mockReturnValue(null);
  mocks.getEffectiveVideoModelConfigForSelection.mockReturnValue({
    durationOptions: [
      { label: '5秒', value: '5' },
      { label: '10秒', value: '10' },
    ],
    defaultDuration: '5',
  });
  mocks.cacheRemoteUrl.mockImplementation(async (url: string) => url);
  mocks.deleteArtifacts.mockResolvedValue(undefined);
  mocks.deletePptxImportCache.mockResolvedValue(undefined);
  mocks.deletePptxImportCacheByJobId.mockResolvedValue(undefined);
  mocks.deleteTask.mockImplementation((taskId: string) => {
    mocks.tasks.delete(taskId);
  });
  mocks.getAllCachedMedia.mockResolvedValue([]);
  mocks.deleteCache.mockResolvedValue(undefined);
  mocks.cacheMediaFromBlob.mockImplementation(async (url: string) => url);
  mocks.cancelJob.mockResolvedValue({ attempted: true, status: 'cancelled' });
  mocks.getCanvasBoardBinding.mockReturnValue({
    board: {},
    boardId: 'board-1',
  });
  mocks.getCachedBlob.mockResolvedValue(
    new Blob(['slide'], { type: 'image/png' })
  );
  mocks.prepareMissingPptSlideImages.mockResolvedValue(new Map());
  mocks.materializeSlideImages.mockResolvedValue(undefined);
  mocks.generatePPT.mockResolvedValue({
    success: true,
    type: 'text',
    data: {
      outline: {
        title: '季度复盘',
        pages: [{ layout: 'cover', title: '季度复盘' }],
      },
    },
  });
  mocks.listCurrentPptFrameIds.mockReturnValue(['frame-1']);
  mocks.getDraftOwners.mockReturnValue(['job-topic-preparing']);
  mocks.buildNarrationPlan.mockImplementation(async (slides) =>
    slides.map((slide) => ({
      ...slide,
      turns: slide.turns.length
        ? slide.turns
        : [{ speakerId: 'host', text: `第 ${slide.pageIndex} 页讲解` }],
    }))
  );
  mocks.composeLocalPptVideo.mockResolvedValue({
    blob: new Blob(['composed-video'], { type: 'video/webm' }),
    url: 'blob:composed-video',
    mimeType: 'video/webm',
    duration: 10,
  });
  mocks.updateRootTask.mockImplementation(
    async (
      taskId: string,
      update: {
        state: PptExplainerTaskState;
        status?: TaskStatus;
        progress?: number;
        remoteId?: string;
        result?: Task['result'];
        error?: Task['error'];
        executionPhase?: TaskExecutionPhase;
      },
      options: {
        expectedExecutionAttempt?: number;
        allowTerminal?: boolean;
      } = {}
    ) => {
      const current = mocks.tasks.get(taskId);
      const currentState = current?.params.pptExplainer as
        | PptExplainerTaskState
        | undefined;
      if (!current || !currentState) return null;
      if (
        options.expectedExecutionAttempt !== undefined &&
        currentState.executionAttempt !== options.expectedExecutionAttempt
      ) {
        return null;
      }
      if (
        !options.allowTerminal &&
        (current.status === TaskStatus.FAILED ||
          current.status === TaskStatus.CANCELLED ||
          current.status === TaskStatus.COMPLETED)
      ) {
        return null;
      }
      const updated: Task = {
        ...current,
        status: update.status ?? current.status,
        params: { ...current.params, pptExplainer: update.state },
        progress: update.progress ?? current.progress,
        remoteId: update.remoteId ?? current.remoteId,
        result: update.result ?? current.result,
        error: update.error,
        executionPhase: update.executionPhase,
        updatedAt: current.updatedAt + 1,
      };
      mocks.tasks.set(taskId, updated);
      return updated;
    }
  );
});

describe('PPT explainer orchestrator recovery and isolation', () => {
  it('按讲解者顺序生成双人有声视频提示词', () => {
    const prompt = buildPptExplainerVideoPrompt(
      {
        pageIndex: 1,
        turns: [
          { speakerId: 'host', text: '欢迎参加发布会。' },
          { speakerId: 'guest', text: '先看本页核心数据。' },
        ],
      },
      [
        { id: 'host', displayName: '主持人' },
        { id: 'guest', displayName: '嘉宾' },
      ]
    );

    expect(prompt).toContain('主持人：欢迎参加发布会。');
    expect(prompt).toContain('嘉宾：先看本页核心数据。');
    expect(prompt.indexOf('主持人：')).toBeLessThan(prompt.indexOf('嘉宾：'));
    expect(prompt).toContain('不同的声线');
    expect(prompt).toContain('最终只使用其音轨');
    expect(prompt).toContain('禁止背景音乐');
  });

  it('固定原 PPT 页面并仅使用逐页生成片段的音轨', async () => {
    const taskId = 'local-fixed-ppt';
    installTask(
      createTask(taskId, {
        executionMode: 'local',
        source: 'current_ppt',
        stage: 'submitting',
        remoteId: undefined,
        originalRoute: undefined,
        speakers: [
          { id: 'host', displayName: '主持人' },
          { id: 'guest', displayName: '嘉宾' },
        ],
        presenterMode: 'dual_voice',
        slides: [
          {
            pageIndex: 1,
            snapshotUrl: '/slide-1.png',
            snapshotMimeType: 'image/png',
            turns: [{ speakerId: 'host', text: '第一页讲解' }],
          },
          {
            pageIndex: 2,
            snapshotUrl: '/slide-2.png',
            snapshotMimeType: 'image/png',
            turns: [{ speakerId: 'guest', text: '第二页讲解' }],
          },
        ],
      })
    );
    mocks.generateVideo
      .mockImplementationOnce(async (_prompt, options) => {
        options.onTaskCreated?.('segment-task-1');
        return {
          task: { id: 'segment-task-1' },
          url: 'https://cdn.example.com/segment-1.mp4',
        };
      })
      .mockImplementationOnce(async (_prompt, options) => {
        options.onTaskCreated?.('segment-task-2');
        return {
          task: { id: 'segment-task-2' },
          url: 'https://cdn.example.com/segment-2.mp4',
        };
      });
    mocks.cacheRemoteUrl.mockImplementation(
      async (url: string, ownerTaskId: string) =>
        url.startsWith('https://cdn.example.com/segment-')
          ? `/__aitu_cache__/video/${ownerTaskId}.mp4`
          : url
    );
    mocks.composeLocalPptVideo.mockImplementation(async (input) => {
      await input.onProgress?.(50, '正在合成第 1/2 页');
      await input.onProgress?.(100, '正在合成第 2/2 页');
      return {
        blob: new Blob(['composed-video'], { type: 'video/webm' }),
        url: 'blob:composed-video',
        mimeType: 'video/webm',
        duration: 20,
      };
    });

    await runPptExplainerTask(taskId);

    expect(mocks.generateVideo).toHaveBeenCalledTimes(2);
    expect(mocks.generateVideo).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('主持人：第一页讲解'),
      expect.objectContaining({
        model: 'video-model',
        modelRef: { profileId: 'profile-1', modelId: 'video-model' },
        size: undefined,
        duration: 10,
        resultVisibility: 'internal',
        autoInsertToCanvas: false,
      })
    );
    for (const [, options] of mocks.generateVideo.mock.calls) {
      expect(options).not.toHaveProperty('referenceImages');
    }
    expect(mocks.composeLocalPptVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        slides: [
          {
            imageUrl: '/slide-1.png',
            turns: [
              {
                mediaUrl: '/__aitu_cache__/video/segment-task-1.mp4',
                subtitleCues: [
                  {
                    speakerName: '主持人',
                    text: '第一页讲解',
                    startSeconds: 0,
                    endSeconds: 10,
                  },
                ],
                maxDurationSeconds: 10,
                outputDurationSeconds: 10,
              },
            ],
          },
          {
            imageUrl: '/slide-2.png',
            turns: [
              {
                mediaUrl: '/__aitu_cache__/video/segment-task-2.mp4',
                subtitleCues: [
                  {
                    speakerName: '嘉宾',
                    text: '第二页讲解',
                    startSeconds: 0,
                    endSeconds: 10,
                  },
                ],
                maxDurationSeconds: 10,
                outputDurationSeconds: 10,
              },
            ],
          },
        ],
        transitionDurationMs: 0,
      })
    );
    expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
      `/__aitu_cache__/video/${taskId}.webm`,
      expect.any(Blob),
      'video',
      { taskId, resultVisibility: 'user' }
    );
    expect(mocks.tasks.get(taskId)?.error).toBeUndefined();
    expect(mocks.tasks.get(taskId)).toMatchObject({
      status: TaskStatus.COMPLETED,
      result: {
        url: `/__aitu_cache__/video/${taskId}.webm`,
        format: 'webm',
        duration: 20,
      },
      params: {
        pptExplainer: {
          stage: 'completed',
          internalTaskIds: ['segment-task-1', 'segment-task-2'],
        },
      },
    });
  });

  it('在讲解片段无法缓存为同源媒体时停止合成', async () => {
    const taskId = 'local-cache-failed';
    installTask(
      createTask(taskId, {
        executionMode: 'local',
        source: 'current_ppt',
        stage: 'submitting',
        remoteId: undefined,
        originalRoute: undefined,
      })
    );
    mocks.generateVideo.mockImplementation(async (_prompt, options) => {
      options.onTaskCreated?.('segment-task-failed');
      return {
        task: { id: 'segment-task-failed' },
        url: 'https://cross-origin.example.com/segment.mp4',
      };
    });
    mocks.cacheRemoteUrl.mockResolvedValue(
      'https://cross-origin.example.com/segment.mp4'
    );

    await runPptExplainerTask(taskId);

    expect(mocks.generateVideo).toHaveBeenCalledOnce();
    expect(mocks.composeLocalPptVideo).not.toHaveBeenCalled();
    expect(mocks.tasks.get(taskId)).toMatchObject({
      status: TaskStatus.FAILED,
      error: {
        message: expect.stringContaining('讲解片段未能缓存到本地'),
      },
    });
  });

  it('仅重生成一次质量不合格的讲解片段', async () => {
    const taskId = 'local-quality-retry';
    installTask(
      createTask(taskId, {
        executionMode: 'local',
        source: 'current_ppt',
        stage: 'submitting',
        remoteId: undefined,
        originalRoute: undefined,
      })
    );
    mocks.generateVideo.mockImplementation(async (_prompt, options) => {
      const attempt = mocks.generateVideo.mock.calls.length;
      const internalTaskId = `segment-quality-${attempt}`;
      options.onTaskCreated?.(internalTaskId);
      return {
        task: { id: internalTaskId },
        url: `https://cdn.example.com/${internalTaskId}.mp4`,
      };
    });
    mocks.cacheRemoteUrl.mockImplementation(
      async (_url: string, ownerTaskId: string) =>
        `/__aitu_cache__/video/${ownerTaskId}.mp4`
    );
    mocks.composeLocalPptVideo
      .mockRejectedValueOnce(
        Object.assign(new Error('讲解片段没有检测到有效声音'), {
          code: 'PPT_NARRATION_QUALITY',
          reason: 'silent',
          slideIndex: 0,
          turnIndex: 0,
        })
      )
      .mockResolvedValueOnce({
        blob: new Blob(['composed-video'], { type: 'video/webm' }),
        url: 'blob:composed-video',
        mimeType: 'video/webm',
        duration: 10,
      });

    await runPptExplainerTask(taskId);

    expect(mocks.generateVideo).toHaveBeenCalledTimes(2);
    expect(mocks.composeLocalPptVideo).toHaveBeenCalledTimes(2);
    expect(mocks.composeLocalPptVideo.mock.calls[1]?.[0]).toMatchObject({
      slides: [
        {
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment-quality-2.mp4',
            },
          ],
        },
      ],
    });
    expect(mocks.tasks.get(taskId)).toMatchObject({
      status: TaskStatus.COMPLETED,
      params: {
        pptExplainer: {
          internalTaskIds: ['segment-quality-1', 'segment-quality-2'],
        },
      },
    });
  });

  it('同一讲解片段连续两次质量失败后停止', async () => {
    const taskId = 'local-quality-retry-failed';
    installTask(
      createTask(taskId, {
        executionMode: 'local',
        source: 'current_ppt',
        stage: 'submitting',
        remoteId: undefined,
        originalRoute: undefined,
      })
    );
    mocks.generateVideo.mockImplementation(async (_prompt, options) => {
      const attempt = mocks.generateVideo.mock.calls.length;
      const internalTaskId = `segment-silent-${attempt}`;
      options.onTaskCreated?.(internalTaskId);
      return {
        task: { id: internalTaskId },
        url: `https://cdn.example.com/${internalTaskId}.mp4`,
      };
    });
    mocks.cacheRemoteUrl.mockImplementation(
      async (_url: string, ownerTaskId: string) =>
        `/__aitu_cache__/video/${ownerTaskId}.mp4`
    );
    const qualityError = () =>
      Object.assign(new Error('讲解片段没有检测到有效声音'), {
        code: 'PPT_NARRATION_QUALITY',
        reason: 'silent',
        slideIndex: 0,
        turnIndex: 0,
      });
    mocks.composeLocalPptVideo
      .mockRejectedValueOnce(qualityError())
      .mockRejectedValueOnce(qualityError());

    await runPptExplainerTask(taskId);

    expect(mocks.generateVideo).toHaveBeenCalledTimes(2);
    expect(mocks.composeLocalPptVideo).toHaveBeenCalledTimes(2);
    expect(mocks.cacheMediaFromBlob).not.toHaveBeenCalled();
    expect(mocks.tasks.get(taskId)).toMatchObject({
      status: TaskStatus.FAILED,
      error: { message: '讲解片段没有检测到有效声音' },
    });
  });

  it('优先通过内部任务的鉴权内容接口下载讲解片段', async () => {
    const taskId = 'local-authenticated-download';
    installTask(
      createTask(taskId, {
        executionMode: 'local',
        source: 'current_ppt',
        stage: 'submitting',
        remoteId: undefined,
        originalRoute: undefined,
      })
    );
    const invocationRoute = {
      operation: 'video' as const,
      modelRef: { profileId: 'profile-1', modelId: 'video-model' },
      providerProfileId: 'profile-1',
      providerType: 'custom',
      modelId: 'video-model',
      binding: {
        id: 'video-binding',
        protocol: 'seedance.task',
        requestSchema: 'seedance.video.form-auto',
        responseSchema: 'seedance.video.task',
        submitPath: '/videos',
        pollPathTemplate: '/videos/{taskId}',
      },
    };
    mocks.generateVideo.mockImplementation(async (_prompt, options) => {
      options.onTaskCreated?.('segment-task-auth');
      return {
        task: {
          id: 'segment-task-auth',
          remoteId: 'remote-segment-id',
          invocationRoute,
        },
        url: 'https://cdn.example.com/segment-auth.mp4',
      };
    });
    mocks.resolveTaskInvocationRouteModel.mockReturnValue({
      profileId: 'profile-1',
      modelId: 'video-model',
    });
    mocks.resolveInvocationPlanFromRoute.mockReturnValue({
      provider: { profileId: 'profile-1' },
      binding: { id: 'video-binding' },
      modelRef: { profileId: 'profile-1', modelId: 'video-model' },
    });
    mocks.downloadVideoContentToLocalUrl.mockResolvedValue(
      '/__aitu_cache__/video/segment-task-auth.mp4'
    );

    await runPptExplainerTask(taskId);

    expect(mocks.downloadVideoContentToLocalUrl).toHaveBeenCalledWith({
      videoId: 'remote-segment-id',
      provider: { profileId: 'profile-1' },
      binding: { id: 'video-binding' },
      modelId: 'video-model',
      cacheKey: 'segment-task-auth',
      resultVisibility: 'internal',
      signal: expect.any(AbortSignal),
      fallbackToObjectUrl: false,
    });
    expect(mocks.cacheRemoteUrl).not.toHaveBeenCalledWith(
      'https://cdn.example.com/segment-auth.mp4',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(mocks.composeLocalPptVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        slides: [
          expect.objectContaining({
            turns: [
              expect.objectContaining({
                mediaUrl: '/__aitu_cache__/video/segment-task-auth.mp4',
              }),
            ],
          }),
        ],
      })
    );
    expect(mocks.tasks.get(taskId)?.status).toBe(TaskStatus.COMPLETED);
  });

  it('鉴权下载和结果地址缓存都失败时保留真实接口错误', async () => {
    const taskId = 'local-all-downloads-failed';
    installTask(
      createTask(taskId, {
        executionMode: 'local',
        source: 'current_ppt',
        stage: 'submitting',
        remoteId: undefined,
        originalRoute: undefined,
      })
    );
    mocks.generateVideo.mockImplementation(async (_prompt, options) => {
      options.onTaskCreated?.('segment-task-download-failed');
      return {
        task: {
          id: 'segment-task-download-failed',
          remoteId: 'remote-segment-id',
        },
        url: 'https://cdn.example.com/segment-download-failed.mp4',
      };
    });
    mocks.resolveInvocationPlanFromRoute.mockReturnValue({
      provider: { profileId: 'profile-1' },
      binding: { id: 'video-binding' },
      modelRef: { profileId: 'profile-1', modelId: 'video-model' },
    });
    mocks.downloadVideoContentToLocalUrl.mockRejectedValue(
      new Error('视频内容下载失败: 502 - upstream unavailable')
    );
    mocks.cacheRemoteUrl.mockResolvedValue(
      'https://cdn.example.com/segment-download-failed.mp4'
    );

    await runPptExplainerTask(taskId);

    expect(mocks.composeLocalPptVideo).not.toHaveBeenCalled();
    expect(mocks.tasks.get(taskId)).toMatchObject({
      status: TaskStatus.FAILED,
      error: {
        message: expect.stringContaining(
          '视频内容下载失败: 502 - upstream unavailable'
        ),
      },
    });
  });

  it('透传内部视频任务的供应商错误而不是覆盖成通用失败', async () => {
    const taskId = 'provider-error-task';
    installTask(
      createTask(taskId, {
        executionMode: 'local',
        source: 'current_ppt',
        stage: 'submitting',
        remoteId: undefined,
        originalRoute: undefined,
      })
    );
    mocks.generateVideo.mockResolvedValue({
      task: {
        id: 'segment-provider-error',
        error: {
          code: 'UPSTREAM_FAILED',
          message: '上游服务异常（request id: req-123）',
        },
      },
    });

    await runPptExplainerTask(taskId);

    expect(mocks.tasks.get(taskId)).toMatchObject({
      status: TaskStatus.FAILED,
      error: {
        message: '上游服务异常（request id: req-123）',
      },
    });
    expect(mocks.composeLocalPptVideo).not.toHaveBeenCalled();
  });
  it('does not restart a failed task without an explicit retry transition', async () => {
    installTask({
      ...createTask('failed-terminal', { stage: 'failed' }),
      status: TaskStatus.FAILED,
    });

    await runPptExplainerTask('failed-terminal');

    expect(mocks.updateRootTask).not.toHaveBeenCalled();
    expect(mocks.submitJob).not.toHaveBeenCalled();
    expect(mocks.pollJob).not.toHaveBeenCalled();
    expect(mocks.tasks.get('failed-terminal')?.status).toBe(TaskStatus.FAILED);
  });

  it('freezes the current PPT and submits it through the normal completion flow', async () => {
    installTask(
      createTask('current-ppt-success', {
        source: 'current_ppt',
        stage: 'snapshotting',
        remoteId: undefined,
        slides: [],
        outlineFrameIds: ['frame-1'],
        sourceFrameRevisions: { 'frame-1': 'revision-1' },
      })
    );
    installTask({
      id: 'internal-image-1',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      params: { prompt: '页面图', resultVisibility: 'internal' },
      createdAt: 1,
      updatedAt: 1,
      result: {
        url: '/__aitu_cache__/image/internal-image-1.png',
        format: 'png',
        size: 10,
        resultVisibility: 'internal',
      },
    });
    mocks.prepareMissingPptSlideImages.mockImplementation(
      async (_board, options) => {
        options.onInternalTaskCreated?.('internal-image-1');
        return new Map([
          ['frame-1', '/__aitu_cache__/image/internal-image-1.png'],
        ]);
      }
    );
    mocks.materializeSlideImages.mockResolvedValue({
      frameIds: ['frame-1'],
      frameRevisions: { 'frame-1': 'revision-with-visible-image' },
    });
    mocks.getAllCachedMedia.mockResolvedValue([
      {
        url: '/__aitu_cache__/image/internal-image-1.png',
        metadata: { taskId: 'internal-image-1' },
      },
    ]);
    mocks.freezeCurrentPptSource.mockResolvedValue({
      slides: [
        {
          pageIndex: 1,
          frameId: 'frame-1',
          snapshotUrl: '/current-slide-1.png',
          snapshotMimeType: 'image/png',
          notes: '现有备注',
          turns: [],
        },
      ],
      deckFingerprint: 'current-ppt-fingerprint',
      frameIds: ['frame-1'],
    });
    mocks.submitJob.mockResolvedValue({
      status: 'completed',
      remoteId: 'remote-current-ppt',
      finalVideoUrl: 'https://cdn.example.com/current-ppt.mp4',
    });

    await runPptExplainerTask('current-ppt-success');

    expect(mocks.prepareMissingPptSlideImages).toHaveBeenCalledTimes(1);
    expect(mocks.freezeCurrentPptSource).toHaveBeenCalledTimes(1);
    expect(mocks.materializeSlideImages).toHaveBeenCalledWith(
      expect.anything(),
      new Map([['frame-1', '/__aitu_cache__/image/internal-image-1.png']]),
      expect.objectContaining({
        jobId: 'job-current-ppt-success',
        selection: {
          frameIds: ['frame-1'],
          frameRevisions: { 'frame-1': 'revision-1' },
        },
      })
    );
    expect(mocks.prepareMissingPptSlideImages).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        selection: {
          frameIds: ['frame-1'],
          frameRevisions: { 'frame-1': 'revision-1' },
        },
      })
    );
    expect(mocks.freezeCurrentPptSource.mock.calls[0]?.[2]).not.toHaveProperty(
      'slideImageOverrides'
    );
    expect(mocks.freezeCurrentPptSource).toHaveBeenCalledWith(
      expect.anything(),
      'job-current-ppt-success',
      expect.objectContaining({
        selection: {
          frameIds: ['frame-1'],
          frameRevisions: { 'frame-1': 'revision-with-visible-image' },
        },
      })
    );
    expect(mocks.deleteTask).toHaveBeenCalledWith('internal-image-1');
    expect(mocks.deleteCache).toHaveBeenCalledWith(
      '/__aitu_cache__/image/internal-image-1.png'
    );
    const submittedSlides = await collectSubmittedSlides();
    expect(mocks.submitJob).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: expect.objectContaining({
          source: 'current_ppt',
          deckFingerprint: 'current-ppt-fingerprint',
          slides: [
            expect.objectContaining({
              pageIndex: 1,
              notes: '现有备注',
              turns: [{ speakerId: 'host', text: '第 1 页讲解' }],
            }),
          ],
        }),
        slides: expect.objectContaining({
          [Symbol.asyncIterator]: expect.any(Function),
        }),
      })
    );
    expect(submittedSlides).toEqual([
      expect.objectContaining({
        pageIndex: 1,
        blob: expect.any(Blob),
      }),
    ]);
    expect(mocks.tasks.get('current-ppt-success')).toMatchObject({
      status: TaskStatus.COMPLETED,
      result: {
        url: 'https://cdn.example.com/current-ppt.mp4',
        resultVisibility: 'user',
        cacheWarning: {
          status: 'unavailable',
          reasonCode: 'cache_missing',
        },
      },
      params: {
        pptExplainer: {
          source: 'current_ppt',
          stage: 'completed',
          deckFingerprint: 'current-ppt-fingerprint',
          internalTaskIds: ['internal-image-1'],
        },
      },
    });
  });

  it('cleans an owned internal image task when snapshot preparation fails', async () => {
    installTask(
      createTask('current-ppt-failed', {
        source: 'current_ppt',
        stage: 'snapshotting',
        remoteId: undefined,
        slides: [],
        outlineFrameIds: ['frame-1'],
        sourceFrameRevisions: { 'frame-1': 'revision-1' },
      })
    );
    installTask({
      id: 'internal-image-failed',
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      params: { prompt: '页面图', resultVisibility: 'internal' },
      createdAt: 1,
      updatedAt: 1,
      error: { code: 'IMAGE_FAILED', message: '图片生成失败' },
    });
    mocks.prepareMissingPptSlideImages.mockImplementation(
      async (_board, options) => {
        options.onInternalTaskCreated?.('internal-image-failed');
        throw new Error('页面图生成失败');
      }
    );
    mocks.getAllCachedMedia.mockResolvedValue([
      {
        url: '/__aitu_cache__/image/internal-image-failed.png',
        metadata: { taskId: 'internal-image-failed' },
      },
    ]);

    await runPptExplainerTask('current-ppt-failed');

    expect(mocks.deleteTask).toHaveBeenCalledWith('internal-image-failed');
    expect(mocks.deleteCache).toHaveBeenCalledWith(
      '/__aitu_cache__/image/internal-image-failed.png'
    );
    expect(mocks.tasks.get('current-ppt-failed')).toMatchObject({
      status: TaskStatus.FAILED,
      params: {
        pptExplainer: {
          stage: 'failed',
          internalTaskIds: ['internal-image-failed'],
        },
      },
      error: { message: '页面图生成失败' },
    });
  });

  it('imports a new PPTX inside the cancellable root run and skips rendering for passthrough', async () => {
    const taskId = 'pptx-cache-only';
    const jobId = 'job-pptx-cache-only';
    const file = new File(['pptx'], 'deck.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const checkpoint = createPptxCheckpoint({
      jobId,
      mode: 'cache-only',
      status: 'completed',
      slideCount: 1,
      slides: [{ pageIndex: 1, notes: '原始备注', diagnostics: [] }],
    });
    installTask(
      createTask(taskId, {
        jobId,
        source: 'pptx',
        stage: 'preparing',
        remoteId: undefined,
        presentationInput: 'pptx',
        slides: [],
      })
    );
    registerPptExplainerPptxInput(jobId, file);
    mocks.importPptx.mockImplementation(async (_file, options) => {
      await options.onCheckpoint?.(checkpoint);
      return checkpoint;
    });
    mocks.applyPptxCheckpoint.mockImplementation((state, nextCheckpoint) => ({
      ...state,
      pptxImport: nextCheckpoint,
      pptx: {
        filename: nextCheckpoint.source.fileName,
        mimeType: nextCheckpoint.source.mimeType,
        cacheUrl: nextCheckpoint.source.cacheUrl,
        fingerprint: nextCheckpoint.source.fingerprint,
      },
      deckFingerprint: nextCheckpoint.source.fingerprint,
      slides: nextCheckpoint.slides.map((slide) => ({
        pageIndex: slide.pageIndex,
        notes: slide.notes,
        turns: [],
      })),
    }));
    mocks.submitJob.mockResolvedValue({
      status: 'completed',
      remoteId: 'remote-pptx-cache-only',
      finalVideoUrl: 'https://cdn.example.com/pptx-cache-only.mp4',
    });

    await runPptExplainerTask(taskId);

    expect(mocks.importPptx).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        jobId,
        mode: 'cache-only',
        signal: expect.any(AbortSignal),
      })
    );
    expect(mocks.resumePptxImport).not.toHaveBeenCalled();
    expect(mocks.submitJob).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: expect.any(Blob),
        slides: undefined,
        manifest: expect.objectContaining({
          source: 'pptx',
          slides: [
            expect.objectContaining({ pageIndex: 1, notes: '原始备注' }),
          ],
        }),
      })
    );
    expect(mocks.tasks.get(taskId)).toMatchObject({
      status: TaskStatus.COMPLETED,
      params: { pptExplainer: { stage: 'completed' } },
    });
  });

  it('resumes a staged PPTX after refresh before the first checkpoint', async () => {
    const taskId = 'pptx-staged-recovery';
    const jobId = 'job-pptx-staged-recovery';
    const checkpoint = createPptxCheckpoint({
      jobId,
      mode: 'cache-only',
      status: 'completed',
      slideCount: 1,
      slides: [{ pageIndex: 1, notes: '恢复备注', diagnostics: [] }],
    });
    installTask(
      createTask(taskId, {
        jobId,
        source: 'pptx',
        stage: 'preparing',
        remoteId: undefined,
        presentationInput: 'pptx',
        slides: [],
        pptx: {
          filename: 'staged.pptx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          cacheUrl:
            '/__aitu_internal__/ppt-explainer/job-pptx-staged-recovery/source.pptx',
          fingerprint: `pending-${jobId}`,
        },
      })
    );
    const stagedBlob = new Blob(['pptx'], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    mocks.getArtifact.mockResolvedValue(stagedBlob);
    mocks.importPptxBlob.mockImplementation(
      async (_blob, _fileName, options) => {
        await options.onCheckpoint?.(checkpoint);
        return checkpoint;
      }
    );
    mocks.applyPptxCheckpoint.mockImplementation((state, nextCheckpoint) => ({
      ...state,
      pptxImport: nextCheckpoint,
      pptx: {
        filename: nextCheckpoint.source.fileName,
        mimeType: nextCheckpoint.source.mimeType,
        cacheUrl: nextCheckpoint.source.cacheUrl,
        fingerprint: nextCheckpoint.source.fingerprint,
      },
      deckFingerprint: nextCheckpoint.source.fingerprint,
      slides: nextCheckpoint.slides.map((slide) => ({
        pageIndex: slide.pageIndex,
        notes: slide.notes,
        turns: [],
      })),
    }));
    mocks.submitJob.mockResolvedValue({
      status: 'completed',
      remoteId: 'remote-staged',
      finalVideoUrl: 'https://cdn.example.com/staged.mp4',
    });

    await runPptExplainerTask(taskId);

    expect(mocks.importPptx).not.toHaveBeenCalled();
    expect(mocks.importPptxBlob).toHaveBeenCalledWith(
      stagedBlob,
      'staged.pptx',
      expect.objectContaining({
        jobId,
        mode: 'cache-only',
        signal: expect.any(AbortSignal),
      })
    );
    expect(mocks.tasks.get(taskId)).toMatchObject({
      status: TaskStatus.COMPLETED,
      params: { pptExplainer: { stage: 'completed' } },
    });
  });

  it('aborts initial PPTX import when the visible root task is cancelled', async () => {
    const taskId = 'pptx-import-cancel';
    const jobId = 'job-pptx-import-cancel';
    const file = new File(['pptx'], 'deck.pptx');
    installTask(
      createTask(taskId, {
        jobId,
        source: 'pptx',
        stage: 'preparing',
        remoteId: undefined,
        presentationInput: 'slide_images',
        slides: [],
      })
    );
    registerPptExplainerPptxInput(jobId, file);
    let importSignal: AbortSignal | undefined;
    mocks.importPptx.mockImplementation(
      (_file, options) =>
        new Promise((_resolve, reject) => {
          importSignal = options.signal;
          options.signal?.addEventListener(
            'abort',
            () => reject(options.signal?.reason),
            {
              once: true,
            }
          );
        })
    );

    const run = runPptExplainerTask(taskId);
    await vi.waitFor(() => expect(mocks.importPptx).toHaveBeenCalledTimes(1));
    const activeTask = mocks.tasks.get(taskId)!;
    const activeState = activeTask.params.pptExplainer as PptExplainerTaskState;
    const cancelledTask: Task = {
      ...activeTask,
      status: TaskStatus.CANCELLED,
      params: {
        ...activeTask.params,
        pptExplainer: { ...activeState, stage: 'cancelled' },
      },
    };
    mocks.tasks.set(taskId, cancelledTask);
    await cancelPptExplainerRemoteTask(cancelledTask);
    await run;

    expect(importSignal?.aborted).toBe(true);
    expect(mocks.submitJob).not.toHaveBeenCalled();
    expect(mocks.deletePptxImportCacheByJobId).toHaveBeenCalledWith(jobId);
    expect(mocks.tasks.get(taskId)?.status).toBe(TaskStatus.CANCELLED);
  });

  it.each([
    {
      mode: 'single_voice' as const,
      speakers: [{ id: 'host', displayName: '主持人', voiceId: 'voice-1' }],
    },
    {
      mode: 'dual_voice' as const,
      speakers: [
        { id: 'host', displayName: '主持人', voiceId: 'voice-1' },
        { id: 'guest', displayName: '嘉宾', voiceId: 'voice-2' },
      ],
    },
    {
      mode: 'single_avatar' as const,
      speakers: [
        {
          id: 'host',
          displayName: '主持人',
          voiceId: 'voice-1',
          avatarAssetId: 'avatar-host',
        },
      ],
    },
    {
      mode: 'dual_avatar' as const,
      speakers: [
        {
          id: 'host',
          displayName: '主持人',
          voiceId: 'voice-1',
          avatarAssetId: 'avatar-host',
        },
        {
          id: 'guest',
          displayName: '嘉宾',
          voiceId: 'voice-2',
          avatarAssetId: 'avatar-guest',
        },
      ],
    },
  ])('submits a valid $mode presenter manifest', async ({ mode, speakers }) => {
    const turns = speakers.map((speaker) => ({
      speakerId: speaker.id,
      text: `${speaker.displayName}讲解`,
    }));
    const taskId = `presenter-${mode}`;
    installTask(
      createTask(taskId, {
        source: 'current_ppt',
        presenterMode: mode,
        speakers,
        stage: 'submitting',
        remoteId: undefined,
        slides: [
          {
            pageIndex: 1,
            snapshotUrl: '/slide-1.png',
            snapshotMimeType: 'image/png',
            turns,
          },
        ],
      })
    );
    mocks.submitJob.mockResolvedValue({
      status: 'completed',
      remoteId: `remote-${mode}`,
      finalVideoUrl: `https://cdn.example.com/${mode}.mp4`,
    });

    await runPptExplainerTask(taskId);

    const submittedSlides = await collectSubmittedSlides();
    expect(mocks.submitJob).toHaveBeenCalledTimes(1);
    expect(mocks.submitJob).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: expect.objectContaining({
          presenterMode: mode,
          speakers: speakers.map((speaker) => ({
            ...speaker,
            voiceSource: 'voice_id',
          })),
          slides: [expect.objectContaining({ pageIndex: 1, turns })],
        }),
        slides: expect.objectContaining({
          [Symbol.asyncIterator]: expect.any(Function),
        }),
      })
    );
    expect(submittedSlides).toEqual([
      expect.objectContaining({ pageIndex: 1 }),
    ]);
    expect(mocks.tasks.get(taskId)).toMatchObject({
      status: TaskStatus.COMPLETED,
      params: { pptExplainer: { presenterMode: mode, stage: 'completed' } },
    });
  });

  it('submits a task-private voice sample without leaking cacheUrl into manifest', async () => {
    const taskId = 'reference-audio';
    const cacheUrl =
      '/__aitu_internal__/ppt-explainer/job-reference-audio/voice-reference-01.mp3';
    installTask(
      createTask(taskId, {
        source: 'current_ppt',
        presenterMode: 'single_voice',
        speakers: [
          {
            id: 'host',
            displayName: '主持人',
            voiceSource: 'reference_audio',
            voiceReference: {
              cacheUrl,
              assetName: 'voice-reference-01.mp3',
              filename: 'private-name.mp3',
              mimeType: 'audio/mpeg',
              size: 5,
            },
          },
        ],
        stage: 'submitting',
        remoteId: undefined,
        slides: [
          {
            pageIndex: 1,
            snapshotUrl: '/slide-1.png',
            snapshotMimeType: 'image/png',
            turns: [{ speakerId: 'host', text: '主持人讲解' }],
          },
        ],
      })
    );
    mocks.getCachedBlob.mockImplementation(async (url: string) =>
      url === cacheUrl
        ? new Blob(['voice'], { type: 'audio/mpeg' })
        : new Blob(['slide'], { type: 'image/png' })
    );
    mocks.submitJob.mockResolvedValue({
      status: 'completed',
      remoteId: 'remote-reference-audio',
      finalVideoUrl: 'https://cdn.example.com/reference-audio.mp4',
    });

    await runPptExplainerTask(taskId);

    const submitInput = mocks.submitJob.mock.calls[0][0];
    expect(submitInput.manifest.speakers).toEqual([
      {
        id: 'host',
        displayName: '主持人',
        voiceSource: 'reference_audio',
        voiceReference: { assetName: 'voice-reference-01.mp3' },
      },
    ]);
    expect(JSON.stringify(submitInput.manifest)).not.toContain(cacheUrl);
    await expect(collectSubmittedVoiceReferences()).resolves.toEqual([
      expect.objectContaining({
        assetName: 'voice-reference-01.mp3',
        filename: 'voice-reference-01.mp3',
        mimeType: 'audio/mpeg',
        blob: expect.any(Blob),
      }),
    ]);
    expect(mocks.resolveProviderRoute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requiresReferenceAudio: true })
    );
  });

  it('resumes an existing remote job by polling without submitting again', async () => {
    installTask(createTask('resume-task'));
    mocks.pollJob.mockResolvedValue({
      status: 'completed',
      remoteId: 'remote-1',
      finalVideoUrl: 'https://cdn.example.com/resumed.mp4',
    });

    await runPptExplainerTask('resume-task');

    expect(mocks.submitJob).not.toHaveBeenCalled();
    expect(mocks.pollJob).toHaveBeenCalledTimes(1);
    expect(mocks.pollJob).toHaveBeenCalledWith(
      expect.objectContaining({ remoteId: 'remote-1' })
    );
    expect(mocks.tasks.get('resume-task')).toMatchObject({
      status: TaskStatus.COMPLETED,
      result: { url: 'https://cdn.example.com/resumed.mp4' },
    });
  });

  it('keeps concurrent calls for one task to a single active provider poll', async () => {
    installTask(createTask('idempotent-task'));
    let resolvePoll!: (value: unknown) => void;
    mocks.pollJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        })
    );

    const firstRun = runPptExplainerTask('idempotent-task');
    await vi.waitFor(() => expect(mocks.pollJob).toHaveBeenCalledTimes(1));
    const duplicateRun = runPptExplainerTask('idempotent-task');
    await duplicateRun;
    resolvePoll({
      status: 'completed',
      remoteId: 'remote-1',
      finalVideoUrl: 'https://cdn.example.com/idempotent.mp4',
    });
    await firstRun;

    expect(mocks.pollJob).toHaveBeenCalledTimes(1);
    expect(mocks.tasks.get('idempotent-task')?.status).toBe(
      TaskStatus.COMPLETED
    );
  });

  it('deduplicates same-tick runs before root activation persistence resolves', async () => {
    installTask(createTask('same-tick-task'));
    let resolvePoll!: (value: unknown) => void;
    mocks.pollJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        })
    );

    const runs = [
      runPptExplainerTask('same-tick-task'),
      runPptExplainerTask('same-tick-task'),
    ];
    await vi.waitFor(() => expect(mocks.pollJob).toHaveBeenCalledTimes(1));
    resolvePoll({
      status: 'completed',
      remoteId: 'remote-1',
      finalVideoUrl: 'https://cdn.example.com/same-tick.mp4',
    });
    await Promise.all(runs);

    expect(mocks.pollJob).toHaveBeenCalledTimes(1);
    expect(mocks.submitJob).not.toHaveBeenCalled();
    expect(mocks.tasks.get('same-tick-task')).toMatchObject({
      status: TaskStatus.COMPLETED,
      result: { url: 'https://cdn.example.com/same-tick.mp4' },
      params: { pptExplainer: { executionAttempt: 1 } },
    });
  });

  it('ignores a completed poll response that arrives after local cancellation', async () => {
    installTask(
      createTask('cancelled-task', {
        internalTaskIds: ['internal-image-cancelled'],
      })
    );
    installTask({
      id: 'internal-image-cancelled',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      params: { prompt: '页面图', resultVisibility: 'internal' },
      createdAt: 1,
      updatedAt: 1,
      result: {
        url: '/__aitu_cache__/image/internal-image-cancelled.png',
        format: 'png',
        size: 10,
        resultVisibility: 'internal',
      },
    });
    mocks.getAllCachedMedia.mockResolvedValue([
      {
        url: '/__aitu_cache__/image/internal-image-cancelled.png',
        metadata: { taskId: 'internal-image-cancelled' },
      },
    ]);
    let resolvePoll!: (value: unknown) => void;
    mocks.pollJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        })
    );

    const run = runPptExplainerTask('cancelled-task');
    await vi.waitFor(() => expect(mocks.pollJob).toHaveBeenCalledTimes(1));
    const activeTask = mocks.tasks.get('cancelled-task')!;
    const activeState = activeTask.params.pptExplainer as PptExplainerTaskState;
    const cancelledTask: Task = {
      ...activeTask,
      status: TaskStatus.CANCELLED,
      params: {
        ...activeTask.params,
        pptExplainer: { ...activeState, stage: 'cancelled' },
      },
    };
    mocks.tasks.set(cancelledTask.id, cancelledTask);
    await cancelPptExplainerRemoteTask(cancelledTask);
    resolvePoll({
      status: 'completed',
      remoteId: 'remote-1',
      finalVideoUrl: 'https://cdn.example.com/late.mp4',
    });
    await run;

    expect(mocks.tasks.get('cancelled-task')).toMatchObject({
      status: TaskStatus.CANCELLED,
      params: { pptExplainer: { stage: 'cancelled' } },
    });
    expect(mocks.tasks.get('cancelled-task')?.result).toBeUndefined();
    expect(mocks.cancelJob).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteId: 'remote-1',
        idempotencyKey: 'idem-1',
      })
    );
    expect(mocks.deleteTask).toHaveBeenCalledWith('internal-image-cancelled');
    expect(mocks.deleteCache).toHaveBeenCalledWith(
      '/__aitu_cache__/image/internal-image-cancelled.png'
    );
  });

  it('aborts an active run and releases local inputs without cancelling the provider', async () => {
    const checkpoint = createPptxCheckpoint({
      jobId: 'job-cleanup-only',
      status: 'completed',
    });
    installTask(
      createTask('cleanup-only', {
        jobId: 'job-cleanup-only',
        pptxImport: checkpoint,
        internalTaskIds: ['internal-image-delete'],
      })
    );
    installTask({
      id: 'internal-image-delete',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      params: { prompt: '页面图', resultVisibility: 'internal' },
      createdAt: 1,
      updatedAt: 1,
      result: {
        url: '/__aitu_cache__/image/internal-image-delete.png',
        format: 'png',
        size: 10,
        resultVisibility: 'internal',
      },
    });
    mocks.getAllCachedMedia.mockResolvedValue([
      {
        url: '/__aitu_cache__/image/internal-image-delete.png',
        metadata: { taskId: 'internal-image-delete' },
      },
    ]);
    mocks.pollJob.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        })
    );

    const run = runPptExplainerTask('cleanup-only');
    await vi.waitFor(() => expect(mocks.pollJob).toHaveBeenCalledTimes(1));
    expect(isPptExplainerRunActive('cleanup-only')).toBe(true);

    await cleanupPptExplainerTask(mocks.tasks.get('cleanup-only')!);
    await run;

    expect(isPptExplainerRunActive('cleanup-only')).toBe(false);
    expect(mocks.cancelJob).not.toHaveBeenCalled();
    expect(mocks.deleteArtifacts).toHaveBeenCalledWith('job-cleanup-only');
    expect(mocks.deletePptxImportCache).toHaveBeenCalledWith(checkpoint);
    expect(mocks.deleteTask).toHaveBeenCalledWith('internal-image-delete');
    expect(mocks.deleteCache).toHaveBeenCalledWith(
      '/__aitu_cache__/image/internal-image-delete.png'
    );
  });

  it('suspends active polling on executor unmount without cancelling the task', async () => {
    installTask(createTask('suspend-on-unmount'));
    mocks.pollJob.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        })
    );

    const run = runPptExplainerTask('suspend-on-unmount');
    await vi.waitFor(() => expect(mocks.pollJob).toHaveBeenCalledTimes(1));

    suspendPptExplainerRuns();
    await run;

    expect(isPptExplainerRunActive('suspend-on-unmount')).toBe(false);
    expect(mocks.cancelJob).not.toHaveBeenCalled();
    expect(mocks.tasks.get('suspend-on-unmount')).toMatchObject({
      status: TaskStatus.PROCESSING,
      params: { pptExplainer: { stage: 'polling' } },
    });
  });

  it('cancels the same remote job only once across concurrent and repeated calls', async () => {
    const task = createTask('cancel-deduplicated', {
      jobId: 'job-cancel-deduplicated',
      remoteId: 'remote-cancel-deduplicated',
    });

    await Promise.all([
      cancelPptExplainerRemoteTask(task),
      cancelPptExplainerRemoteTask({
        ...task,
        params: { ...task.params },
      }),
    ]);
    await cancelPptExplainerRemoteTask({
      ...task,
      params: { ...task.params },
    });

    expect(mocks.cancelJob).toHaveBeenCalledTimes(1);
    expect(mocks.cancelJob).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteId: 'remote-cancel-deduplicated',
        idempotencyKey: 'idem-1',
      })
    );
  });

  it('retries remote cancellation after a failed request', async () => {
    const task = createTask('cancel-retry-after-failure', {
      jobId: 'job-cancel-retry-after-failure',
      remoteId: 'remote-cancel-retry-after-failure',
    });
    mocks.cancelJob
      .mockRejectedValueOnce(new Error('HTTP 500 provider response'))
      .mockResolvedValueOnce({ attempted: true, status: 'cancelled' });

    await expect(cancelPptExplainerRemoteTask(task)).rejects.toThrow(
      'HTTP 500'
    );
    await expect(cancelPptExplainerRemoteTask(task)).resolves.toBeUndefined();
    await expect(cancelPptExplainerRemoteTask(task)).resolves.toBeUndefined();

    expect(mocks.cancelJob).toHaveBeenCalledTimes(2);
  });

  it('shares one failed remote cancellation across concurrent callers', async () => {
    const task = createTask('cancel-concurrent-failure', {
      jobId: 'job-cancel-concurrent-failure',
      remoteId: 'remote-cancel-concurrent-failure',
    });
    mocks.cancelJob
      .mockRejectedValueOnce(new Error('HTTP 500 provider response'))
      .mockResolvedValueOnce({ attempted: true, status: 'cancelled' });

    const firstAttempt = Promise.all([
      cancelPptExplainerRemoteTask(task),
      cancelPptExplainerRemoteTask({ ...task, params: { ...task.params } }),
    ]);
    await expect(firstAttempt).rejects.toThrow('HTTP 500');
    expect(mocks.cancelJob).toHaveBeenCalledTimes(1);

    await expect(cancelPptExplainerRemoteTask(task)).resolves.toBeUndefined();
    expect(mocks.cancelJob).toHaveBeenCalledTimes(2);
  });

  it('falls back to the root task remoteId when the PPT state has none', async () => {
    const task = createTask('root-remote-fallback', {
      jobId: 'job-root-remote-fallback',
      remoteId: undefined,
    });
    task.remoteId = 'root-remote-fallback';

    await cancelPptExplainerRemoteTask(task);

    expect(mocks.cancelJob).toHaveBeenCalledTimes(1);
    expect(mocks.cancelJob).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteId: 'root-remote-fallback',
        idempotencyKey: 'idem-1',
      })
    );
  });

  it('persists a provider validation error instead of completing without a URL', async () => {
    installTask(createTask('missing-url-task'));
    mocks.pollJob.mockRejectedValue(
      Object.assign(
        new Error('PPT 讲解视频供应商任务已完成但未返回可用的最终视频 URL'),
        { code: 'invalid_response' }
      )
    );

    await runPptExplainerTask('missing-url-task');

    expect(mocks.tasks.get('missing-url-task')).toMatchObject({
      status: TaskStatus.FAILED,
      error: {
        code: 'invalid_response',
        message: expect.stringContaining('最终视频 URL'),
      },
      params: { pptExplainer: { stage: 'failed' } },
    });
  });

  it('runs two jobs for the same deck fingerprint independently', async () => {
    installTask(
      createTask('deck-task-a', {
        idempotencyKey: 'idem-a',
        remoteId: 'remote-a',
      })
    );
    installTask(
      createTask('deck-task-b', {
        idempotencyKey: 'idem-b',
        remoteId: 'remote-b',
      })
    );
    mocks.pollJob.mockImplementation(async ({ remoteId }) => ({
      status: 'completed',
      remoteId,
      finalVideoUrl: `https://cdn.example.com/${remoteId}.mp4`,
    }));

    await Promise.all([
      runPptExplainerTask('deck-task-a'),
      runPptExplainerTask('deck-task-b'),
    ]);

    expect(mocks.pollJob).toHaveBeenCalledTimes(2);
    expect(
      mocks.pollJob.mock.calls.map(([input]) => input.remoteId).sort()
    ).toEqual(['remote-a', 'remote-b']);
    expect(mocks.tasks.get('deck-task-a')).toMatchObject({
      status: TaskStatus.COMPLETED,
      result: { url: 'https://cdn.example.com/remote-a.mp4' },
    });
    expect(mocks.tasks.get('deck-task-b')).toMatchObject({
      status: TaskStatus.COMPLETED,
      result: { url: 'https://cdn.example.com/remote-b.mp4' },
    });
  });

  it('resumes a topic task from preparing without creating a second root', async () => {
    installTask(
      createTask('topic-preparing', {
        source: 'topic',
        stage: 'preparing',
        remoteId: undefined,
        slides: [],
        requestedPageCount: 5,
      })
    );
    mocks.freezeCurrentPptSource.mockResolvedValue({
      slides: [
        {
          pageIndex: 1,
          frameId: 'frame-1',
          snapshotUrl: '/slide-1.png',
          snapshotMimeType: 'image/png',
          turns: [],
        },
      ],
      deckFingerprint: 'topic-fingerprint',
      frameIds: ['frame-1'],
    });
    mocks.submitJob.mockResolvedValue({
      status: 'completed',
      remoteId: 'remote-topic',
      finalVideoUrl: 'https://cdn.example.com/topic.mp4',
    });

    await runPptExplainerTask('topic-preparing');

    expect(mocks.generatePPT).toHaveBeenCalledWith(
      expect.objectContaining({ topic: '季度复盘', pageCount: 5 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mocks.prepareMissingPptSlideImages).toHaveBeenCalledTimes(1);
    expect(mocks.freezeCurrentPptSource).toHaveBeenCalledTimes(1);
    expect(mocks.prepareMissingPptSlideImages).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ selection: { frameIds: ['frame-1'] } })
    );
    expect(mocks.freezeCurrentPptSource).toHaveBeenCalledWith(
      expect.anything(),
      'job-topic-preparing',
      expect.objectContaining({ selection: { frameIds: ['frame-1'] } })
    );
    expect(mocks.submitJob).toHaveBeenCalledTimes(1);
    expect(mocks.tasks.get('topic-preparing')).toMatchObject({
      id: 'topic-preparing',
      status: TaskStatus.COMPLETED,
      params: {
        pptExplainer: {
          deckFingerprint: 'topic-fingerprint',
          stage: 'completed',
        },
      },
    });
  });

  it('resumes a partial PPTX checkpoint and cleans its cache after completion', async () => {
    const partial = createPptxCheckpoint();
    const completed = createPptxCheckpoint({
      status: 'completed',
      slides: [
        ...partial.slides,
        {
          pageIndex: 2,
          cacheUrl: '/__aitu_cache__/pptx-import/slide-2.svg',
          notes: '第二页备注',
          diagnostics: [],
        },
      ],
    });
    installTask(
      createTask('pptx-checkpoint', {
        source: 'pptx',
        stage: 'preparing',
        remoteId: undefined,
        pptxImport: partial,
        pptx: {
          filename: partial.source.fileName,
          mimeType: partial.source.mimeType,
          cacheUrl: partial.source.cacheUrl,
          fingerprint: partial.source.fingerprint,
        },
        slides: [
          {
            pageIndex: 1,
            snapshotUrl: partial.slides[0].cacheUrl,
            snapshotMimeType: 'image/svg+xml',
            turns: [],
          },
        ],
      })
    );
    mocks.resumePptxImport.mockResolvedValue(completed);
    mocks.applyPptxCheckpoint.mockImplementation((state, checkpoint) => ({
      ...state,
      pptxImport: checkpoint,
      deckFingerprint: checkpoint.source.fingerprint,
      slides: checkpoint.slides.map((slide) => ({
        pageIndex: slide.pageIndex,
        snapshotUrl: slide.cacheUrl,
        snapshotMimeType: 'image/svg+xml',
        notes: slide.notes,
        turns: [],
      })),
    }));
    mocks.submitJob.mockResolvedValue({
      status: 'completed',
      remoteId: 'remote-pptx',
      finalVideoUrl: 'https://cdn.example.com/pptx.mp4',
    });

    await runPptExplainerTask('pptx-checkpoint');

    expect(mocks.resumePptxImport).toHaveBeenCalledWith(
      partial,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mocks.applyPptxCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-pptx-checkpoint' }),
      completed
    );
    expect(mocks.submitJob).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: expect.objectContaining({
          slides: [
            expect.objectContaining({ pageIndex: 1 }),
            expect.objectContaining({ pageIndex: 2 }),
          ],
        }),
      })
    );
    expect(mocks.deletePptxImportCache).toHaveBeenCalledWith(completed);
    expect(mocks.tasks.get('pptx-checkpoint')?.status).toBe(
      TaskStatus.COMPLETED
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskType,
  type CanvasAssociationRef,
  type KnowledgeContextRef,
} from '../../types/task.types';

const createdTasks: Array<{ id: string; params: any; type: TaskType }> = [];

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    createTask: vi.fn((params: any, type: TaskType) => {
      const task = {
        id: `task-${createdTasks.length + 1}`,
        params,
        type,
      };
      createdTasks.push(task);
      return task;
    }),
  },
}));

vi.mock('../../utils/settings-manager', () => ({
  geminiSettings: {
    get: vi.fn(() => ({})),
  },
  providerPricingCacheSettings: {
    get: vi.fn(() => []),
    update: vi.fn(),
  },
  createModelRef: (profileId: string, modelId: string) => ({
    profileId,
    modelId,
  }),
}));

vi.mock('../../utils/gemini-api', () => ({
  defaultGeminiClient: {
    sendChat: vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              segments: [
                {
                  duration: 8,
                  index: 1,
                  prompt: 'A continuous cinematic scene',
                },
              ],
            }),
          },
        },
      ],
    })),
  },
}));

vi.mock('../../services/model-adapters', () => ({
  getAdapterContextFromSettings: vi.fn(() => ({})),
  resolveAdapterForInvocation: vi.fn(() => null),
  GPT_IMAGE_EDIT_REQUEST_SCHEMAS: undefined,
  isGPTImageEditRequestSchema: vi.fn(() => false),
}));

vi.mock('../../services/audio-api-service', () => ({
  audioAPIService: {},
  extractAudioGenerationResult: vi.fn(),
}));

vi.mock('../../services/video-analysis-service', () => ({
  DEFAULT_ANALYSIS_PROMPT: '默认视频分析',
  executeVideoAnalysis: vi.fn(),
}));

describe('generation queue context passthrough', () => {
  const refs: KnowledgeContextRef[] = [
    {
      noteId: 'note-1',
      title: '品牌设定',
      updatedAt: 123,
    },
  ];
  const canvasAssociations: CanvasAssociationRef[] = [
    {
      referenceId: 'ref-image-1',
      boardId: 'board-1',
      elementId: 'image-1',
      kind: 'image',
      label: '产品主图',
    },
  ];

  beforeEach(() => {
    createdTasks.length = 0;
  });

  it('keeps lightweight refs on image queue tasks', async () => {
    const { createImageTask } = await import('./image-generation');

    await createImageTask({
      prompt: '生成品牌海报',
      knowledgeContextRefs: refs,
      canvasAssociations,
    });

    expect(createdTasks[0]).toMatchObject({
      type: TaskType.IMAGE,
      params: {
        prompt: '生成品牌海报',
        knowledgeContextRefs: refs,
        canvasAssociations,
      },
    });
  });

  it('keeps lightweight refs on video queue tasks', async () => {
    const { createVideoTask } = await import('./video-generation');

    await createVideoTask({
      prompt: '生成品牌短片',
      model: 'veo3',
      knowledgeContextRefs: refs,
      canvasAssociations,
    });

    expect(createdTasks[0]).toMatchObject({
      type: TaskType.VIDEO,
      params: {
        prompt: '生成品牌短片',
        knowledgeContextRefs: refs,
        canvasAssociations,
      },
    });
  });

  it('keeps taskbar follow control metadata on video queue tasks', async () => {
    const { createVideoTask } = await import('./video-generation');

    await createVideoTask({
      prompt: '生成新视频',
      model: 'veo3',
      replaceElementId: 'video-target',
      sourcePrompt: '原视频',
      boundTargetFollowControlled: true,
    });

    expect(createdTasks[0]).toMatchObject({
      type: TaskType.VIDEO,
      params: {
        replaceElementId: 'video-target',
        boundTargetFollowControlled: true,
      },
    });
  });

  it('snapshots canvas refs into long-video chain metadata', async () => {
    const { createLongVideoTask } = await import('./long-video-generation');
    const submittedAssociations = canvasAssociations.map((association) => ({
      ...association,
    }));

    await createLongVideoTask({
      prompt: '生成连续的品牌长片',
      totalDuration: 8,
      segmentDuration: 8,
      canvasAssociations: submittedAssociations,
    });
    submittedAssociations[0].label = '提交后修改';

    expect(createdTasks[0]).toMatchObject({
      type: TaskType.VIDEO,
      params: {
        longVideoMeta: {
          canvasAssociations,
        },
      },
    });
  });

  it('keeps lightweight refs on audio queue tasks', async () => {
    const { generateAudio } = await import('./audio-generation');

    await generateAudio(
      {
        prompt: '生成品牌音乐',
        knowledgeContextRefs: refs,
        canvasAssociations,
      },
      { mode: 'queue' }
    );

    expect(createdTasks[0]).toMatchObject({
      type: TaskType.AUDIO,
      params: {
        prompt: '生成品牌音乐',
        knowledgeContextRefs: refs,
        canvasAssociations,
      },
    });
  });

  it('keeps lightweight canvas refs on text queue tasks', async () => {
    const { generateText } = await import('./text-generation');

    await generateText(
      {
        prompt: '生成品牌文案',
        knowledgeContextRefs: refs,
        canvasAssociations,
      },
      { mode: 'queue' }
    );

    expect(createdTasks[0]).toMatchObject({
      type: TaskType.CHAT,
      params: {
        prompt: '生成品牌文案',
        knowledgeContextRefs: refs,
        canvasAssociations,
      },
    });
  });

  it('keeps taskbar follow control metadata on text queue tasks', async () => {
    const { generateText } = await import('./text-generation');

    await generateText(
      {
        prompt: '生成新文案',
        replaceElementId: 'text-target',
        sourcePrompt: '原文案',
        boundTargetFollowControlled: true,
      },
      { mode: 'queue' }
    );

    expect(createdTasks[0]).toMatchObject({
      type: TaskType.CHAT,
      params: {
        replaceElementId: 'text-target',
        boundTargetFollowControlled: true,
      },
    });
  });

  it('keeps refs on video prompt-start tasks without requiring a video file', async () => {
    const { videoAnalyzeTool } = await import('./video-analyze');

    await videoAnalyzeTool.execute(
      {
        prompt: '为新品生成爆款视频提示词',
        videoAnalyzerAction: 'prompt-generate',
        videoAnalyzerProductInfo: {
          prompt: '为新品生成爆款视频提示词',
          videoStyle: '电影感光影',
          videoModel: 'happy-horse-1.0-r2v',
          segmentDuration: 5,
        },
        knowledgeContextRefs: refs,
      },
      { mode: 'queue' }
    );

    expect(createdTasks[0]).toMatchObject({
      type: TaskType.CHAT,
      params: {
        videoAnalyzerAction: 'prompt-generate',
        videoAnalyzerPrompt: '为新品生成爆款视频提示词',
        videoAnalyzerProductInfo: {
          prompt: '为新品生成爆款视频提示词',
          videoStyle: '电影感光影',
          videoModel: 'happy-horse-1.0-r2v',
          segmentDuration: 5,
        },
        knowledgeContextRefs: refs,
      },
    });
  });
});

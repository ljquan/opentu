import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskType } from '../../types/task.types';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  sendChat: vi.fn(),
}));

vi.mock('../task-queue', () => ({
  taskQueueService: {
    createTask: mocks.createTask,
  },
}));

vi.mock('../../utils/settings-manager', () => ({
  geminiSettings: {
    get: vi.fn(() => ({ textModelName: 'text-model' })),
  },
}));

vi.mock('../../utils/gemini-api', () => ({
  defaultGeminiClient: {
    sendChat: mocks.sendChat,
  },
}));

describe('service-worker long video generation', () => {
  beforeEach(() => {
    mocks.createTask.mockReset();
    mocks.sendChat.mockReset();
    mocks.createTask.mockImplementation((params, type) => ({
      id: 'long-video-segment-1',
      params,
      type,
    }));
    mocks.sendChat.mockResolvedValue({
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
    });
  });

  it('keeps the workflow target in chain metadata without routing an intermediate segment', async () => {
    const { createLongVideoTask } = await import('./long-video');
    const workflowGenerationTarget = {
      documentId: 'workflow-document-1',
      frameId: 'workflow-frame-1',
      inputReferences: [],
    };

    await createLongVideoTask({
      prompt: '生成连续的工作流长片',
      totalDuration: 8,
      segmentDuration: 8,
      workflowGenerationTarget,
    });

    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        longVideoMeta: expect.objectContaining({
          workflowGenerationTarget,
        }),
      }),
      TaskType.VIDEO
    );
    expect(mocks.createTask.mock.calls[0][0].workflowGenerationTarget).toBe(
      undefined
    );
  });
});

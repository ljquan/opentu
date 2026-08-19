import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pptExplainerVideoTool } from '../ppt-explainer-video';

const mocks = vi.hoisted(() => ({
  createPptExplainerTask: vi.fn(),
  readPptExplainerState: vi.fn(),
}));

vi.mock('../../../services/ppt-explainer/creation-service', () => ({
  createPptExplainerTask: mocks.createPptExplainerTask,
}));

vi.mock('../../../services/ppt-explainer/validation', () => ({
  readPptExplainerState: mocks.readPptExplainerState,
}));

describe('ppt-explainer-video MCP tool', () => {
  beforeEach(() => {
    mocks.createPptExplainerTask.mockReset();
    mocks.readPptExplainerState.mockReset();
  });

  it('returns the task id and persisted stage without serializing local input', async () => {
    const pptxFile = new File(['pptx'], 'deck.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const params = {
      source: 'pptx',
      sourceBoardId: 'board-1',
      reviewMode: 'confirm',
      presenterMode: 'single_voice',
      speakers: [{ id: 'speaker-1', displayName: '讲解者' }],
      textModel: 'text-model',
      videoModel: 'video-model',
      videoModelRef: { profileId: 'provider-1', modelId: 'video-model' },
      pptxFile,
    };
    const task = { id: 'ppt-task-1', params: {} };
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    mocks.createPptExplainerTask.mockResolvedValue(task);
    mocks.readPptExplainerState.mockReturnValue({ stage: 'review_pending' });

    await expect(pptExplainerVideoTool.execute(params)).resolves.toEqual({
      success: true,
      type: 'video',
      taskId: 'ppt-task-1',
      data: {
        taskId: 'ppt-task-1',
        stage: 'review_pending',
      },
    });
    expect(mocks.createPptExplainerTask).toHaveBeenCalledWith(params);
    expect(mocks.createPptExplainerTask.mock.calls[0]?.[0].pptxFile).toBe(
      pptxFile
    );
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it('does not expose unavailable provider, voice, or avatar fields', () => {
    const schema = JSON.stringify(pptExplainerVideoTool.inputSchema);

    expect(schema).not.toContain('providerBindingId');
    expect(schema).not.toContain('executionMode');
    expect(schema).not.toContain('voiceId');
    expect(schema).not.toContain('referenceAudio');
    expect(schema).not.toContain('avatar');
    expect(schema).not.toContain('single_avatar');
    expect(schema).not.toContain('dual_avatar');
  });

  it('returns a bounded credential-redacted creation error', async () => {
    mocks.createPptExplainerTask.mockRejectedValue(
      new Error(
        `Authorization: Bearer provider-secret apiKey=another-secret ${'x'.repeat(
          2200
        )}`
      )
    );

    const result = await pptExplainerVideoTool.execute({});

    expect(result).toMatchObject({ success: false, type: 'error' });
    expect(result.error).toContain('Authorization: [redacted]');
    expect(result.error).toContain('apiKey=[redacted]');
    expect(result.error).not.toContain('provider-secret');
    expect(result.error).not.toContain('another-secret');
    expect(result.error?.length).toBeLessThanOrEqual(2000);
  });

  it('uses a safe fallback for non-Error failures', async () => {
    mocks.createPptExplainerTask.mockRejectedValue({ reason: 'raw payload' });

    await expect(pptExplainerVideoTool.execute({})).resolves.toEqual({
      success: false,
      type: 'error',
      error: 'PPT 讲解视频任务创建失败',
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskStatus, TaskType, type Task } from '../types/task.types';
import { taskQueueService } from './task-queue';
import {
  createMiniMaxH3RegenerationTask,
  getMiniMaxH3RegenerationEligibility,
} from './minimax-h3-regeneration-service';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'local-task-1',
    type: TaskType.VIDEO,
    status: TaskStatus.COMPLETED,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    remoteId: 'source-task-1',
    params: {
      prompt: '测试视频',
      model: 'MiniMax-H3',
      size: '768P',
    },
    ...overrides,
  } as Task;
}

describe('getMiniMaxH3RegenerationEligibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enables completed MiniMax-H3 768P tasks with a remote ID', () => {
    expect(getMiniMaxH3RegenerationEligibility(createTask())).toEqual({
      supported: true,
      enabled: true,
      reason: '升至 2K',
    });
  });

  it('treats legacy H3 dimension sizes as 768P', () => {
    for (const size of ['1280x720', '720x1280']) {
      expect(
        getMiniMaxH3RegenerationEligibility(
          createTask({ params: { prompt: '测试', model: 'MiniMax-H3', size } })
        )
      ).toMatchObject({ supported: true, enabled: true });
    }
  });

  it('disables 2K, invalid-resolution, unfinished, and missing-ID tasks', () => {
    expect(
      getMiniMaxH3RegenerationEligibility(
        createTask({
          params: { prompt: '测试', model: 'MiniMax-H3', size: '2K' },
        })
      ).reason
    ).toContain('已经是 2K');
    expect(
      getMiniMaxH3RegenerationEligibility(
        createTask({
          params: { prompt: '测试', model: 'MiniMax-H3', size: '720P' },
        })
      ).reason
    ).toContain('仅支持将 768P');
    expect(
      getMiniMaxH3RegenerationEligibility(
        createTask({ status: TaskStatus.PROCESSING })
      ).reason
    ).toContain('生成完成后');
    expect(
      getMiniMaxH3RegenerationEligibility(createTask({ remoteId: '  ' })).reason
    ).toContain('缺少有效的源任务 ID');
  });

  it('does not expose regeneration for other video models', () => {
    expect(
      getMiniMaxH3RegenerationEligibility(
        createTask({ params: { prompt: '测试', model: 'veo3', size: '768P' } })
      )
    ).toEqual({ supported: false, enabled: false, reason: '' });
  });

  it.each(['source-provider', 'tuzi-managed-default', 'tuzi-managed-future'])(
    'preserves source provider %s without a group restriction',
    (profileId) => {
      const sourceTask = createTask({
        params: {
          prompt: '测试视频',
          model: 'MiniMax-H3',
          size: '768P',
          inputReferences: [{ slot: 0, url: 'expired-reference.png' }],
        },
        invocationRoute: {
          operation: 'video',
          modelRef: {
            profileId,
            modelId: 'MiniMax-H3',
          },
          providerProfileId: profileId,
          modelId: 'MiniMax-H3',
        },
      });
      const createTaskSpy = vi
        .spyOn(taskQueueService, 'createTask')
        .mockImplementation(
          (params, type) => ({ ...sourceTask, params, type } as Task)
        );

      createMiniMaxH3RegenerationTask(sourceTask);

      expect(createTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'MiniMax-H3',
          modelRef: {
            profileId,
            modelId: 'MiniMax-H3',
          },
          size: '2K',
          sourceLocalTaskId: 'local-task-1',
          inputReferences: [{ slot: 0, url: 'expired-reference.png' }],
          params: expect.objectContaining({
            minimax_h3_task_type: 'regeneration',
            source_task_id: 'source-task-1',
            source_resolution: '768P',
          }),
        }),
        TaskType.VIDEO
      );
    }
  );
});

import { TaskStatus, TaskType, type Task } from '../types/task.types';
import { taskQueueService } from './task-queue';
import { resolveTaskInvocationRouteModel } from './task-invocation-route';
import {
  MINIMAX_H3_PROMPT_ENHANCEMENT_PARAM_ID,
  MINIMAX_H3_SOURCE_RESOLUTION_PARAM_ID,
  MINIMAX_H3_SOURCE_TASK_ID_PARAM_ID,
  MINIMAX_H3_TASK_TYPE_PARAM_ID,
  normalizeMiniMaxH3SourceResolution,
} from './minimax-h3-video-workflow';
import { isMiniMaxH3Model } from './video-binding-utils';

export interface MiniMaxH3RegenerationEligibility {
  supported: boolean;
  enabled: boolean;
  reason: string;
}

function getTaskResolution(task: Task): string {
  return normalizeMiniMaxH3SourceResolution(task.params.size);
}

export function getMiniMaxH3RegenerationEligibility(
  task: Task
): MiniMaxH3RegenerationEligibility {
  if (task.type !== TaskType.VIDEO || !isMiniMaxH3Model(task.params.model)) {
    return { supported: false, enabled: false, reason: '' };
  }

  if (task.status !== TaskStatus.COMPLETED) {
    return {
      supported: true,
      enabled: false,
      reason: '视频生成完成后才能升至 2K',
    };
  }

  const resolution = getTaskResolution(task);
  if (resolution === '2K') {
    return {
      supported: true,
      enabled: false,
      reason: '源视频已经是 2K，不能再次升级',
    };
  }
  if (resolution !== '768P') {
    return {
      supported: true,
      enabled: false,
      reason: '仅支持将 768P 的 MiniMax-H3 视频升级为 2K',
    };
  }

  if (!task.remoteId?.trim()) {
    return {
      supported: true,
      enabled: false,
      reason: '缺少有效的源任务 ID，无法升至 2K',
    };
  }

  return { supported: true, enabled: true, reason: '升至 2K' };
}

export function createMiniMaxH3RegenerationTask(sourceTask: Task): Task {
  const eligibility = getMiniMaxH3RegenerationEligibility(sourceTask);
  if (!eligibility.enabled) {
    throw new Error(eligibility.reason || '当前任务不支持升至 2K');
  }

  const sourceParams =
    sourceTask.params.params && typeof sourceTask.params.params === 'object'
      ? (sourceTask.params.params as Record<string, unknown>)
      : {};
  const sourceRouteModel = resolveTaskInvocationRouteModel(sourceTask);
  const sourceModelRef =
    typeof sourceRouteModel === 'string' ? null : sourceRouteModel;
  const sourceTaskId = sourceTask.remoteId?.trim();
  if (!sourceTaskId) {
    throw new Error('缺少有效的源任务 ID，无法升至 2K');
  }

  return taskQueueService.createTask(
    {
      ...sourceTask.params,
      prompt: sourceTask.params.prompt,
      model: 'MiniMax-H3',
      modelRef: sourceModelRef,
      size: '2K',
      params: {
        ...sourceParams,
        [MINIMAX_H3_PROMPT_ENHANCEMENT_PARAM_ID]: 'false',
        [MINIMAX_H3_TASK_TYPE_PARAM_ID]: 'regeneration',
        [MINIMAX_H3_SOURCE_TASK_ID_PARAM_ID]: sourceTaskId,
        [MINIMAX_H3_SOURCE_RESOLUTION_PARAM_ID]: '768P',
      },
      sourceLocalTaskId: sourceTask.id,
    },
    TaskType.VIDEO
  );
}

import { describe, expect, it } from 'vitest';
import { getWorkflowFailureDetails } from '../workflow-error-details';
import { applyTaskUpdateToWorkflowMessage } from '../workflow-task-sync';
import {
  createGenerationApiError,
  toGenerationTaskError,
} from '../generation-error-details';
import type { WorkflowMessageData } from '../../types/chat.types';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';

const workflow: WorkflowMessageData = {
  id: 'wf',
  name: 'Agent',
  generationType: 'agent',
  prompt: '',
  count: 1,
  steps: [
    {
      id: 'plan',
      description: '分析',
      mcp: 'ai_analyze',
      status: 'completed',
      args: { model: 'planner' },
      result: { taskId: 'plan-task' },
    },
    {
      id: 'video',
      description: '生成视频',
      mcp: 'generate_video',
      status: 'failed',
      args: { model: 'video-model' },
      result: { taskId: 'video-task' },
      error: 'Rejected (request id: provider-id)',
    },
  ],
};

describe('workflow provider diagnostics', () => {
  it('persists the correct failed call through workflow serialization', () => {
    const error = createGenerationApiError(
      {
        error: {
          message: 'Rejected (request id: provider-id)',
          code: 'model_not_found',
        },
      },
      new Response(null, {
        status: 404,
        headers: { 'x-request-id': 'gateway-id' },
      }),
      'Failed',
      { modelId: 'actual-video-model', remoteId: 'remote-video' }
    );
    const task = {
      id: 'video-task',
      type: TaskType.VIDEO,
      status: TaskStatus.FAILED,
      params: { model: 'video-model', workflowId: 'wf' },
      apiRequestId: 'site-submit-id',
      error: toGenerationTaskError(error, 'API_ERROR'),
    } as Task;
    const synced = applyTaskUpdateToWorkflowMessage(workflow, task)!;
    const restored = JSON.parse(JSON.stringify(synced));
    const details = getWorkflowFailureDetails(restored, []);
    expect(details).toEqual({
      requestId: 'site-submit-id',
      error: '[HTTP 404 · model_not_found] Rejected',
      modelId: 'actual-video-model',
      remoteId: 'remote-video',
    });
    expect(restored.steps[1].error).toContain('(request id: provider-id)');
  });

  it('does not borrow planner IDs or expose local IDs as provider task IDs', () => {
    const planner = {
      id: 'plan-task',
      type: TaskType.CHAT,
      status: TaskStatus.FAILED,
      params: { model: 'planner', workflowId: 'wf' },
      remoteId: 'wrong-remote',
      error: {
        code: 'ERROR',
        message: 'Other failure',
        details: { requestId: 'wrong-request' },
      },
    } as Task;
    expect(getWorkflowFailureDetails(workflow, [planner])).toEqual({
      requestId: undefined,
      error: 'Rejected',
      modelId: 'video-model',
      remoteId: undefined,
    });
  });

  it('uses stored actual model metadata for agent analysis without a task record', () => {
    const copy = {
      ...workflow,
      steps: [
        {
          ...workflow.steps[0],
          status: 'failed' as const,
          error: 'Failed to fetch',
          errorDetails: {
            code: 'NETWORK',
            message: 'Failed to fetch',
            details: { modelId: 'resolved-planner' },
          },
        },
      ],
    };
    expect(getWorkflowFailureDetails(copy, [])).toEqual({
      requestId: undefined,
      remoteId: undefined,
      error: 'Failed to fetch',
      modelId: 'resolved-planner',
    });
  });
});

it('does not display upstream or poll IDs from legacy video records', () => {
  const copy = JSON.parse(JSON.stringify(workflow));
  copy.steps[1].errorDetails = {
    code: 'task_failed',
    message: 'Rejected (request id: upstream-id)',
    details: {
      requestId: 'poll-id',
      modelId: 'actual-video',
      remoteId: 'remote-task',
    },
  };
  expect(getWorkflowFailureDetails(copy, [])).toEqual({
    requestId: undefined,
    error: 'Rejected',
    modelId: 'actual-video',
    remoteId: 'remote-task',
  });
});

it('does not borrow an older step submission ID when the current failed task has none', () => {
  const copy = JSON.parse(JSON.stringify(workflow));
  copy.steps[1].errorDetails = {
    message: 'Old failure',
    details: { apiRequestId: 'old-site-id' },
  };
  const task = {
    id: 'video-task',
    type: TaskType.VIDEO,
    status: TaskStatus.FAILED,
    params: { model: 'video-model', workflowId: 'wf' },
    error: {
      code: 'task_failed',
      message: 'New failure (request id: upstream-id)',
    },
  } as Task;
  expect(getWorkflowFailureDetails(copy, [task]).requestId).toBeUndefined();
});

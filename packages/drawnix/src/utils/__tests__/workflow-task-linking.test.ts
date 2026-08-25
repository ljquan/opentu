import { describe, expect, it } from 'vitest';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import {
  extractTaskIdFromStepResult,
  findTaskForWorkflowStep,
  findWorkflowStepForTask,
  isWorkflowStepTaskCompleted,
} from '../workflow-task-linking';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    params: {
      prompt: '生成图片',
      workflowId: 'wf-1',
      batchId: 'wf_batch_wf-1',
      batchIndex: 1,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('workflow-task-linking', () => {
  it('extracts task ids from direct and nested step results', () => {
    expect(extractTaskIdFromStepResult({ taskId: 'task-direct' })).toBe(
      'task-direct'
    );
    expect(extractTaskIdFromStepResult({ data: { taskId: 'task-data' } })).toBe(
      'task-data'
    );
    expect(
      extractTaskIdFromStepResult({ result: { taskId: 'task-result' } })
    ).toBe('task-result');
    expect(extractTaskIdFromStepResult({ taskIds: ['task-list'] })).toBe(
      'task-list'
    );
  });

  it('matches an image task to its workflow step before taskId is written', () => {
    const task = createTask();
    const workflow = {
      id: 'wf-1',
      generationType: 'image',
      steps: [
        {
          id: 'step-1',
          mcp: 'generate_image',
          args: {},
          status: 'running' as const,
          options: {
            batchId: 'wf_batch_wf-1',
            batchIndex: 1,
          },
        },
      ],
    };

    expect(findWorkflowStepForTask(workflow, task)?.id).toBe('step-1');
  });

  it('does not match a task from another workflow', () => {
    const task = createTask({
      params: {
        prompt: '生成图片',
        workflowId: 'wf-other',
        batchId: 'wf_batch_wf-other',
        batchIndex: 1,
      },
    });
    const workflow = {
      id: 'wf-1',
      generationType: 'image',
      steps: [
        {
          id: 'step-1',
          mcp: 'generate_image',
          args: {},
          status: 'running' as const,
          options: {
            batchId: 'wf_batch_wf-1',
            batchIndex: 1,
          },
        },
      ],
    };

    expect(findWorkflowStepForTask(workflow, task)).toBeUndefined();
  });

  it('finds the completed task for a workflow step before taskId is written', () => {
    const task = createTask();
    const workflow = {
      id: 'wf-1',
      generationType: 'image',
      steps: [
        {
          id: 'step-1',
          mcp: 'generate_image',
          args: {},
          status: 'running' as const,
          options: {
            batchId: 'wf_batch_wf-1',
            batchIndex: 1,
          },
        },
      ],
    };

    const [step] = workflow.steps;

    expect(findTaskForWorkflowStep(workflow, step, [task])?.id).toBe('task-1');
    expect(isWorkflowStepTaskCompleted(workflow, step, [task])).toBe(true);
  });

  it('matches a PPT explainer VIDEO task to its workflow step', () => {
    const task = createTask({ type: TaskType.VIDEO });
    const workflow = {
      id: 'wf-1',
      generationType: 'video',
      steps: [
        {
          id: 'step-ppt-video',
          mcp: 'generate_ppt_explainer_video',
          args: {},
          status: 'running' as const,
          options: {
            batchId: 'wf_batch_wf-1',
            batchIndex: 1,
          },
        },
      ],
    };

    expect(findWorkflowStepForTask(workflow, task)?.id).toBe('step-ppt-video');
    expect(
      findTaskForWorkflowStep(workflow, workflow.steps[0], [task])?.id
    ).toBe('task-1');
  });
});

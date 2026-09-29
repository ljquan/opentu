import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStatus, TaskType } from '../../../../types/task.types';
import { createQueueTask, type QueueTaskConfig } from '../queue-utils';

const { createTaskMock, retryTaskMock, getTaskMock } = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  retryTaskMock: vi.fn(),
  getTaskMock: vi.fn(),
}));

vi.mock('../../../../services/task-queue', () => ({
  taskQueueService: {
    createTask: createTaskMock,
    retryTask: retryTaskMock,
    getTask: getTaskMock,
  },
}));

function createConfig(): QueueTaskConfig {
  return {
    taskType: TaskType.IMAGE,
    resultType: 'image',
    getDefaultModel: () => 'test-model',
    buildTaskPayload: () => ({
      prompt: 'test prompt',
      size: '1x1',
      model: 'test-model',
    }),
  };
}

describe('queue-utils', () => {
  beforeEach(() => {
    createTaskMock.mockReset();
    retryTaskMock.mockReset();
    getTaskMock.mockReset();
    createTaskMock.mockImplementation((params, type) => ({
      id: `task-${createTaskMock.mock.calls.length}`,
      type,
      status: TaskStatus.PROCESSING,
      params,
      createdAt: 1,
      updatedAt: 1,
      insertedToCanvas: false,
    }));
  });

  it('preserves workflowId for workflow-batch tasks', () => {
    createQueueTask(
      {
        prompt: 'test prompt',
        workflowId: 'wf-1',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
      },
      {},
      createConfig()
    );

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
      }),
      TaskType.IMAGE
    );
  });

  it('preserves workflowId for direct-count tasks', () => {
    createQueueTask(
      {
        prompt: 'test prompt',
        workflowId: 'wf-2',
        count: 2,
      },
      {},
      createConfig()
    );

    expect(createTaskMock).toHaveBeenCalledTimes(2);
    createTaskMock.mock.calls.forEach(([params], index) => {
      expect(params).toMatchObject({
        workflowId: 'wf-2',
        batchIndex: index + 1,
        batchTotal: 2,
      });
    });
  });

  it.each([
    {
      name: 'workflow-batch',
      params: {
        prompt: 'test prompt',
        batchId: 'workflow-batch-1',
        batchIndex: 1,
        batchTotal: 1,
      },
      expectedTaskCount: 1,
    },
    {
      name: 'direct-count',
      params: {
        prompt: 'test prompt',
        count: 2,
      },
      expectedTaskCount: 2,
    },
  ])(
    'preserves workflow generation targets for $name tasks',
    ({ params, expectedTaskCount }) => {
      const workflowGenerationTarget = {
        documentId: 'workflow-document-1',
        frameId: 'workflow-frame-1',
        region: { x: 10, y: 20, width: 300, height: 200 },
        inputReferences: [],
      };

      createQueueTask(
        { ...params, workflowGenerationTarget },
        {},
        createConfig()
      );

      expect(createTaskMock).toHaveBeenCalledTimes(expectedTaskCount);
      createTaskMock.mock.calls.forEach(([taskParams]) => {
        expect(taskParams.workflowGenerationTarget).toEqual(
          workflowGenerationTarget
        );
      });
    }
  );
});

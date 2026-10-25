/**
 * Workflow Engine Tests
 * 主线程工作流引擎测试
 *
 * 测试场景：
 * 1. 工作流类型定义
 * 2. 工作流引擎基本功能
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Workflow,
  WorkflowStep,
  WorkflowEvent,
  WorkflowStatus,
  WorkflowStepStatus,
} from '../workflow-engine/types';

describe('WorkflowEngine Module', () => {
  describe('Workflow Types', () => {
    it('should define correct WorkflowStep structure', () => {
      const step: WorkflowStep = {
        id: 'step-1',
        mcp: 'generate_image',
        args: { prompt: 'A cat' },
        description: 'Generate a cat image',
        status: 'pending',
      };

      expect(step.id).toBe('step-1');
      expect(step.mcp).toBe('generate_image');
      expect(step.status).toBe('pending');
    });

    it('should support all step statuses', () => {
      const statuses: WorkflowStepStatus[] = [
        'pending',
        'running',
        'completed',
        'failed',
        'skipped',
      ];

      statuses.forEach((status) => {
        const step: WorkflowStep = {
          id: 'step-1',
          mcp: 'test',
          args: {},
          description: 'Test',
          status,
        };
        expect(step.status).toBe(status);
      });
    });

    it('should define correct Workflow structure', () => {
      const workflow: Workflow = {
        id: 'workflow-1',
        name: 'Test Workflow',
        steps: [
          {
            id: 'step-1',
            mcp: 'generate_image',
            args: { prompt: 'Test' },
            description: 'Test step',
            status: 'pending',
          },
        ],
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(workflow.id).toBe('workflow-1');
      expect(workflow.steps).toHaveLength(1);
      expect(workflow.status).toBe('pending');
    });

    it('should support all workflow statuses', () => {
      const statuses: WorkflowStatus[] = [
        'pending',
        'running',
        'completed',
        'failed',
        'cancelled',
      ];

      statuses.forEach((status) => {
        const workflow: Workflow = {
          id: 'workflow-1',
          name: 'Test',
          steps: [],
          status,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        expect(workflow.status).toBe(status);
      });
    });

    it('should support optional workflow fields', () => {
      const workflow: Workflow = {
        id: 'workflow-1',
        name: 'Test',
        steps: [],
        status: 'completed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: Date.now(),
        error: 'Some error',
        context: { key: 'value' },
      };

      expect(workflow.completedAt).toBeDefined();
      expect(workflow.error).toBe('Some error');
      expect(workflow.context).toEqual({ key: 'value' });
    });
  });

  describe('WorkflowEvent Types', () => {
    it('should define status event', () => {
      const event: WorkflowEvent = {
        type: 'status',
        workflowId: 'workflow-1',
        status: 'running',
      };

      expect(event.type).toBe('status');
      expect(event.workflowId).toBe('workflow-1');
    });

    it('should define step event', () => {
      const event: WorkflowEvent = {
        type: 'step',
        workflowId: 'workflow-1',
        stepId: 'step-1',
        status: 'completed',
        result: { taskId: 'task-1' },
      };

      expect(event.type).toBe('step');
      expect(event.stepId).toBe('step-1');
    });

    it('should define completed event', () => {
      const workflow: Workflow = {
        id: 'workflow-1',
        name: 'Test',
        steps: [],
        status: 'completed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const event: WorkflowEvent = {
        type: 'completed',
        workflowId: 'workflow-1',
        workflow,
      };

      expect(event.type).toBe('completed');
      expect(event.workflow).toBeDefined();
    });

    it('should define failed event', () => {
      const event: WorkflowEvent = {
        type: 'failed',
        workflowId: 'workflow-1',
        error: 'Something went wrong',
      };

      expect(event.type).toBe('failed');
      expect(event.error).toBe('Something went wrong');
    });

    it('should define steps_added event', () => {
      const event: WorkflowEvent = {
        type: 'steps_added',
        workflowId: 'workflow-1',
        steps: [
          {
            id: 'step-2',
            mcp: 'generate_video',
            args: {},
            description: 'New step',
            status: 'pending',
          },
        ],
      };

      expect(event.type).toBe('steps_added');
      expect(event.steps).toHaveLength(1);
    });
  });

  describe('WorkflowEngine Class', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should export WorkflowEngine class', async () => {
      vi.doMock('../media-executor/factory', () => ({
        executorFactory: {
          getExecutor: async () => ({
            name: 'Mock',
            isAvailable: async () => true,
            generateImage: async () => {},
            generateVideo: async () => {},
            aiAnalyze: async () => {},
            generateText: async () => ({ content: 'test' }),
          }),
        },
      }));

      vi.doMock('../workflow-engine/workflow-storage-writer', () => ({
        workflowStorageWriter: {
          isAvailable: async () => true,
          createWorkflow: async () => {},
          updateWorkflowStatus: async () => {},
          updateStepStatus: async () => {},
          completeWorkflow: async () => {},
          failWorkflow: async () => {},
        },
      }));

      vi.doMock('../media-executor/task-polling', () => ({
        waitForTaskCompletion: async () => ({
          success: true,
          task: { id: 'test', status: 'completed' },
        }),
      }));

      const { WorkflowEngine } = await import('../workflow-engine/engine');

      expect(WorkflowEngine).toBeDefined();
      expect(typeof WorkflowEngine).toBe('function');
    });

    it('should create engine with event handler', async () => {
      vi.doMock('../media-executor/factory', () => ({
        executorFactory: {
          getExecutor: async () => ({
            name: 'Mock',
            isAvailable: async () => true,
            generateImage: async () => {},
            generateVideo: async () => {},
            aiAnalyze: async () => {},
            generateText: async () => ({ content: 'test' }),
          }),
        },
      }));

      vi.doMock('../workflow-engine/workflow-storage-writer', () => ({
        workflowStorageWriter: {
          isAvailable: async () => true,
          createWorkflow: async () => {},
          updateWorkflowStatus: async () => {},
          updateStepStatus: async () => {},
          completeWorkflow: async () => {},
          failWorkflow: async () => {},
        },
      }));

      vi.doMock('../media-executor/task-polling', () => ({
        waitForTaskCompletion: async () => ({
          success: true,
          task: { id: 'test', status: 'completed' },
        }),
      }));

      const { WorkflowEngine } = await import('../workflow-engine/engine');

      const events: WorkflowEvent[] = [];
      const engine = new WorkflowEngine({
        onEvent: (event) => events.push(event),
      });

      expect(engine).toBeDefined();
    });

    it('should have submitWorkflow method', async () => {
      vi.doMock('../media-executor/factory', () => ({
        executorFactory: {
          getExecutor: async () => ({
            name: 'Mock',
            isAvailable: async () => true,
            generateImage: async () => {},
            generateVideo: async () => {},
            aiAnalyze: async () => {},
            generateText: async () => ({ content: 'test' }),
          }),
        },
      }));

      vi.doMock('../workflow-engine/workflow-storage-writer', () => ({
        workflowStorageWriter: {
          isAvailable: async () => true,
          createWorkflow: async () => {},
          updateWorkflowStatus: async () => {},
          updateStepStatus: async () => {},
          completeWorkflow: async () => {},
          failWorkflow: async () => {},
        },
      }));

      vi.doMock('../media-executor/task-polling', () => ({
        waitForTaskCompletion: async () => ({
          success: true,
          task: { id: 'test', status: 'completed' },
        }),
      }));

      const { WorkflowEngine } = await import('../workflow-engine/engine');
      const engine = new WorkflowEngine({ onEvent: () => {} });

      expect(typeof engine.submitWorkflow).toBe('function');
    });

    it('should have getWorkflow method', async () => {
      vi.doMock('../media-executor/factory', () => ({
        executorFactory: {
          getExecutor: async () => ({
            name: 'Mock',
            isAvailable: async () => true,
            generateImage: async () => {},
            generateVideo: async () => {},
            aiAnalyze: async () => {},
            generateText: async () => ({ content: 'test' }),
          }),
        },
      }));

      vi.doMock('../workflow-engine/workflow-storage-writer', () => ({
        workflowStorageWriter: {
          isAvailable: async () => true,
          createWorkflow: async () => {},
          updateWorkflowStatus: async () => {},
          updateStepStatus: async () => {},
          completeWorkflow: async () => {},
          failWorkflow: async () => {},
        },
      }));

      vi.doMock('../media-executor/task-polling', () => ({
        waitForTaskCompletion: async () => ({
          success: true,
          task: { id: 'test', status: 'completed' },
        }),
      }));

      const { WorkflowEngine } = await import('../workflow-engine/engine');
      const engine = new WorkflowEngine({ onEvent: () => {} });

      expect(typeof engine.getWorkflow).toBe('function');
    });

    it('should return undefined for non-existent workflow', async () => {
      vi.doMock('../media-executor/factory', () => ({
        executorFactory: {
          getExecutor: async () => ({
            name: 'Mock',
            isAvailable: async () => true,
            generateImage: async () => {},
            generateVideo: async () => {},
            aiAnalyze: async () => {},
            generateText: async () => ({ content: 'test' }),
          }),
        },
      }));

      vi.doMock('../workflow-engine/workflow-storage-writer', () => ({
        workflowStorageWriter: {
          isAvailable: async () => true,
          createWorkflow: async () => {},
          updateWorkflowStatus: async () => {},
          updateStepStatus: async () => {},
          completeWorkflow: async () => {},
          failWorkflow: async () => {},
        },
      }));

      vi.doMock('../media-executor/task-polling', () => ({
        waitForTaskCompletion: async () => ({
          success: true,
          task: { id: 'test', status: 'completed' },
        }),
      }));

      const { WorkflowEngine } = await import('../workflow-engine/engine');
      const engine = new WorkflowEngine({ onEvent: () => {} });

      const result = engine.getWorkflow('non-existent-id');
      expect(result).toBeUndefined();
    });
  });
});

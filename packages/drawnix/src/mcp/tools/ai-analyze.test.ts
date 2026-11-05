import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentExecuteOptions,
  AgentExecutionContext,
  WorkflowStepInfo,
} from '../types';
import type { CanvasAssociationRef } from '../../types/task.types';
import { aiAnalyzeTool } from './ai-analyze';
import { mcpRegistry } from '../registry';
import { taskQueueService } from '../../services/task-queue';
import {
  createGenerationApiError,
  toGenerationTaskError,
} from '../../utils/generation-error-details';
import { getWorkflowFailureDetails } from '../../utils/workflow-error-details';
import {
  updateStepStatus,
  type WorkflowDefinition,
} from '../../components/ai-input-bar/workflow-converter';
import { toWorkflowMessageData } from '../../hooks/workflow-message-data';
import { wrapApiError } from './shared/queue-utils';

vi.mock('../../services/task-queue', () => ({
  taskQueueService: { trackExternalTask: vi.fn(), updateTaskStatus: vi.fn() },
}));

const agentExecuteMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/agent', () => ({
  agentExecutor: {
    execute: agentExecuteMock,
  },
}));

vi.mock('../../services/agent/media-model-routing', () => ({
  applyMediaModelDefaultsToArgs: (
    _toolName: string,
    args: Record<string, unknown>
  ) => ({ ...args }),
}));

vi.mock('../../utils/settings-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/settings-manager')>()),
  geminiSettings: {
    get: vi.fn(() => ({})),
  },
}));

vi.mock('../../constants/model-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../constants/model-config')>()),
  getDefaultAudioModel: () => 'default-audio',
  getDefaultImageModel: () => 'default-image',
  getDefaultVideoModel: () => 'default-video',
}));

function createContext(
  canvasAssociations: CanvasAssociationRef[]
): AgentExecutionContext {
  return {
    userInstruction: '基于引用生成图片',
    rawInput: '基于引用生成图片',
    model: {
      id: 'deepseek-v3.2',
      type: 'text',
      isExplicit: false,
    },
    params: { count: 1 },
    selection: {
      texts: [],
      images: [],
      videos: [],
      graphics: [],
    },
    finalPrompt: '基于引用生成图片',
    canvasAssociations,
  };
}

describe('ai_analyze canvas association passthrough', () => {
  beforeEach(() => {
    agentExecuteMock.mockReset();
  });

  it('snapshots bounded refs into dynamically generated media steps', async () => {
    const canvasAssociations = Array.from({ length: 22 }, (_, index) => ({
      referenceId: `ref-${index}`,
      boardId: 'board-1',
      elementId: `element-${index}`,
      kind: 'image' as const,
      label: `参考 ${index}`,
    }));
    let capturedContext: AgentExecutionContext | undefined;
    const addedSteps: WorkflowStepInfo[] = [];

    agentExecuteMock.mockImplementation(
      async (context: AgentExecutionContext, options: AgentExecuteOptions) => {
        capturedContext = context;
        options.onToolCall?.({
          id: 'call-1',
          name: 'generate_image',
          arguments: { prompt: '生成图片' },
        });
        return { success: true, response: 'done' };
      }
    );

    const result = await aiAnalyzeTool.execute(
      { context: createContext(canvasAssociations) },
      {
        onAddSteps: (steps) => addedSteps.push(...steps),
      }
    );
    canvasAssociations[0].label = '提交后修改';

    expect(result.success).toBe(true);
    expect(capturedContext?.canvasAssociations).toHaveLength(20);
    expect(capturedContext?.canvasAssociations?.[0].label).toBe('参考 0');
    expect(addedSteps).toHaveLength(1);
    expect(addedSteps[0].args.canvasAssociations).toEqual(
      capturedContext?.canvasAssociations
    );
    expect(addedSteps[0].args.canvasAssociations).not.toBe(
      capturedContext?.canvasAssociations
    );
  });

  it('does not attach canvas refs to non-generation tool calls', async () => {
    const canvasAssociations: CanvasAssociationRef[] = [
      {
        referenceId: 'ref-1',
        boardId: 'board-1',
        elementId: 'element-1',
        kind: 'text',
        label: '标题',
      },
    ];
    const addedSteps: WorkflowStepInfo[] = [];

    agentExecuteMock.mockImplementation(
      async (_context: AgentExecutionContext, options: AgentExecuteOptions) => {
        options.onToolCall?.({
          id: 'call-1',
          name: 'add_text',
          arguments: { text: '标题' },
        });
        return { success: true, response: 'done' };
      }
    );

    await aiAnalyzeTool.execute(
      { context: createContext(canvasAssociations) },
      {
        onAddSteps: (steps) => addedSteps.push(...steps),
      }
    );

    expect(addedSteps[0].args.canvasAssociations).toBeUndefined();
  });

  it('overwrites model-provided canvas refs with the trusted snapshot', async () => {
    const canvasAssociations: CanvasAssociationRef[] = [
      {
        referenceId: 'ref-trusted',
        boardId: 'board-1',
        elementId: 'element-trusted',
        kind: 'image',
        label: '可信图片',
      },
    ];
    const addedSteps: WorkflowStepInfo[] = [];

    agentExecuteMock.mockImplementation(
      async (_context: AgentExecutionContext, options: AgentExecuteOptions) => {
        options.onToolCall?.({
          id: 'call-1',
          name: 'generate_image',
          arguments: {
            prompt: '生成图片',
            canvasAssociations: [],
          },
        });
        return { success: true, response: 'done' };
      }
    );

    await aiAnalyzeTool.execute(
      { context: createContext(canvasAssociations) },
      {
        onAddSteps: (steps) => addedSteps.push(...steps),
      }
    );

    expect(addedSteps[0].args.canvasAssociations).toEqual(canvasAssociations);
    expect(addedSteps[0].args.canvasAssociations).not.toBe(canvasAssociations);
  });

  it('strips model-provided canvas refs when no trusted snapshot exists', async () => {
    const addedSteps: WorkflowStepInfo[] = [];

    agentExecuteMock.mockImplementation(
      async (_context: AgentExecutionContext, options: AgentExecuteOptions) => {
        options.onToolCall?.({
          id: 'call-1',
          name: 'generate_image',
          arguments: {
            prompt: '生成图片',
            canvasAssociations: [
              {
                referenceId: 'forged',
                boardId: 'board-2',
                elementId: 'forged-element',
                kind: 'image',
                label: '伪造引用',
              },
            ],
          },
        });
        return { success: true, response: 'done' };
      }
    );

    await aiAnalyzeTool.execute(
      { context: createContext([]) },
      {
        onAddSteps: (steps) => addedSteps.push(...steps),
      }
    );

    expect(addedSteps[0].args.canvasAssociations).toBeUndefined();
  });
});

describe('Agent MCP failure diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentExecuteMock.mockReset();
    mcpRegistry.register(aiAnalyzeTool);
  });

  afterEach(() => {
    mcpRegistry.unregister(aiAnalyzeTool.name);
    mcpRegistry.unregister('review_throwing_tool');
    vi.restoreAllMocks();
  });

  function providerError() {
    return createGenerationApiError(
      { error: { message: 'Access denied', code: 'permission_denied' } },
      new Response(null, {
        status: 403,
        headers: { 'x-request-id': 'header-only-id' },
      }),
      'Failed',
      { modelId: 'actual-agent-model', remoteId: 'remote-task' }
    );
  }

  function workflowWithAnalysis(): WorkflowDefinition {
    const context = createContext([]);
    return {
      id: 'agent-workflow',
      name: 'Agent',
      scenarioType: 'agent_flow',
      generationType: 'agent',
      createdAt: 1,
      steps: [
        {
          id: 'analysis',
          mcp: 'ai_analyze',
          args: { context },
          description: '分析',
          status: 'running',
        },
      ],
      metadata: {
        prompt: context.finalPrompt,
        userInstruction: context.userInstruction,
        rawInput: context.rawInput,
        modelId: context.model.id,
        isModelExplicit: false,
        count: 1,
        selection: context.selection,
      },
    };
  }

  it.each(['returned', 'thrown'])(
    'preserves %s failure from the actual MCP entry to task storage and restored card details',
    async (kind) => {
      const error = providerError();
      const errorDetails = toGenerationTaskError(error, 'AGENT_FAILED');
      if (kind === 'returned') {
        agentExecuteMock.mockResolvedValue({
          success: false,
          error: error.message,
          errorDetails,
        });
      } else {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        agentExecuteMock.mockRejectedValue(error);
      }
      const result = await mcpRegistry.executeTool({
        id: 'call-analysis',
        name: 'ai_analyze',
        arguments: { context: createContext([]) },
      });
      expect(result.success).toBe(false);
      expect(result.errorDetails?.details).toMatchObject({
        ...errorDetails.details,
        timestamp: expect.any(Number),
      });
      const task = vi.mocked(taskQueueService.trackExternalTask).mock
        .calls[0][0];
      expect(taskQueueService.updateTaskStatus).toHaveBeenCalledWith(
        task.id,
        'failed',
        {
          error: expect.objectContaining({
            code: 'AI_ANALYZE_ERROR',
            message: error.message,
            details: expect.objectContaining({
              ...errorDetails.details,
              timestamp: expect.any(Number),
            }),
          }),
        }
      );
      // The UI's step update uses the same reducer and serialized message format.
      const updated = updateStepStatus(
        workflowWithAnalysis(),
        'analysis',
        'failed',
        undefined,
        result.error,
        10,
        result.errorDetails
      );
      const restored = JSON.parse(
        JSON.stringify(toWorkflowMessageData(updated))
      );
      expect(getWorkflowFailureDetails(restored, [])).toEqual({
        requestId: 'header-only-id',
        modelId: 'actual-agent-model',
        remoteId: 'remote-task',
        error: '[HTTP 403 · permission_denied] Access denied',
      });
    }
  );

  it('keeps the selected model for legacy string failures', async () => {
    agentExecuteMock.mockResolvedValue({
      success: false,
      error: 'Failed to fetch',
    });
    const result = await aiAnalyzeTool.execute({ context: createContext([]) });
    expect(result.errorDetails?.details?.modelId).toBe('deepseek-v3.2');
    expect(result.errorDetails?.details?.requestId).toBeUndefined();
    expect(result.errorDetails?.details?.remoteId).toBeUndefined();
  });

  it('binds child-tool diagnostics to the failed child instead of the planner', async () => {
    let workflow = workflowWithAnalysis();
    const childFailure = wrapApiError(providerError(), 'Failed');
    agentExecuteMock.mockImplementation(
      async (_context, options: AgentExecuteOptions) => {
        options.onToolCall?.({
          id: 'child-call',
          name: 'generate_text',
          arguments: { model: 'requested-alias' },
        });
        options.onToolResult?.(childFailure);
        return { success: true, response: 'done' };
      }
    );
    await mcpRegistry.executeTool(
      {
        id: 'call-analysis',
        name: 'ai_analyze',
        arguments: { context: createContext([]) },
      },
      {
        onAddSteps: (steps) => {
          workflow = updateStepStatus(workflow, 'analysis', 'completed');
          workflow = { ...workflow, steps: [...workflow.steps, ...steps] };
        },
        onUpdateStep: (...args) => {
          workflow = updateStepStatus(workflow, ...args);
        },
      }
    );
    expect(workflow.steps[0].errorDetails).toBeUndefined();
    expect(workflow.steps[1].status).toBe('failed');
    expect(workflow.steps[1].errorDetails).toEqual(childFailure.errorDetails);
    const restored = JSON.parse(
      JSON.stringify(toWorkflowMessageData(workflow))
    );
    expect(getWorkflowFailureDetails(restored, [])).toMatchObject({
      requestId: 'header-only-id',
      modelId: 'actual-agent-model',
      remoteId: 'remote-task',
    });
  });

  it('retains metadata when a tool throws through the registry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mcpRegistry.register({
      ...aiAnalyzeTool,
      name: 'review_throwing_tool',
      execute: async () => {
        throw providerError();
      },
    });
    const result = await mcpRegistry.executeTool({
      id: 'throw-call',
      name: 'review_throwing_tool',
      arguments: {},
    });
    expect(result.errorDetails?.details).toMatchObject({
      requestId: 'header-only-id',
      apiErrorCode: 'permission_denied',
      modelId: 'actual-agent-model',
    });
  });
});

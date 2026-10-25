import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentExecuteOptions,
  AgentExecutionContext,
  WorkflowStepInfo,
} from '../types';
import type { CanvasAssociationRef } from '../../types/task.types';
import { aiAnalyzeTool } from './ai-analyze';

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

vi.mock('../../utils/settings-manager', () => ({
  geminiSettings: {
    get: vi.fn(() => ({})),
  },
}));

vi.mock('../../constants/model-config', () => ({
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

/**
 * AI 分析 MCP 工具
 *
 * 调用文本模型分析用户意图，返回需要执行的后续工作流步骤
 * 这使得 Agent 流程也可以统一用工作流方式处理
 *
 * 使用标准的 MCPExecuteOptions 回调：
 * - onChunk: 流式输出 AI 思考内容
 * - onAddSteps: 动态添加工作流步骤
 * - onUpdateStep: 更新步骤状态
 */

import type {
  MCPTool,
  MCPResult,
  MCPExecuteOptions,
  AgentExecutionContext,
  WorkflowStepInfo,
  AgentExecuteOptions,
} from '../types';
import { agentExecutor } from '../../services/agent';
import { geminiSettings, type ModelRef } from '../../utils/settings-manager';
import type { GeminiMessagePart } from '../../utils/gemini-api/types';
import { applyMediaModelDefaultsToArgs } from '../../services/agent/media-model-routing';
import {
  getDefaultAudioModel,
  getDefaultImageModel,
  getDefaultVideoModel,
} from '../../constants/model-config';
import type { KnowledgeContextRef } from '../../types/task.types';
import { normalizeKnowledgeContextRefs } from '../../services/generation-context-service';
import { taskQueueService } from '../../services/task-queue';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import { generateTaskId } from '../../utils/task-utils';

function getAnalysisPrompt(
  context: AgentExecutionContext,
  messages?: AIAnalyzeParams['messages']
): string {
  const directPrompt =
    context.rawInput || context.userInstruction || context.finalPrompt;
  if (directPrompt?.trim()) {
    return directPrompt.trim();
  }

  const lastUserMessage = [...(messages || [])]
    .reverse()
    .find((message) => message.role === 'user');
  return typeof lastUserMessage?.content === 'string'
    ? lastUserMessage.content.trim()
    : 'AI 文本任务';
}

function createAnalysisTask(
  context: AgentExecutionContext,
  model: string,
  modelRef: ModelRef | null,
  messages?: AIAnalyzeParams['messages']
): Task {
  const now = Date.now();
  const task: Task = {
    id: generateTaskId(),
    type: TaskType.CHAT,
    status: TaskStatus.PROCESSING,
    params: {
      prompt: getAnalysisPrompt(context, messages),
      model,
      modelRef,
      agentAnalysis: true,
    },
    createdAt: now,
    updatedAt: now,
    startedAt: now,
  };
  taskQueueService.trackExternalTask(task);
  return task;
}

const GENERATION_CONTEXT_TOOLS = new Set([
  'generate_image',
  'generate_video',
  'generate_long_video',
  'generate_audio',
  'generate_text',
]);

/**
 * AI 分析参数
 */
export interface AIAnalyzeParams {
  /** Agent 执行上下文 */
  context: AgentExecutionContext;
  /** 使用的文本模型 */
  textModel?: string;
  /** 当前显式选择的模型来源（用于继承到后续生成步骤） */
  modelRef?: ModelRef | null;
  /**
   * 预构建的消息数组（优先级高于 agentExecutor 内部生成的 messages）
   * 用于 Skill 路径 B（Agent 精准注入）和路径 C（角色扮演）
   * 传入时直接使用，不再调用 generateSystemPrompt()
   */
  messages?: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | GeminiMessagePart[];
  }>;
  /** 本次 Agent 分析使用的知识库笔记轻量引用 */
  knowledgeContextRefs?: KnowledgeContextRef[];
}

/**
 * AI 分析结果
 */
export interface AIAnalyzeResult {
  /** 分析是否成功 */
  success: boolean;
  /** 生成的后续步骤 */
  generatedSteps?: WorkflowStepInfo[];
  /** 错误信息 */
  error?: string;
  /** AI 响应文本 */
  response?: string;
}

/**
 * AI 分析 MCP 工具定义
 */
export const aiAnalyzeTool: MCPTool = {
  name: 'ai_analyze',
  description: `AI 分析工具。调用文本模型分析用户意图，决定需要执行的操作。

使用场景：
- 用户输入包含额外要求或复杂指令
- 需要 AI 理解用户意图并决定调用哪些工具
- 用户选择了文本内容作为生成素材

不适用场景：
- 简单的直接生成（使用 generate_image 或 generate_video）`,

  inputSchema: {
    type: 'object',
    properties: {
      context: {
        type: 'object',
        description: 'Agent 执行上下文，包含用户指令、选中内容等',
      },
      textModel: {
        type: 'string',
        description: '使用的文本模型 ID',
      },
      messages: {
        type: 'array',
        description:
          '预构建的消息数组，传入时直接使用，不再生成默认系统提示词（用于 Skill 角色扮演/精准工具注入）',
      },
      knowledgeContextRefs: {
        type: 'array',
        description: '本次 Agent 分析使用的知识库笔记轻量引用',
      },
    },
    required: ['context'],
  },

  supportedModes: ['async'],

  execute: async (
    params: Record<string, unknown>,
    options?: MCPExecuteOptions
  ): Promise<MCPResult> => {
    const { context, textModel, messages, modelRef, knowledgeContextRefs } =
      params as unknown as AIAnalyzeParams;

    if (!context) {
      return {
        success: false,
        error: '缺少必填参数 context',
        type: 'error',
      };
    }

    const startTime = Date.now();
    const generatedSteps: WorkflowStepInfo[] = [];
    const normalizedKnowledgeContextRefs = normalizeKnowledgeContextRefs(
      knowledgeContextRefs || context.knowledgeContextRefs
    );
    const executionContext: AgentExecutionContext = {
      ...context,
      knowledgeContextRefs:
        normalizedKnowledgeContextRefs.length > 0
          ? normalizedKnowledgeContextRefs
          : undefined,
      canvasAssociations: context.canvasAssociations
        ?.slice(0, 20)
        .map((reference) => ({ ...reference })),
    };
    const selectedModel = textModel || executionContext.model.id;
    const selectedModelRef = modelRef || null;
    const task = createAnalysisTask(
      executionContext,
      selectedModel,
      selectedModelRef,
      messages
    );

    try {
      const result = await agentExecutor.execute(executionContext, {
        model: selectedModel,
        modelRef: selectedModelRef,
        messages: messages as AgentExecuteOptions['messages'],
        onChunk: (chunk) => {
          // console.log('[AIAnalyzeTool] Chunk:', chunk);
          // 使用标准回调
          options?.onChunk?.(chunk);
        },
        onToolCall: (toolCall) => {
          // console.log('[AIAnalyzeTool] Tool call:', toolCall.name);

          // 注入模型参数到工具参数中
          const settings = geminiSettings.get();
          const toolArgs = applyMediaModelDefaultsToArgs(
            toolCall.name,
            { ...toolCall.arguments },
            {
              defaultModels: executionContext.defaultModels,
              defaultModelRefs: executionContext.defaultModelRefs,
              contextModel: executionContext.model,
              contextModelRef: modelRef || null,
              fallbackModels: {
                image: settings.imageModelName || getDefaultImageModel(),
                video: settings.videoModelName || getDefaultVideoModel(),
                audio: settings.audioModelName || getDefaultAudioModel(),
              },
            }
          );
          if (
            normalizedKnowledgeContextRefs.length > 0 &&
            GENERATION_CONTEXT_TOOLS.has(toolCall.name) &&
            !toolArgs.knowledgeContextRefs
          ) {
            toolArgs.knowledgeContextRefs = normalizedKnowledgeContextRefs;
          }
          if (GENERATION_CONTEXT_TOOLS.has(toolCall.name)) {
            if (executionContext.canvasAssociations?.length) {
              toolArgs.canvasAssociations =
                executionContext.canvasAssociations.map((reference) => ({
                  ...reference,
                }));
            } else {
              delete toolArgs.canvasAssociations;
            }
          }

          // 创建新的工作流步骤
          const newStep: WorkflowStepInfo = {
            id: `step-tool-${Date.now()}-${Math.random()
              .toString(36)
              .substring(2, 6)}`,
            mcp: toolCall.name,
            args: toolArgs,
            description: getToolDescription(toolCall.name, toolArgs),
            status: 'running',
          };

          generatedSteps.push(newStep);

          // 使用标准回调通知调用方添加步骤
          options?.onAddSteps?.([newStep]);
        },
        onToolResult: (toolResult) => {
          // console.log('[AIAnalyzeTool] Tool result:', toolResult);

          // 更新最后一个步骤的状态
          if (generatedSteps.length > 0) {
            const lastStep = generatedSteps[generatedSteps.length - 1];
            lastStep.status = toolResult.success ? 'completed' : 'failed';

            // 使用标准回调通知调用方更新步骤状态
            options?.onUpdateStep?.(
              lastStep.id,
              lastStep.status,
              toolResult.data,
              toolResult.error
            );
          }
        },
      });

      const duration = Date.now() - startTime;

      if (!result.success) {
        taskQueueService.updateTaskStatus(task.id, TaskStatus.FAILED, {
          error: {
            code: 'AI_ANALYZE_ERROR',
            message: result.error || 'AI 分析失败',
          },
        });
        return {
          success: false,
          error: result.error || 'AI 分析失败',
          type: 'error',
          data: {
            duration,
            generatedSteps,
          },
        };
      }

      taskQueueService.updateTaskStatus(task.id, TaskStatus.COMPLETED, {
        result: {
          url: '',
          format: 'text',
          size: result.response?.length || 0,
          resultKind: 'chat',
          title: task.params.prompt.slice(0, 50) || 'AI 文本任务',
          chatResponse: result.response || '',
          toolCalls: generatedSteps.map((step) => ({
            name: step.mcp,
            arguments: step.args,
          })),
        },
      });

      return {
        success: true,
        type: 'text',
        data: {
          response: result.response,
          generatedSteps,
          duration,
        },
      };
    } catch (error: any) {
      console.error('[AIAnalyzeTool] Analysis failed:', error);
      taskQueueService.updateTaskStatus(task.id, TaskStatus.FAILED, {
        error: {
          code: 'AI_ANALYZE_ERROR',
          message: error.message || 'AI 分析失败',
        },
      });

      return {
        success: false,
        error: error.message || 'AI 分析失败',
        type: 'error',
        data: {
          duration: Date.now() - startTime,
          generatedSteps,
        },
      };
    }
  },
};

/**
 * 根据工具名称生成描述
 */
function getToolDescription(
  toolName: string,
  args?: Record<string, unknown>
): string {
  switch (toolName) {
    case 'generate_image':
      return `生成图片: ${((args?.prompt as string) || '').substring(
        0,
        30
      )}...`;
    case 'generate_video':
      return `生成视频: ${((args?.prompt as string) || '').substring(
        0,
        30
      )}...`;
    case 'generate_audio':
      return `生成音频: ${((args?.prompt as string) || '').substring(
        0,
        30
      )}...`;
    case 'generate_ppt':
      return `生成PPT: ${((args?.topic as string) || '').substring(0, 30)}...`;
    case 'generate_ppt_explainer_video':
      return `生成PPT讲解视频: ${((args?.topic as string) || '').substring(
        0,
        30
      )}...`;
    case 'generate_grid_image':
      return `生成宫格图: ${((args?.theme as string) || '').substring(
        0,
        30
      )}...`;
    case 'insert_svg':
      return `插入SVG矢量图`;
    case 'canvas_insertion':
    case 'insert_to_canvas':
      return '插入到画布';
    default:
      return `执行 ${toolName}`;
  }
}

/**
 * 便捷方法：执行 AI 分析
 */
export async function analyzeWithAI(
  context: AgentExecutionContext,
  options?: MCPExecuteOptions
): Promise<AIAnalyzeResult> {
  const result = await aiAnalyzeTool.execute(
    { context } as unknown as Record<string, unknown>,
    options
  );

  const data = result.data as
    | { generatedSteps?: WorkflowStepInfo[]; response?: string }
    | undefined;

  return {
    success: result.success,
    generatedSteps: data?.generatedSteps,
    response: data?.response,
    error: result.error,
  };
}

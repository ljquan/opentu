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

import type { MCPTool, MCPResult, MCPExecuteOptions, AgentExecutionContext, WorkflowStepInfo, AgentExecuteOptions } from '../types';
import { getModelType, IMAGE_MODELS } from '../types';
import { agentExecutor } from '../../services/agent';
import { geminiSettings, type ModelRef } from '../../utils/settings-manager';
import type { GeminiMessagePart } from '../../utils/gemini-api/types';

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
        description: '预构建的消息数组，传入时直接使用，不再生成默认系统提示词（用于 Skill 角色扮演/精准工具注入）',
      },
    },
    required: ['context'],
  },

  supportedModes: ['async'],

  execute: async (params: Record<string, unknown>, options?: MCPExecuteOptions): Promise<MCPResult> => {
    const { context, textModel, messages, modelRef } =
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

    try {
      console.log('[AIAnalyzeTool] 开始分析:', {
        userInstruction: context.userInstruction?.substring(0, 50),
        model: context.model,
        textModel,
        hasCustomMessages: !!messages,
      });

      const result = await agentExecutor.execute(context, {
        model: textModel || context.model.id,
        modelRef: modelRef || null,
        messages: messages as AgentExecuteOptions['messages'],
        onChunk: (chunk) => {
          // console.log('[AIAnalyzeTool] Chunk:', chunk);
          // 使用标准回调
          options?.onChunk?.(chunk);
        },
        onToolCall: (toolCall) => {
          // console.log('[AIAnalyzeTool] Tool call:', toolCall.name);

          // 注入模型参数到工具参数中
          const toolArgs = { ...toolCall.arguments };
          const generationTools = ['generate_image', 'generate_video', 'generate_grid_image', 'generate_photo_wall'];
          if (generationTools.includes(toolCall.name)) {
            const specifiedModel = toolArgs.model as string | undefined;
            const isVideoTool = toolCall.name === 'generate_video';
            const settings = geminiSettings.get();
            const contextModelType = context.model?.type;
            const contextModelId = context.model?.id;
            const preferredContextModelId =
              contextModelType === (isVideoTool ? 'video' : 'image')
                ? contextModelId
                : undefined;
            const preferredContextModelRef =
              preferredContextModelId && modelRef?.modelId === preferredContextModelId
                ? modelRef
                : null;

            // 获取用户设置的默认模型
            const defaultImageModel = settings.imageModelName || IMAGE_MODELS[0]?.id || 'gemini-2.5-flash-image-vip';
            const defaultVideoModel = settings.videoModelName || 'veo3';
            const fallbackModel = preferredContextModelId || (isVideoTool ? defaultVideoModel : defaultImageModel);

            if (specifiedModel) {
              // AI 指定了模型，检查类型是否匹配
              const modelType = getModelType(specifiedModel);
              const needsCorrection = isVideoTool
                ? modelType !== 'video'
                : modelType !== 'image';

              if (needsCorrection) {
                toolArgs.model = fallbackModel;
                if (
                  preferredContextModelRef &&
                  preferredContextModelRef.modelId === fallbackModel
                ) {
                  toolArgs.modelRef = preferredContextModelRef;
                } else {
                  delete toolArgs.modelRef;
                }
              } else if (
                preferredContextModelRef &&
                preferredContextModelRef.modelId === specifiedModel
              ) {
                toolArgs.modelRef = preferredContextModelRef;
              }
            } else {
              // AI 没有指定模型，优先沿用当前上下文显式模型，否则回退默认模型
              toolArgs.model = fallbackModel;
              if (
                preferredContextModelRef &&
                preferredContextModelRef.modelId === fallbackModel
              ) {
                toolArgs.modelRef = preferredContextModelRef;
              } else {
                delete toolArgs.modelRef;
              }
            }
          }

          // 创建新的工作流步骤
          const newStep: WorkflowStepInfo = {
            id: `step-tool-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
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
function getToolDescription(toolName: string, args?: Record<string, unknown>): string {
  switch (toolName) {
    case 'generate_image':
      return `生成图片: ${((args?.prompt as string) || '').substring(0, 30)}...`;
    case 'generate_video':
      return `生成视频: ${((args?.prompt as string) || '').substring(0, 30)}...`;
    case 'generate_grid_image':
      return `生成宫格图: ${((args?.theme as string) || '').substring(0, 30)}...`;
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

  const data = result.data as { generatedSteps?: WorkflowStepInfo[]; response?: string } | undefined;

  return {
    success: result.success,
    generatedSteps: data?.generatedSteps,
    response: data?.response,
    error: result.error,
  };
}

/**
 * AI 分析服务
 *
 * 调用文本模型分析用户意图，返回需要执行的后续工作流步骤
 */

import type { MCPExecuteOptions, AgentExecutionContext, WorkflowStepInfo } from '../../mcp/types';
import {
  getDefaultImageModel,
  getDefaultTextModel,
  getDefaultVideoModel,
  getModelType,
} from '../../constants/model-config';
import { agentExecutor } from '../agent';
import { geminiSettings, type ModelRef } from '../../utils/settings-manager';
import { getPreferredModels } from '../../utils/runtime-model-discovery';

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
 * 执行 AI 分析
 */
export async function analyzeWithAI(
  context: AgentExecutionContext,
  options?: MCPExecuteOptions,
  modelRef?: ModelRef | null
): Promise<AIAnalyzeResult> {
  if (!context) {
    return {
      success: false,
      error: '缺少必填参数 context',
    };
  }

  const generatedSteps: WorkflowStepInfo[] = [];

  try {
    const settings = geminiSettings.get();
    const result = await agentExecutor.execute(context, {
      model: context.model.id || settings.textModelName || getPreferredModels('text')[0]?.id || getDefaultTextModel(),
      modelRef: modelRef || null,
      onChunk: (chunk) => {
        options?.onChunk?.(chunk);
      },
      onToolCall: (toolCall) => {
        // 注入模型参数到工具参数中
        const toolArgs = { ...toolCall.arguments };
        const generationTools = ['generate_image', 'generate_video', 'generate_grid_image', 'generate_photo_wall'];
        
        if (generationTools.includes(toolCall.name)) {
          const specifiedModel = toolArgs.model as string | undefined;
          const isVideoTool = toolCall.name === 'generate_video';
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
          const defaultImageModel =
            settings.imageModelName || getPreferredModels('image')[0]?.id || getDefaultImageModel();
          const defaultVideoModel =
            settings.videoModelName || getPreferredModels('video')[0]?.id || getDefaultVideoModel();
          const fallbackModel =
            preferredContextModelId ||
            (isVideoTool ? defaultVideoModel : defaultImageModel);

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
          status: 'pending',
        };

        generatedSteps.push(newStep);
        options?.onAddSteps?.([newStep]);
      },
      onToolResult: (toolResult) => {
        if (generatedSteps.length > 0) {
          const lastStep = generatedSteps[generatedSteps.length - 1];
          lastStep.status = toolResult.success ? 'completed' : 'failed';

          options?.onUpdateStep?.(
            lastStep.id,
            lastStep.status,
            toolResult.data,
            toolResult.error
          );
        }
      },
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'AI 分析失败',
        generatedSteps,
      };
    }

    return {
      success: true,
      generatedSteps,
      response: result.response,
    };
  } catch (error: any) {
    console.error('[AIAnalyze] Analysis failed:', error);

    return {
      success: false,
      error: error.message || 'AI 分析失败',
      generatedSteps,
    };
  }
}

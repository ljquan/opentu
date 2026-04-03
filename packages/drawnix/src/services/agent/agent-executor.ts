/**
 * Agent 执行器
 *
 * 协调 LLM 调用和 MCP 工具执行的核心服务
 */

import { defaultGeminiClient } from '../../utils/gemini-api';
import type { GeminiMessage } from '../../utils/gemini-api/types';
import {
  appendImagePartsToLastUserMessage,
  buildImagePartsFromUrls,
  hasImageParts,
} from '../../utils/gemini-api/message-utils';
import type { AgentResult, AgentExecuteOptions, ToolCall, AgentExecutionContext } from '../../mcp/types';
import { generateSystemPrompt, generateReferenceImagesPrompt } from './system-prompts';
import { parseToolCalls, extractTextContent } from './tool-parser';
import { geminiSettings } from '../../utils/settings-manager';
import { analytics } from '../../utils/posthog-analytics';
import {
  getTextBindingMaxImageCount,
  resolveInvocationPlanFromRoute,
  supportsTextBindingImageInput,
} from '../provider-routing';

/**
 * 将占位符替换为真实图片 URL
 */
function replacePlaceholdersWithUrls(
  text: string,
  imageUrls: string[]
): string {
  let result = text;

  // 替换中文占位符 [图片1], [图片2], ...
  // 每次调用创建新的正则实例，避免 global flag 状态问题
  result = result.replace(/\[图片(\d+)\]/g, (match, indexStr) => {
    const index = parseInt(indexStr, 10) - 1; // 占位符从 1 开始，数组从 0 开始
    if (index >= 0 && index < imageUrls.length) {
      return imageUrls[index];
    }
    return match; // 保持原样
  });

  // 替换英文占位符 [Image 1], [Image 2], ...
  result = result.replace(/\[Image\s*(\d+)\]/gi, (match, indexStr) => {
    const index = parseInt(indexStr, 10) - 1;
    if (index >= 0 && index < imageUrls.length) {
      return imageUrls[index];
    }
    return match;
  });

  return result;
}

/**
 * 构建结构化的用户消息
 * 使用 Markdown 格式清晰展示所有上下文信息
 *
 * @exported for use in workflow-converter.ts to build messages for SW ai_analyze
 */
export function buildStructuredUserMessage(context: AgentExecutionContext): string {
  const parts: string[] = [];

  // 1. 模型和参数信息
  parts.push('## 生成配置');
  parts.push('');
  const modelStatus = context.model.isExplicit ? '(用户指定)' : '(默认)';
  // 根据模式类型生成不同的描述
  const typeLabels: Record<string, string> = { text: 'Agent 智能模式', image: '图片生成', video: '视频生成' };
  const typeLabel = typeLabels[context.model.type] || 'Agent 智能模式';
  parts.push(`- **模式**: ${typeLabel}`);
  // Agent 模式下显示文本模型，图片/视频模式显示当前模型
  if (context.model.type === 'text') {
    parts.push(`- **文本模型**: ${context.model.id} ${modelStatus}`);
  } else {
    parts.push(`- **当前模型**: ${context.model.id} ${modelStatus}`);
  }
  // 添加默认模型信息，告诉 AI 不需要传 model 参数
  if (context.defaultModels) {
    parts.push(`- **图片生成模型**: ${context.defaultModels.image}`);
    parts.push(`- **视频生成模型**: ${context.defaultModels.video}`);
  }
  parts.push(`- **数量**: ${context.params.count}`);
  // 始终传递配置的尺寸，但标注为默认值，让 AI 判断是否使用
  // 优先级：用户指令中的尺寸描述 > 下拉框选择的尺寸 > 模型默认尺寸
  if (context.params.size) {
    parts.push(`- **尺寸**: ${context.params.size}（默认值，如用户指令中有尺寸描述则优先使用用户的）`);
  }
  if (context.params.duration) {
    parts.push(`- **时长**: ${context.params.duration}秒`);
  }
  parts.push('');

  // 2. 选中的文本元素（作为生成 prompt 的主要来源）
  if (context.selection.texts.length > 0) {
    parts.push('## 选中的文本内容（作为生成提示词）');
    parts.push('');
    parts.push('```');
    parts.push(context.selection.texts.join('\n'));
    parts.push('```');
    parts.push('');
  }

  // 3. 用户输入的指令（额外要求）
  if (context.userInstruction) {
    parts.push('## 用户指令');
    parts.push('');
    parts.push(context.userInstruction);
    parts.push('');
  }

  // 4. 参考素材
  const hasImages = context.selection.images.length > 0 || context.selection.graphics.length > 0;
  const hasVideos = context.selection.videos.length > 0;

  if (hasImages || hasVideos) {
    parts.push('## 参考素材（已把url替换为占位符，严格返回即可）');
    parts.push('');

    // 图片（包括图形转换的图片）
    if (hasImages) {
      const allImages = [...context.selection.images, ...context.selection.graphics];
      const placeholders = allImages.map((_, i) => `[图片${i + 1}]`).join('、');
      parts.push(`- **参考图片**: ${placeholders}`);
    }

    // 视频
    if (hasVideos) {
      const placeholders = context.selection.videos.map((_, i) => `[视频${i + 1}]`).join('、');
      parts.push(`- **参考视频**: ${placeholders}`);
    }
    parts.push('');
  }

  // 5. 最终 prompt（如果没有用户指令和选中文本，则显示默认 prompt）
  if (!context.userInstruction && context.selection.texts.length === 0 && context.finalPrompt) {
    parts.push('## 生成提示词');
    parts.push('');
    parts.push(context.finalPrompt);
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * 替换工具调用参数中的占位符
 */
function replaceToolCallPlaceholders(
  toolCall: ToolCall,
  imageUrls: string[]
): ToolCall {
  const newArgs: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(toolCall.arguments)) {
    if ((key === 'referenceImages' || key === 'inputReferences') && Array.isArray(value)) {
      // referenceImages 或 inputReferences 数组，将占位符替换为真实 URL
      const replacedUrls = value
        .map(item => {
          if (typeof item === 'string') {
            // 检查是否是占位符格式
            const zhMatch = item.match(/^\[图片(\d+)\]$/);
            const enMatch = item.match(/^\[Image\s*(\d+)\]$/i);
            const match = zhMatch || enMatch;
            if (match) {
              const index = parseInt(match[1], 10) - 1;
              if (index >= 0 && index < imageUrls.length) {
                return imageUrls[index];
              }
            }
            // 不是占位符，可能已经是 URL
            return item;
          } else if (item && typeof item === 'object' && (item as any).url) {
            // 如果是对象格式 { url: '[图片1]' }，也进行替换
            const url = (item as any).url;
            if (typeof url === 'string') {
              const zhMatch = url.match(/^\[图片(\d+)\]$/);
              const enMatch = url.match(/^\[Image\s*(\d+)\]$/i);
              const match = zhMatch || enMatch;
              if (match) {
                const index = parseInt(match[1], 10) - 1;
                if (index >= 0 && index < imageUrls.length) {
                  return { ...item, url: imageUrls[index] };
                }
              }
            }
          }
          return item;
        })
        .filter(Boolean);
      newArgs[key] = replacedUrls.length > 0 ? (key === 'referenceImages' ? replacedUrls.map(u => typeof u === 'string' ? u : (u as any).url) : replacedUrls) : imageUrls;
    } else if ((key === 'referenceImage' || key === 'inputReference') && typeof value === 'string') {
      // 字符串参数，替换占位符
      newArgs[key] = replacePlaceholdersWithUrls(value, imageUrls);
    } else if (Array.isArray(value)) {
      // 其他数组参数，递归替换
      newArgs[key] = value.map(item =>
        typeof item === 'string' ? replacePlaceholdersWithUrls(item, imageUrls) : item
      );
    } else {
      newArgs[key] = value;
    }
  }

  // 如果参数中没有 referenceImages 或 inputReferences 但有图片 URL，自动添加
  if (!newArgs.referenceImages && !newArgs.inputReferences && imageUrls.length > 0) {
    // 同时也为视频接口提供参数兼容性
    newArgs.referenceImages = imageUrls;
    newArgs.inputReferences = imageUrls.map(url => ({ url }));
  } else if (newArgs.referenceImages && !newArgs.inputReferences) {
    // 保持同步
    newArgs.inputReferences = (newArgs.referenceImages as string[]).map(url => ({ url }));
  }

  return {
    ...toolCall,
    arguments: newArgs,
  };
}

/**
 * Agent 执行器类
 */
class AgentExecutor {
  private static instance: AgentExecutor;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): AgentExecutor {
    if (!AgentExecutor.instance) {
      AgentExecutor.instance = new AgentExecutor();
    }
    return AgentExecutor.instance;
  }

  /**
   * 执行 Agent 请求
   *
   * @param context 完整的执行上下文
   * @param options 执行选项
   */
  async execute(context: AgentExecutionContext, options: AgentExecuteOptions = {}): Promise<AgentResult> {
    const {
      model,
      modelRef,
      onChunk,
      onToolCall,
      signal,
      maxIterations = 3,
      messages: externalMessages,
    } = options;

    const startTime = Date.now();
    const toolCallsExecuted: string[] = [];

    // 埋点：Agent 工作流开始
    analytics.track('agent_workflow_start', {
      modelType: context.model.type,
      modelId: context.model.id,
      hasReferenceImages: context.selection.images.length > 0,
      hasSelectedTexts: context.selection.texts.length > 0,
      triggerSource: context.userInstruction ? 'user_input' : 'selection',
    });

    try {
      // 收集所有参考图片 URL
      const allReferenceImages = [...context.selection.images, ...context.selection.graphics];
      const globalSettings = geminiSettings.get();
      const textRouteModel =
        modelRef || model || globalSettings.textModelName || context.model.id;
      const textPlan = resolveInvocationPlanFromRoute('text', textRouteModel);
      const textSupportsImageInput = supportsTextBindingImageInput(
        textPlan?.binding
      );
      const textMaxImageCount = getTextBindingMaxImageCount(textPlan?.binding);

      // 构建消息数组：优先使用外部传入的 messages（Skill 路径 B/C），否则内部生成
      let messages: GeminiMessage[];

      if (externalMessages && externalMessages.length > 0) {
        // 路径 B/C：直接使用外部传入的消息，不调用 generateSystemPrompt()
        messages = externalMessages.map((msg: any) => ({
          role: msg.role,
          content: typeof msg.content === 'string'
            ? [{ type: 'text', text: msg.content }]
            : (msg.content as GeminiMessage['content']),
        }));
      } else {
        // 默认 Agent 路径：内部生成系统提示词
        let systemPrompt = generateSystemPrompt();

        // 如果有参考图片，添加补充说明（使用占位符方式，包含尺寸信息）
        if (allReferenceImages.length > 0) {
          systemPrompt += generateReferenceImagesPrompt(
            allReferenceImages.length,
            context.selection.imageDimensions
          );
        }

        // 构建结构化用户消息
        const userMessage = buildStructuredUserMessage(context);

        messages = [
          {
            role: 'system',
            content: [
              { type: 'text', text: systemPrompt },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: userMessage },
            ],
          },
        ];
      }

      if (
        textSupportsImageInput &&
        allReferenceImages.length > 0 &&
        !hasImageParts(messages)
      ) {
        const imageParts = await buildImagePartsFromUrls(
          allReferenceImages,
          textMaxImageCount
        );
        messages = appendImagePartsToLastUserMessage(messages, imageParts);
      }

      // 执行循环
      let iterations = 0;
      let finalResponse = '';
      const textModelName =
        (typeof textRouteModel === 'string'
          ? textRouteModel
          : textRouteModel?.modelId) || globalSettings.textModelName;
      console.log('[AgentExecutor] 使用文本模型:', textModelName, ', hasApiKey:', !!globalSettings.apiKey);

      while (iterations < maxIterations) {
        iterations++;
        console.log(`[AgentExecutor] 迭代 ${iterations}/${maxIterations}, 即将调用 sendChat...`);

        // 调用 LLM，使用指定或全局默认的文本模型
        let fullResponse = '';
        const t0 = Date.now();
        const response = await defaultGeminiClient.sendChat(
          messages,
          (accumulatedContent) => {
            // accumulatedContent 已经是累积的完整内容
            fullResponse = accumulatedContent;
            onChunk?.(accumulatedContent);
          },
          signal,
          textRouteModel // 优先使用当前上下文选择的 provider-aware 文本模型
        );
        console.log(`[AgentExecutor] sendChat 返回, 耗时: ${Date.now() - t0}ms`);

        // 获取完整响应
        if (response.choices && response.choices.length > 0) {
          fullResponse = response.choices[0].message.content || fullResponse;
        }

        console.log('[AgentExecutor] LLM 响应长度:', fullResponse.length, ', 前100字:', fullResponse.substring(0, 100));

        // 解析工具调用
        const toolCalls = parseToolCalls(fullResponse);

        // 提取文本内容
        finalResponse = extractTextContent(fullResponse) || fullResponse;

        if (toolCalls.length === 0) {
          // 没有工具调用，返回文本响应
          break;
        }

        // 报告工具调用（不执行，由调用方执行）
        // 这样 AIInputBar 可以在 UI 中显示步骤并统一管理执行
        for (const rawToolCall of toolCalls) {
          // 替换占位符为真实图片 URL
          const toolCall = allReferenceImages.length > 0
            ? replaceToolCallPlaceholders(rawToolCall, allReferenceImages)
            : rawToolCall;

          // console.log(`[AgentExecutor] Reporting tool call: ${toolCall.name}`, toolCall.arguments);
          toolCallsExecuted.push(toolCall.name);
          
          // 埋点：MCP 工具执行
          analytics.track('mcp_tool_execution', {
            toolName: toolCall.name,
            hasArguments: Object.keys(toolCall.arguments).length > 0,
          });
          
          onToolCall?.(toolCall);
        }

        // 埋点：Agent 工作流成功
        analytics.track('agent_workflow_success', {
          duration: Date.now() - startTime,
          toolsExecuted: toolCallsExecuted,
          toolCount: toolCallsExecuted.length,
          iterations,
        });

        // 工具调用已报告，返回成功
        // 实际执行由调用方（AIInputBar）在接收到 onAddSteps 后处理
        return {
          success: true,
          response: finalResponse,
          toolResults: [], // 工具尚未执行，没有结果
          model,
        };
      }

      // 埋点：Agent 工作流成功（无工具调用）
      analytics.track('agent_workflow_success', {
        duration: Date.now() - startTime,
        toolsExecuted: [],
        toolCount: 0,
        iterations,
      });

      return {
        success: true,
        response: finalResponse,
        toolResults: [],
        model,
      };
    } catch (error: any) {
      console.error('[AgentExecutor] Execution failed:', error);

      // 埋点：Agent 工作流失败
      analytics.track('agent_workflow_failed', {
        duration: Date.now() - startTime,
        error: error.message || 'Unknown error',
        toolsExecuted: toolCallsExecuted,
      });

      return {
        success: false,
        error: error.message || 'Agent 执行失败',
        model,
      };
    }
  }
}

// 导出单例实例
export const agentExecutor = AgentExecutor.getInstance();

// 导出类型
export { AgentExecutor };

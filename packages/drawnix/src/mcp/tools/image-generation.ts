/**
 * 图片生成 MCP 工具
 *
 * 封装现有的图片生成服务，提供标准化的 MCP 工具接口
 * 支持两种执行模式：
 * - async: 直接调用 API 等待返回（Agent 流程）
 * - queue: 创建任务加入队列（直接生成流程）
 */

import type { MCPTool, MCPResult, MCPExecuteOptions, MCPTaskResult } from '../types';
import { getFileExtension, normalizeImageDataUrl } from '@aitu/utils';
import { defaultGeminiClient } from '../../utils/gemini-api';
import { TaskType } from '../../types/task.types';
import { getDefaultImageModel, IMAGE_PARAMS } from '../../constants/model-config';
import { geminiSettings, type ModelRef } from '../../utils/settings-manager';
import { normalizeToClosestImageSize } from '../../services/media-api/utils';
import { createQueueTask, validatePrompt, wrapApiError, toUploadedImages } from './shared/queue-utils';

/**
 * 获取当前使用的图片模型名称
 * 优先级：设置中的模型 > 默认模型
 */
export function getCurrentImageModel(): string {
  const settings = geminiSettings.get();
  return settings?.imageModelName || getDefaultImageModel();
}

/**
 * 获取图片尺寸选项
 */
function getImageSizeOptions(): string[] {
  const sizeParam = IMAGE_PARAMS.find(p => p.id === 'size');
  return sizeParam?.options?.map(o => o.value) || ['1x1', '16x9', '9x16'];
}

/**
 * 图片生成参数
 */
export interface ImageGenerationParams {
  /** 图片描述提示词 */
  prompt: string;
  /** 图片尺寸，格式如 '1x1', '16x9', '9x16' */
  size?: string;
  /** 参考图片 URL 列表 */
  referenceImages?: string[];
  /** 图片质量 */
  quality?: '1k' | '2k' | '4k';
  /** AI 模型 */
  model?: string;
  /** 模型来源引用（用于多供应商路由） */
  modelRef?: ModelRef | null;
  /** 生成数量（仅 queue 模式支持） */
  count?: number;
  /** 批次 ID（批量生成时） */
  batchId?: string;
  /** 批次索引（1-based） */
  batchIndex?: number;
  /** 批次总数 */
  batchTotal?: number;
  /** 全局索引 */
  globalIndex?: number;
  /** 额外参数（如 seedream_quality） */
  params?: Record<string, unknown>;
}

/**
 * 直接调用 API 生成图片（async 模式）
 */
async function executeAsync(params: ImageGenerationParams): Promise<MCPResult> {
  const { prompt, size, referenceImages, quality, model, modelRef } = params;

  const promptError = validatePrompt(prompt);
  if (promptError) return promptError;

  try {
    // 调用 Gemini 图片生成 API
    const result = await defaultGeminiClient.generateImage(prompt, {
      size: size || '1x1',
      image: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
      response_format: 'url',
      quality: quality || '1k',
      model,
      modelRef: modelRef || null,
    });

    // console.log('[ImageGenerationTool] Generation response:', result);

    // 解析响应
    if (result.data && Array.isArray(result.data) && result.data.length > 0) {
      const imageData = result.data[0];
      const rawValue = imageData.url || imageData.b64_json;

      if (typeof rawValue !== 'string') {
        return {
          success: false,
          error: 'API 未返回有效的图片数据',
          type: 'error',
        };
      }

      const imageUrl = normalizeImageDataUrl(rawValue);
      const format = getFileExtension(imageUrl) || 'png';

      return {
        success: true,
        data: {
          url: imageUrl,
          format: format === 'bin' ? 'png' : format,
          prompt,
          size: size || '1x1',
        },
        type: 'image',
      };
    }

    return {
      success: false,
      error: 'API 未返回有效的图片数据',
      type: 'error',
    };
  } catch (error: any) {
    console.error('[ImageGenerationTool] Generation failed:', error);
    return wrapApiError(error, '图片生成失败');
  }
}

/** 图片任务队列配置 */
function getImageQueueConfig(params: ImageGenerationParams) {
  const uploadedImages = toUploadedImages(params.referenceImages);

  return {
    taskType: TaskType.IMAGE,
    resultType: 'image' as const,
    getDefaultModel: getCurrentImageModel,
    logPrefix: 'ImageGenerationTool',
    buildTaskPayload: () => ({
      prompt: params.prompt,
      size: params.size || '1x1',
      uploadedImages: uploadedImages && uploadedImages.length > 0 ? uploadedImages : undefined,
      referenceImages: params.referenceImages && params.referenceImages.length > 0 ? params.referenceImages : undefined,
      model: params.model || getCurrentImageModel(),
      modelRef: params.modelRef || null,
      ...(params.params ? { params: params.params } : {}),
    }),
    buildResultData: () => ({
      size: params.size || '1x1',
    }),
  };
}

/**
 * 图片生成 MCP 工具定义
 */
export const imageGenerationTool: MCPTool = {
  name: 'generate_image',
  description: `生成图片工具。根据用户的文字描述生成图片。

使用场景：
- 用户想要创建、生成、绘制图片
- 用户描述了想要的图片内容
- 用户提供了参考图片并想要生成类似或修改后的图片

不适用场景：
- 用户想要生成视频（使用 generate_video 工具）
- 用户只是在聊天，没有生成图片的意图

当前使用模型：${getCurrentImageModel()}`,

  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '图片描述提示词，详细描述想要生成的图片内容、风格、构图等',
      },
      size: {
        type: 'string',
        description: '图片尺寸比例',
        enum: getImageSizeOptions(),
        default: '1x1',
      },
      referenceImages: {
        type: 'array',
        description: '参考图片 URL 列表，用于图生图或风格参考',
        items: {
          type: 'string',
        },
      },
      quality: {
        type: 'string',
        description: '图片质量',
        enum: ['1k', '2k', '4k'],
        default: '1k',
      },
      model: {
        type: 'string',
        description: `图片生成模型，默认使用 ${getDefaultImageModel()}`,
        default: getDefaultImageModel(),
      },
      count: {
        type: 'number',
        description: '生成数量，1-10 之间，默认为 1',
        default: 1,
      },
    },
    required: ['prompt'],
  },

  supportedModes: ['async', 'queue'],

  promptGuidance: {
    whenToUse: '当用户想要生成单张或多张图片时使用。适用于：创作插画、生成照片、艺术创作、图生图风格转换等。',

    parameterGuidance: {
      prompt: '将用户描述扩展为详细的英文提示词，包含：主体描述、风格（如 cinematic, watercolor, anime）、光线（如 soft lighting, golden hour）、构图（如 close-up, wide shot）、质量词（如 high quality, detailed）。',
      size: '根据内容选择：人像用 9x16，风景用 16x9，正方形内容用 1x1。默认 1x1。',
      referenceImages: '当用户提供参考图片时使用占位符如 ["[图片1]"]，系统会自动替换为真实 URL。',
      count: '用户明确要求批量生成时使用，如 "+3 画一只猫" 则 count=3。',
    },

    bestPractices: [
      'prompt 使用英文能获得更好的生成效果',
      '添加风格关键词如 "professional photography"、"digital art"、"oil painting"',
      '描述光线和氛围如 "warm lighting"、"dramatic shadows"、"soft bokeh"',
      '使用质量词如 "highly detailed"、"8k resolution"、"masterpiece"',
      '对于人物，描述表情、姿势、服装等细节',
    ],

    examples: [
      {
        input: '画一只猫',
        args: { prompt: 'A cute orange kitten with fluffy fur and big eyes, sitting in warm sunlight, soft bokeh background, professional photography, highly detailed', size: '1x1' },
      },
      {
        input: '赛博朋克城市',
        args: { prompt: 'Cyberpunk cityscape at night, neon lights reflecting on wet streets, towering skyscrapers with holographic advertisements, flying cars, rain, cinematic atmosphere, highly detailed, 8k', size: '16x9' },
      },
      {
        input: '[图片1] 把这张图变成水彩风格',
        args: { prompt: 'Transform to watercolor painting style, soft brush strokes, artistic color palette, delicate watercolor texture, maintain original composition', referenceImages: ['[图片1]'] },
        explanation: '图生图使用 referenceImages 传递参考图片',
      },
    ],
  },

  execute: async (params: Record<string, unknown>, options?: MCPExecuteOptions): Promise<MCPResult> => {
    console.log('[ImageGenerationTool] execute called with mode:', options?.mode);
    const rawParams = params as unknown as ImageGenerationParams;
    const mode = options?.mode || 'async';

    // 规范化 size：将不在可用范围内的 size 自动转换为最接近的可用值
    const typedParams: ImageGenerationParams = {
      ...rawParams,
      size: rawParams.size ? normalizeToClosestImageSize(rawParams.size, '1x1') : rawParams.size,
    };

    if (mode === 'queue') {
      return createQueueTask(typedParams, options || {}, getImageQueueConfig(typedParams));
    }

    return executeAsync(typedParams);
  },
};

/**
 * 便捷方法：直接生成图片（async 模式）
 */
export async function generateImage(params: ImageGenerationParams): Promise<MCPResult> {
  return imageGenerationTool.execute(params as unknown as Record<string, unknown>, { mode: 'async' });
}

/**
 * 便捷方法：创建图片生成任务（queue 模式）
 */
export async function createImageTask(
  params: ImageGenerationParams,
  options?: Omit<MCPExecuteOptions, 'mode'>
): Promise<MCPTaskResult> {
  const result = await imageGenerationTool.execute(params as unknown as Record<string, unknown>, {
    ...options,
    mode: 'queue',
  });
  return result as MCPTaskResult;
}

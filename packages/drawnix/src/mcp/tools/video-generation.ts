/**
 * 视频生成 MCP 工具
 *
 * 封装现有的视频生成服务，提供标准化的 MCP 工具接口
 * 支持两种执行模式：
 * - async: 直接调用 API 等待返回（Agent 流程）
 * - queue: 创建任务加入队列（直接生成流程）
 */

import type { MCPTool, MCPResult, MCPExecuteOptions, MCPTaskResult } from '../types';
import { TaskType } from '../../types/task.types';
import type { VideoModel } from '../../types/video.types';
import { VIDEO_MODEL_CONFIGS } from '../../constants/video-model-config';
import { getDefaultVideoModel } from '../../constants/model-config';
import { geminiSettings, type ModelRef } from '../../utils/settings-manager';
import { normalizeToClosestVideoSize } from '../../services/media-api/utils';
import {
  getAdapterContextFromSettings,
  resolveAdapterForInvocation,
} from '../../services/model-adapters';
import { createQueueTask, validatePrompt, wrapApiError, toUploadedImages } from './shared/queue-utils';

/**
 * 获取当前使用的视频模型名称
 * 优先级：设置中的模型 > 默认模型
 */
export function getCurrentVideoModel(): string {
  const settings = geminiSettings.get();
  return settings?.videoModelName || getDefaultVideoModel();
}

/**
 * 获取所有可用的视频时长选项（去重）
 */
function getVideoDurationOptions(): string[] {
  const durations = new Set<string>();
  Object.values(VIDEO_MODEL_CONFIGS).forEach(config => {
    config.durationOptions.forEach(opt => durations.add(opt.value));
  });
  return Array.from(durations).sort((a, b) => parseInt(a) - parseInt(b));
}

/**
 * 获取所有可用的视频尺寸选项（去重）
 */
function getVideoSizeOptions(): string[] {
  const sizes = new Set<string>();
  Object.values(VIDEO_MODEL_CONFIGS).forEach(config => {
    config.sizeOptions.forEach(opt => sizes.add(opt.value));
  });
  return Array.from(sizes);
}

/**
 * 视频生成参数
 */
export interface VideoGenerationParams {
  /** 视频描述提示词 */
  prompt: string;
  /** 视频模型 */
  model?: VideoModel;
  /** 模型来源引用（用于多供应商路由） */
  modelRef?: ModelRef | null;
  /** 视频时长（秒） */
  seconds?: string;
  /** 视频尺寸 */
  size?: string;
  /** 参考图片 URL 列表 */
  referenceImages?: string[];
  /** 额外参数，透传给视频模型适配器 */
  params?: Record<string, unknown>;
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
}

/**
 * 直接调用 API 生成视频（async 模式）
 */
async function executeAsync(params: VideoGenerationParams): Promise<MCPResult> {
  const {
    prompt,
    model = 'veo3',
    modelRef,
    seconds = '8',
    size = '1280x720',
    referenceImages,
    params: extraParams,
  } = params;

  const promptError = validatePrompt(prompt);
  if (promptError) return promptError;

  try {
    const requestedModel = model as string;
    const adapter = resolveAdapterForInvocation(
      'video',
      requestedModel,
      modelRef || null
    );

    if (!adapter || adapter.kind !== 'video') {
      return {
        success: false,
        error: `未找到可用的视频适配器: ${requestedModel}`,
        type: 'error',
      };
    }

    const duration = seconds ? Number(seconds) : undefined;
    const result = await adapter.generateVideo(
      getAdapterContextFromSettings('video', modelRef || requestedModel),
      {
        prompt,
        size,
        model: requestedModel,
        modelRef: modelRef || null,
        duration: Number.isFinite(duration) ? duration : undefined,
        referenceImages,
        params: extraParams,
      }
    );

    const videoUrl = result.url;
    if (!videoUrl) {
      return {
        success: false,
        error: 'API 未返回有效的视频 URL',
        type: 'error',
      };
    }

    return {
      success: true,
      data: {
        url: videoUrl,
        format: result.format || 'mp4',
        prompt,
        model,
        seconds,
        size,
      },
      type: 'video',
    };
  } catch (error: any) {
    console.error('[VideoGenerationTool] Generation failed:', error);
    return wrapApiError(error, '视频生成失败');
  }
}

/** 视频任务队列配置 */
function getVideoQueueConfig(params: VideoGenerationParams) {
  const model = (params.model || 'veo3') as VideoModel;
  const modelConfig = VIDEO_MODEL_CONFIGS[model] || VIDEO_MODEL_CONFIGS['veo3'];
  const uploadedImages = toUploadedImages(params.referenceImages);

  return {
    taskType: TaskType.VIDEO,
    resultType: 'video' as const,
    getDefaultModel: getCurrentVideoModel,
    logPrefix: 'VideoGenerationTool',
    buildTaskPayload: () => ({
      prompt: params.prompt,
      size: params.size || '16x9',
      duration: parseInt(params.seconds || modelConfig.defaultDuration, 10),
      model,
      modelRef: params.modelRef || null,
      uploadedImages: uploadedImages && uploadedImages.length > 0 ? uploadedImages : undefined,
      referenceImages: params.referenceImages && params.referenceImages.length > 0 ? params.referenceImages : undefined,
      params: params.params,
    }),
    buildResultData: () => ({
      size: params.size || '16x9',
      duration: parseInt(params.seconds || modelConfig.defaultDuration, 10),
    }),
  };
}

/**
 * 视频生成 MCP 工具定义
 */
export const videoGenerationTool: MCPTool = {
  name: 'generate_video',
  description: `生成视频工具。根据用户的文字描述生成视频。

使用场景：
- 用户想要创建、生成视频
- 用户描述了想要的视频内容、动作、场景
- 用户提供了图片并想要将其转换为视频（图生视频）
- 用户明确提到"视频"、"动画"、"动态"等关键词

不适用场景：
- 用户想要生成静态图片（使用 generate_image 工具）
- 用户只是在聊天，没有生成视频的意图

当前使用模型：${getCurrentVideoModel()}`,

  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '视频描述提示词，详细描述想要生成的视频内容、动作、场景、风格等',
      },
      model: {
        type: 'string',
        description: `视频生成模型，默认使用 ${getDefaultVideoModel()}`,
        default: getDefaultVideoModel(),
      },
      seconds: {
        type: 'string',
        description: '视频时长（秒），不同模型支持的时长不同',
        enum: getVideoDurationOptions(),
        default: '8',
      },
      size: {
        type: 'string',
        description: '视频尺寸',
        enum: getVideoSizeOptions(),
        default: '1280x720',
      },
      referenceImages: {
        type: 'array',
        description: '参考图片 URL 列表，用于图生视频',
        items: {
          type: 'string',
        },
      },
      params: {
        type: 'object',
        description: '额外模型参数，Kling 可用字段包括 model_name、klingAction2、mode、cfg_scale、negative_prompt 与 camera_*；其中 cfg_scale 取值 0 到 1，camera_* 取值 -10 到 10 且需为整数',
        properties: {
          model_name: {
            type: 'string',
            enum: ['kling-v3', 'kling-v2-6', 'kling-v2-1', 'kling-v1-6', 'kling-v1-5'],
          },
          klingAction2: {
            type: 'string',
            enum: ['text2video', 'image2video'],
          },
          mode: {
            type: 'string',
            enum: ['std', 'pro'],
          },
          cfg_scale: {
            type: 'number',
            description: 'Kling 自由度，取值范围 0 到 1',
          },
          negative_prompt: {
            type: 'string',
          },
          camera_control_type: {
            type: 'string',
          },
          camera_horizontal: {
            type: 'number',
            description: 'Kling 水平运镜，取值范围 -10 到 10，且必须为整数',
          },
          camera_vertical: {
            type: 'number',
            description: 'Kling 垂直运镜，取值范围 -10 到 10，且必须为整数',
          },
          camera_pan: {
            type: 'number',
            description: 'Kling 水平摇镜，取值范围 -10 到 10，且必须为整数',
          },
          camera_tilt: {
            type: 'number',
            description: 'Kling 垂直摇镜，取值范围 -10 到 10，且必须为整数',
          },
          camera_roll: {
            type: 'number',
            description: 'Kling 旋转运镜，取值范围 -10 到 10，且必须为整数',
          },
          camera_zoom: {
            type: 'number',
            description: 'Kling 变焦，取值范围 -10 到 10，且必须为整数',
          },
        },
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
    whenToUse: '当用户想要生成视频、动画或动态内容时使用。适用于：将图片变成视频、创建短视频、生成动态场景等。关键词：视频、动画、动起来、动态。',

    parameterGuidance: {
      prompt: '将用户描述扩展为详细的英文视频提示词，包含：主体动作（walking, flying, spinning）、场景描述、镜头运动（camera pan, zoom in, tracking shot）、氛围（cinematic, dreamy）、时间节奏（slow motion, timelapse）。',
      model: '默认使用 veo3，支持高质量视频生成。可选其他模型如需特定效果。',
      seconds: '根据内容复杂度选择：简单动作用 5-8 秒，复杂场景用 8-10 秒。默认 8 秒。',
      size: '横屏视频用 1280x720 或 1920x1080，竖屏用 720x1280，正方形用 1024x1024。',
      referenceImages: '当用户提供图片并想让它"动起来"时使用，传入图片 URL 实现图生视频。',
      count: '用户明确要求批量生成时使用，如 "+3 生成视频" 则 count=3。',
    },

    bestPractices: [
      'prompt 使用英文能获得更好的生成效果',
      '描述具体的动作和运动，如 "a cat walking slowly" 而非 "a cat"',
      '添加镜头运动描述如 "camera slowly pans right"、"zoom in smoothly"',
      '描述氛围和风格如 "cinematic lighting"、"slow motion"、"dreamy atmosphere"',
      '对于图生视频，描述图片中元素如何运动，如 "the waves start to move"',
      '避免过于复杂的场景变化，每个视频专注一个主要动作',
    ],

    examples: [
      {
        input: '生成一个猫咪走路的视频',
        args: { prompt: 'A fluffy orange cat walking gracefully across a sunny room, soft natural lighting, camera tracking shot following the cat, gentle movements, high quality, cinematic', seconds: '8', size: '1280x720' },
      },
      {
        input: '让这张日落图片动起来',
        args: { prompt: 'Beautiful sunset scene with moving clouds drifting slowly across the sky, sun rays shifting, gentle wind effect on trees, time-lapse style, warm golden hour lighting, peaceful atmosphere', referenceImages: ['[图片1]'], seconds: '8' },
        explanation: '图生视频使用 referenceImages 传递原图，prompt 描述期望的动态效果',
      },
      {
        input: '赛博朋克城市夜景动画',
        args: { prompt: 'Cyberpunk city at night with flying cars moving through neon-lit streets, holographic advertisements flickering, rain falling, camera slowly panning across the skyline, atmospheric fog, cinematic sci-fi mood', seconds: '10', size: '1920x1080' },
      },
      {
        input: '生成一个产品旋转展示视频',
        args: { prompt: 'Product showcase video, sleek modern headphones rotating 360 degrees on a white pedestal, smooth continuous rotation, professional studio lighting, minimal clean background, commercial quality', seconds: '8', size: '1280x720' },
      },
    ],

    warnings: [
      '视频生成时间较长（通常 1-3 分钟），请耐心等待',
      '避免描述突然的场景切换或多个不连贯的动作',
      '图生视频时，确保参考图片清晰且主体明确',
    ],
  },

  execute: async (params: Record<string, unknown>, options?: MCPExecuteOptions): Promise<MCPResult> => {
    console.log('[VideoGenerationTool] execute called with mode:', options?.mode);
    const rawParams = params as unknown as VideoGenerationParams;
    const mode = options?.mode || 'async';

    // 规范化 size：将不在可用范围内的 size 自动转换为最接近的可用值
    let normalizedSize = rawParams.size;
    if (rawParams.size) {
      const model = (rawParams.model || 'veo3') as VideoModel;
      const modelConfig = VIDEO_MODEL_CONFIGS[model] || VIDEO_MODEL_CONFIGS['veo3'];
      const validSizes = modelConfig.sizeOptions.map(opt => opt.value);
      normalizedSize = normalizeToClosestVideoSize(rawParams.size, validSizes, modelConfig.defaultSize);
    }
    const typedParams: VideoGenerationParams = {
      ...rawParams,
      size: normalizedSize,
    };

    if (mode === 'queue') {
      return createQueueTask(typedParams, options || {}, getVideoQueueConfig(typedParams));
    }

    return executeAsync(typedParams);
  },
};

/**
 * 便捷方法：直接生成视频（async 模式）
 */
export async function generateVideo(params: VideoGenerationParams): Promise<MCPResult> {
  return videoGenerationTool.execute(params as unknown as Record<string, unknown>, { mode: 'async' });
}

/**
 * 便捷方法：创建视频生成任务（queue 模式）
 */
export async function createVideoTask(
  params: VideoGenerationParams,
  options?: Omit<MCPExecuteOptions, 'mode'>
): Promise<MCPTaskResult> {
  const result = await videoGenerationTool.execute(params as unknown as Record<string, unknown>, {
    ...options,
    mode: 'queue',
  });
  return result as MCPTaskResult;
}

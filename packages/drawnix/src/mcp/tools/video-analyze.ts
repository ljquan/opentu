/**
 * 视频分析 MCP 工具
 *
 * 通过 Gemini generateContent 端点分析视频内容，
 * 返回结构化的镜头拆解、脚本提取、风格分析等数据。
 *
 * 支持两种输入方式：
 * - base64 视频数据（inline_data，≤20MB）
 * - YouTube URL（file_uri）
 */

import type { MCPTool, MCPResult, MCPExecuteOptions } from '../types';
import {
  resolveInvocationRoute,
  settingsManager,
  type ModelRef,
} from '../../utils/settings-manager';
import { callGoogleGenerateContentRaw } from '../../utils/gemini-api/apiCalls';
import { validateAndEnsureConfig } from '../../utils/gemini-api/auth';
import type { GeminiConfig, GeminiMessage } from '../../utils/gemini-api/types';
import { resolveInvocationPlanFromRoute } from '../../services/provider-routing';

// ============================================================================
// 类型定义
// ============================================================================

export type VideoShotType = 'opening' | 'product' | 'detail' | 'scene' | 'cta' | 'other';

export interface VideoShot {
  id: string;
  startTime: number;
  endTime: number;
  description: string;
  type: VideoShotType;
  label: string;
  script?: string;
  visual_prompt?: string;
  video_prompt?: string;
  camera_movement?: string;
  duration?: number;
}

export interface VideoAnalysisData {
  totalDuration: number;
  productExposureDuration: number;
  productExposureRatio: number;
  shotCount: number;
  firstProductAppearance: number;
  suggestion: string;
  video_style?: string;
  bgm_mood?: string;
  aspect_ratio?: string;
  shots: VideoShot[];
}

export interface VideoAnalyzeParams {
  /** base64 视频数据（不含 data: 前缀） */
  videoData?: string;
  /** 视频 MIME 类型，默认 video/mp4 */
  mimeType?: string;
  /** YouTube URL */
  youtubeUrl?: string;
  /** 自定义分析 prompt（可选，有内置默认值） */
  prompt?: string;
  /** 模型 ID */
  model?: string;
  modelRef?: ModelRef | null;
}

// ============================================================================
// 分析 Prompt
// ============================================================================

const DEFAULT_ANALYSIS_PROMPT = `请逐帧分析这个视频，并提供结构化的拆解。
我需要一个包含以下字段的JSON响应：
- totalDuration: 视频总时长（秒）
- productExposureDuration: 产品露出时长（秒）
- productExposureRatio: 产品露出占比（0-100）
- shotCount: 镜头总数
- firstProductAppearance: 产品首次出现的时间（秒）
- aspect_ratio: 视频画面比例，从以下选项中选择最接近的：'16x9'（横屏）、'9x16'（竖屏）、'1x1'（方形）
- video_style: 整体视频风格（中文）。描述光影、色调、美术风格。
- bgm_mood: 背景音乐情绪（中文）。
- suggestion: 优化建议（中文）
- shots: 镜头详细信息数组，每个对象包含：
  - id: 唯一标识符
  - startTime: 开始时间（秒）
  - endTime: 结束时间（秒）
  - duration: 该镜头时长（秒），等于 endTime - startTime
  - description: 画面描述（中文），包含视觉主体、动作/状态、场景环境、屏幕文字
  - visual_prompt: AI绘画提示词（英文），用于Midjourney/Stable Diffusion生成类似画面的静态图
  - video_prompt: AI视频生成提示词（英文），用于生成该镜头的动态视频。描述主体动作、运镜方式（如 camera slowly pans right）、节奏感（如 slow motion）、氛围（如 cinematic）。与 visual_prompt 的区别是要强调动态和时间维度。
  - camera_movement: 运镜方式（中文）
  - type: 'opening' | 'product' | 'detail' | 'scene' | 'cta'
  - label: 中文标签（例如"开场口播"、"产品展示"）
  - script: 口播文案/旁白，无对白设为空字符串

只返回有效的JSON对象，不要包含markdown格式。`;

// ============================================================================
// 执行逻辑
// ============================================================================

/**
 * 构建强制走 generateContent 协议的 GeminiConfig
 *
 * 视频分析必须走 /v1beta/models/{model}:generateContent 端点，
 * 因为 /chat/completions 不支持 file_uri 和视频 inline_data。
 * 需要将用户配置的 baseUrl（如 https://api.tu-zi.com/v1）
 * 通过 baseUrlStrategy: 'trim-v1' 去掉末尾 /v1。
 */
async function buildGenerateContentConfig(
  model?: string,
  modelRef?: ModelRef | null
): Promise<GeminiConfig> {
  await settingsManager.waitForInitialization();

  const routeModel = modelRef || model || null;
  const route = resolveInvocationRoute('text', routeModel);
  const plan = resolveInvocationPlanFromRoute('text', routeModel);

  const config: GeminiConfig = {
    apiKey: route.apiKey,
    baseUrl: route.baseUrl,
    modelName: model || route.modelId || 'gemini-2.5-flash',
    authType: plan?.provider.authType || 'bearer',
    providerType: plan?.provider.providerType || 'custom',
    extraHeaders: plan?.provider.extraHeaders,
    protocol: 'google.generateContent',
    binding: {
      ...(plan?.binding || {}),
      protocol: 'google.generateContent',
      baseUrlStrategy: 'trim-v1',
      submitPath: undefined, // 强制使用默认的 /v1beta/models/{model}:generateContent
    } as any,
    provider: plan?.provider || null,
  };

  return validateAndEnsureConfig(config);
}

/**
 * 从文本中提取所有顶层 JSON 对象（括号平衡法）
 * 处理 API 返回多个 JSON 拼接的情况
 */
function extractJsonObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return results;
}

async function executeAnalysis(params: VideoAnalyzeParams): Promise<MCPResult> {
  const { videoData, mimeType, youtubeUrl, prompt, model, modelRef } = params;

  if (!videoData && !youtubeUrl) {
    return {
      success: false,
      error: '需要提供 videoData 或 youtubeUrl',
      type: 'error',
    };
  }

  try {
    const analysisPrompt = prompt || DEFAULT_ANALYSIS_PROMPT;

    // 构建消息：分析 prompt + 视频输入
    const messages: GeminiMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: analysisPrompt },
          videoData
            ? { type: 'inline_data', mimeType: mimeType || 'video/mp4', data: videoData }
            : { type: 'file_uri', fileUri: youtubeUrl! },
        ],
      },
    ];

    // 强制走 generateContent 协议（/v1beta/models/{model}:generateContent）
    const config = await buildGenerateContentConfig(model, modelRef);
    const response = await callGoogleGenerateContentRaw(config, messages, {
      stream: false,
    });

    // 从响应中提取文本
    const text = response.choices?.[0]?.message?.content;
    if (!text) {
      return { success: false, error: 'API 未返回有效响应', type: 'error' };
    }

    // 提取 JSON — 响应可能包含多个 JSON 对象拼接（如空结果+有效结果）
    // 用括号平衡法逐个提取顶层 JSON 对象
    const jsonObjects = extractJsonObjects(text);
    if (jsonObjects.length === 0) {
      return { success: false, error: '响应中未找到有效 JSON', type: 'error' };
    }

    // 取 shots 数量最多的作为有效结果
    let analysis: VideoAnalysisData | null = null;
    for (const jsonStr of jsonObjects) {
      try {
        const parsed = JSON.parse(jsonStr) as VideoAnalysisData;
        if (parsed.shots && (!analysis || parsed.shots.length > analysis.shots.length)) {
          analysis = parsed;
        }
      } catch {
        // 跳过无法解析的片段
      }
    }

    if (!analysis) {
      return { success: false, error: '响应中未找到有效的分析数据', type: 'error' };
    }

    return {
      success: true,
      data: { analysis },
      type: 'text',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || '视频分析失败',
      type: 'error',
    };
  }
}

// ============================================================================
// MCP 工具定义
// ============================================================================

export const videoAnalyzeTool: MCPTool = {
  name: 'video_analyze',
  description: '分析视频内容，返回结构化的镜头拆解、脚本提取、风格分析等数据',
  supportedModes: ['async'],

  inputSchema: {
    type: 'object',
    properties: {
      videoData: {
        type: 'string',
        description: 'base64 编码的视频数据（不含 data: 前缀），≤20MB',
      },
      mimeType: {
        type: 'string',
        description: '视频 MIME 类型，默认 video/mp4',
        default: 'video/mp4',
      },
      youtubeUrl: {
        type: 'string',
        description: 'YouTube 视频 URL',
      },
      prompt: {
        type: 'string',
        description: '自定义分析 prompt（可选，有内置默认值）',
      },
      model: {
        type: 'string',
        description: '模型 ID，默认使用当前文本模型',
      },
    },
    required: [],
  },

  execute: async (
    params: Record<string, unknown>,
    _options?: MCPExecuteOptions
  ): Promise<MCPResult> => {
    return executeAnalysis(params as unknown as VideoAnalyzeParams);
  },
};

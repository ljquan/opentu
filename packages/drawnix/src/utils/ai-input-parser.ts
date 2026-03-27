/**
 * AI 输入解析工具
 *
 * 解析 AI 输入框的内容，判断发送场景：
 * 1. 只有选择元素，没有输入文字 -> 直接生成
 * 2. 输入内容有模型、参数 -> 解析后直接生成
 * 3. 输入内容指定了数量 -> 按数量生成
 * 4. 输入内容包含其他内容 -> 走 Agent 流程
 */

import { geminiSettings, type ModelRef } from './settings-manager';
import {
  getModelConfig,
  getImageModelDefaults,
  getDefaultImageModel as getSystemDefaultImageModel,
  getDefaultVideoModel as getSystemDefaultVideoModel,
} from '../constants/model-config';
import { getEffectiveVideoDefaultParams } from '../services/video-binding-utils';
import { buildMJPromptSuffix } from './mj-params';
import type { ImageDimensions } from '../mcp/types';

// 重新导出 ImageDimensions 以便其他模块使用
export type { ImageDimensions } from '../mcp/types';

/**
 * 解析结果类型（简化版，现在参数通过下拉菜单选择）
 */
export interface ParseResult {
  /** 清理后的文本（移除特殊标记后） */
  cleanText: string;
  /** 选中的图片模型 */
  selectedImageModel: string | null;
  /** 选中的视频模型 */
  selectedVideoModel: string | null;
  /** 选中的参数列表 */
  selectedParams: Array<{ id: string; value: string }>;
  /** 选中的数量 */
  selectedCount: number | null;
}

/**
 * 简化的输入解析函数
 * 现在模型/参数/数量都通过下拉菜单选择，不再从文本中解析
 */
function parseInput(text: string): ParseResult {
  return {
    cleanText: text,
    selectedImageModel: null,
    selectedVideoModel: null,
    selectedParams: [],
    selectedCount: null,
  };
}

/**
 * 发送场景类型
 */
export type SendScenario =
  | 'direct_generation' // 场景1-3: 直接生成（无额外内容）
  | 'agent_flow'; // 场景4: Agent 流程（有额外内容）

/**
 * 生成类型
 */
export type GenerationType = 'image' | 'video' | 'text';

/**
 * 带尺寸信息的图片
 */
export interface ImageWithDimensions {
  url: string;
  dimensions?: ImageDimensions;
}

/**
 * 选中元素的分类信息
 */
export interface SelectionInfo {
  /** 选中的文本内容（作为生成 prompt） */
  texts: string[];
  /** 选中的图片 URL */
  images: string[];
  /** 选中的视频 URL */
  videos: string[];
  /** 选中的图形转换为的图片 URL */
  graphics: string[];
  /** 图片尺寸信息（按顺序对应 images + graphics） */
  imageDimensions?: ImageDimensions[];
}

/**
 * 解析后的生成参数
 */
export interface ParsedGenerationParams {
  /** 发送场景 */
  scenario: SendScenario;
  /** 生成类型 */
  generationType: GenerationType;
  /** 使用的模型 ID */
  modelId: string;
  /** 使用的模型来源引用 */
  modelRef?: ModelRef | null;
  /** 是否为用户显式选择的模型 */
  isModelExplicit: boolean;
  /** 最终生成用的提示词（选中文本 + 默认 prompt） */
  prompt: string;
  /** 用户在输入框输入的指令（去除模型/参数/数量后的纯文本） */
  userInstruction: string;
  /** 原始输入文本 */
  rawInput: string;
  /** 生成数量 */
  count: number;
  /** 尺寸参数（如 '16x9', '1x1'） */
  size?: string;
  /** 时长参数（视频） */
  duration?: string;
  /** 额外参数（如 seedream_quality, aspect_ratio 等，透传给 adapter） */
  extraParams?: Record<string, string>;
  /** 原始解析结果 */
  parseResult: ParseResult;
  /** 是否有额外内容（除模型/参数/数量外） */
  hasExtraContent: boolean;
  /** 选中元素的分类信息 */
  selection: SelectionInfo;
}

/**
 * 获取默认图片模型
 */
function getDefaultImageModel(): string {
  const settings = geminiSettings.get();
  return settings?.imageModelName || getSystemDefaultImageModel();
}

/**
 * 获取默认视频模型
 */
function getDefaultVideoModel(): string {
  const settings = geminiSettings.get();
  return settings?.videoModelName || getSystemDefaultVideoModel();
}

/**
 * 获取默认文本模型
 */
function getDefaultTextModel(): string {
  const settings = geminiSettings.get();
  return settings?.textModelName || 'deepseek-v3.2';
}

/**
 * 生成默认提示词
 *
 * @param hasSelectedElements 是否有选中元素
 * @param selectedTexts 选中的文字内容数组
 * @param imageCount 选中的图片数量
 */
export function generateDefaultPrompt(
  hasSelectedElements: boolean,
  selectedTexts: string[],
  imageCount: number
): string {
  // 如果有选中的文字，合并作为 prompt
  if (selectedTexts.length > 0) {
    return selectedTexts.join('\n');
  }

  // 如果没有文字，根据图片数量生成默认 prompt
  if (hasSelectedElements) {
    if (imageCount === 1) {
      return '请仔细分析这张图片的内容、风格、构图、色调和艺术特点，推测生成这张图片可能使用的原始提示词，然后基于你推测的提示词重新生成一张全新的、风格相似但内容不完全相同的图片。不要直接复制原图。';
    } else if (imageCount > 1) {
      return '请分析这些图片的主题、风格和视觉元素，找出它们之间的共同点或关联性，然后创造性地将它们融合成一张全新的、和谐统一的图片。融合时请保持各图片的精华元素，确保最终作品在构图、色调和风格上协调一致。';
    }
  }

  return '';
}

/**
 * 标准化尺寸字符串
 * 将 "16:9" 转换为 "16x9" 格式（API 使用 x 分隔符）
 */
function normalizeSize(size: string): string {
  return size.replace(':', 'x').toLowerCase();
}

/**
 * 解析 AI 输入内容
 *
 * @param inputText 输入框文本
 * @param selection 选中元素的分类信息
 */
/**
 * parseAIInput 的选项参数
 */
export interface ParseAIInputOptions {
  /** 指定使用的模型 ID（来自下拉选择器） */
  modelId?: string;
  /** 指定使用的模型引用（来自供应商感知的选择器） */
  modelRef?: ModelRef | null;
  /** 指定使用的尺寸（来自尺寸选择器，'auto' 表示不传尺寸参数） */
  size?: string;
  /** 指定生成类型（来自下拉选择器） */
  generationType?: GenerationType;
  /** 指定生成数量（来自下拉选择器） */
  count?: number;
  /** 指定其他参数（如 duration 等） */
  params?: Record<string, string>;
}

export function parseAIInput(
  inputText: string,
  selection: SelectionInfo,
  options?: ParseAIInputOptions
): ParsedGenerationParams {
  const hasSelectedElements =
    selection.texts.length > 0 ||
    selection.images.length > 0 ||
    selection.videos.length > 0 ||
    selection.graphics.length > 0;
  const selectedTexts = selection.texts;
  const imageCount = selection.images.length + selection.graphics.length;
  // 使用现有的 parseInput 函数解析输入
  const parseResult = parseInput(inputText);

  // 判断是否有额外内容（除了模型/参数/数量标记外的文字）
  const hasExtraContent = parseResult.cleanText.trim().length > 0;

  // 确定生成类型和模型
  let generationType: GenerationType = options?.generationType || 'image';
  let modelId: string;
  let isModelExplicit = false;

  // 优先使用 options 中传入的模型（来自下拉选择器）
  if (options?.modelId) {
    const modelConfig = getModelConfig(options.modelId);
    // 如果没有显式指定 generationType，则根据模型 ID 推断
    if (!options.generationType) {
      if (modelConfig?.type === 'video') {
        generationType = 'video';
      } else if (modelConfig?.type === 'text') {
        generationType = 'text';
      } else {
        generationType = 'image';
      }
    }
    modelId = options.modelId;
    isModelExplicit = true;
  } else if (parseResult.selectedVideoModel) {
    // 如果明确选择了视频模型，生成视频
    generationType = 'video';
    modelId = parseResult.selectedVideoModel;
    isModelExplicit = true;
  } else if (parseResult.selectedImageModel) {
    // 如果选择了图片模型，生成图片
    generationType = 'image';
    modelId = parseResult.selectedImageModel;
    isModelExplicit = true;
  } else if (
    !hasSelectedElements &&
    hasExtraContent &&
    !options?.generationType
  ) {
    // 没有选中元素、只有文字输入时，默认使用文本模型（Agent 流程）
    generationType = 'text';
    modelId = getDefaultTextModel();
  } else {
    // 有选中元素但没指定模型时，默认使用图片模型
    if (generationType === 'video') {
      modelId = getDefaultVideoModel();
    } else if (generationType === 'text') {
      modelId = getDefaultTextModel();
    } else {
      modelId = getDefaultImageModel();
    }
  }

  // 确定发送场景
  // 如果显式指定了图片或视频生成类型，强制走 direct_generation
  let scenario: SendScenario;
  if (
    options?.generationType === 'image' ||
    options?.generationType === 'video'
  ) {
    scenario = 'direct_generation';
  } else {
    scenario = hasExtraContent ? 'agent_flow' : 'direct_generation';
  }

  // 生成提示词：整合选中的文本元素内容和用户输入
  const userInput = parseResult.cleanText.trim();
  const selectedTextContent = selectedTexts.join('\n').trim();

  let prompt: string;
  if (selectedTextContent && userInput) {
    // 同时有选中文本和用户输入：合并（选中文本在前，用户输入在后）
    prompt = `${selectedTextContent}\n\n${userInput}`;
  } else if (userInput) {
    // 只有用户输入
    prompt = userInput;
  } else if (selectedTextContent) {
    // 只有选中文本
    prompt = selectedTextContent;
  } else if (hasSelectedElements && imageCount > 0) {
    // 只有图片，生成默认提示词
    prompt = generateDefaultPrompt(hasSelectedElements, [], imageCount);
  } else {
    prompt = '';
  }

  // Midjourney: append prompt parameters from dropdown
  if (modelId.startsWith('mj') && options?.params) {
    const suffix = buildMJPromptSuffix(options.params);
    if (suffix) {
      prompt = [prompt, suffix].filter(Boolean).join(' ');
    }
  }

  // 获取数量（优先级：options.count > parseResult.selectedCount > 1）
  const count = options?.count || parseResult.selectedCount || 1;

  // 解析参数
  let size: string | undefined;
  let duration: string | undefined;

  // 1. 优先从 options.params 中读取（新逻辑，支持多参数对象）
  // 收集额外参数（非 size/duration 的自定义参数，如 seedream_quality, aspect_ratio）
  let extraParams: Record<string, string> | undefined;
  if (options?.params) {
    if (!modelId.startsWith('mj') && options.params.size) {
      size = normalizeSize(options.params.size);
    }
    if (options.params.duration) duration = options.params.duration;

    // 收集非 size/duration 的额外参数
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.params)) {
      if (key !== 'size' && key !== 'duration' && value) {
        extra[key] = value;
      }
    }
    if (Object.keys(extra).length > 0) {
      extraParams = extra;
    }
  }

  // 2. 兼容旧逻辑：options.size（来自单独的 size 参数）
  if (!size && options?.size && options.size !== 'auto') {
    size = normalizeSize(options.size);
  }

  // 3. 从提示词中解析 -size=xxx 或 -duration=xxx
  if (!size && options?.size !== 'auto') {
    for (const param of parseResult.selectedParams) {
      if (param.id === 'size') {
        size = normalizeSize(param.value);
        break;
      }
    }
  }

  if (!duration) {
    for (const param of parseResult.selectedParams) {
      if (param.id === 'duration') {
        duration = param.value;
        break;
      }
    }
  }

  // 如果没有指定尺寸且不是 auto 模式，使用模型默认值（文本模型不需要这些参数）
  if (!size && options?.size !== 'auto' && generationType !== 'text') {
    const modelConfig = getModelConfig(modelId);
    if (modelConfig?.type === 'image' && modelConfig.imageDefaults) {
      // 图片模型使用默认尺寸
      size = '1x1'; // 默认正方形
    } else if (modelConfig?.type === 'video' && modelConfig.videoDefaults) {
      const defaults = getEffectiveVideoDefaultParams(
        modelId,
        options?.modelRef || modelId,
        options?.params
      );
      size = normalizeSize(defaults.size || modelConfig.videoDefaults.size);
      if (!duration) {
        duration = defaults.duration || modelConfig.videoDefaults.duration;
      }
    } else {
      // 使用通用默认值
      if (generationType === 'image') {
        size = '1x1';
      } else if (generationType === 'video') {
        const defaults = getEffectiveVideoDefaultParams(
          modelId,
          options?.modelRef || modelId,
          options?.params
        );
        size = normalizeSize(defaults.size);
        if (!duration) {
          duration = defaults.duration;
        }
      }
    }
  }

  // 视频模型：如果没有指定时长，使用默认值
  if (!duration && generationType === 'video') {
    const defaults = getEffectiveVideoDefaultParams(
      modelId,
      options?.modelRef || modelId,
      options?.params
    );
    duration = defaults.duration;
  }

  // 用户指令（去除模型/参数/数量后的纯文本）
  const userInstruction = parseResult.cleanText.trim();

  return {
    scenario,
    generationType,
    modelId,
    modelRef: options?.modelRef || null,
    isModelExplicit,
    prompt,
    userInstruction,
    rawInput: inputText,
    count,
    size,
    duration,
    extraParams,
    parseResult,
    hasExtraContent,
    selection,
  };
}

/**
 * 检查是否应该走 Agent 流程
 *
 * 场景4的判断条件：输入内容除了选择模型、参数、数量外，还包含了其他内容
 */
export function shouldUseAgentFlow(inputText: string): boolean {
  const parseResult = parseInput(inputText);
  return parseResult.cleanText.trim().length > 0;
}

/**
 * 灵感图生成服务
 *
 * 生成创意灵感图：调用图片生成 API → 不规则分割 → 散落布局插入画布
 */

import type { MCPExecuteOptions, MCPTaskResult } from '../../mcp/types';
import { INSPIRATION_BOARD_DEFAULTS, INSPIRATION_BOARD_PROMPT_TEMPLATE } from '../../types/photo-wall.types';
import { taskQueueService } from '../task-queue';
import { TaskType } from '../../types/task.types';
import { geminiSettings } from '../../utils/settings-manager';
import { getDefaultImageModel } from '../../constants/model-config';
import { getPreferredModels } from '../../utils/runtime-model-discovery';

/**
 * 灵感图参数
 */
export interface InspirationBoardParams {
  /** 主题描述 */
  theme: string;
  /** 图片数量（1-16，默认 9） */
  imageCount?: number;
  /** 图片尺寸比例（默认 16x9 横向） */
  imageSize?: string;
  /** 图片质量（默认 2k） */
  imageQuality?: '1k' | '2k' | '4k';
  /** 参考图片 URL 列表 */
  referenceImages?: string[];
  /** AI 模型 */
  model?: string;
}

/**
 * 获取当前图片模型
 */
function getCurrentImageModel(): string {
  const settings = geminiSettings.get();
  return settings.imageModelName || getPreferredModels('image')[0]?.id || getDefaultImageModel();
}

/**
 * 构建灵感图生图提示词
 */
function buildInspirationBoardPrompt(theme: string, imageCount: number): string {
  const template = INSPIRATION_BOARD_PROMPT_TEMPLATE.zh;
  return template(theme, imageCount);
}

/**
 * 创建灵感图任务
 */
export function createInspirationBoardTask(
  params: InspirationBoardParams,
  options?: Omit<MCPExecuteOptions, 'mode'>
): MCPTaskResult {
  const {
    theme,
    imageCount = INSPIRATION_BOARD_DEFAULTS.imageCount,
    imageSize = '16x9',
    referenceImages,
    model,
  } = params;

  if (!theme || typeof theme !== 'string') {
    return {
      success: false,
      error: '缺少必填参数 theme（主题描述）',
      type: 'error',
    };
  }

  // 验证参数范围
  const validImageCount = Math.min(Math.max(1, imageCount), 16);

  // 构建生图提示词
  const prompt = buildInspirationBoardPrompt(theme, validImageCount);

  // 确定使用的模型
  const actualModel = model || getCurrentImageModel();

  // 将参考图片转换为 uploadedImages 格式
  const uploadedImages = referenceImages?.map((url, index) => ({
    type: 'url' as const,
    url,
    name: `reference-${index + 1}`,
  }));

  try {
    let task;

    // 如果是重试，复用原有任务
    if (options?.retryTaskId) {
      taskQueueService.retryTask(options.retryTaskId);
      task = taskQueueService.getTask(options.retryTaskId);
      if (!task) {
        throw new Error(`重试任务不存在: ${options.retryTaskId}`);
      }
    } else {
      // 创建灵感图任务
      task = taskQueueService.createTask(
        {
          prompt,
          size: imageSize,
          model: actualModel,
          uploadedImages: uploadedImages && uploadedImages.length > 0 ? uploadedImages : undefined,
          // 灵感图特有参数
          isInspirationBoard: true,
          inspirationBoardImageCount: validImageCount,
          inspirationBoardLayoutStyle: 'inspiration-board',
          originalTheme: theme,
          batchId: options?.batchId,
          globalIndex: options?.globalIndex || 1,
          // 自动插入画布
          autoInsertToCanvas: true,
        },
        TaskType.IMAGE
      );
    }

    return {
      success: true,
      data: {
        taskId: task.id,
        theme,
        imageCount: validImageCount,
        prompt: prompt.substring(0, 100) + '...',
      },
      type: 'image',
      taskId: task.id,
      task,
    };
  } catch (error: any) {
    console.error('[InspirationBoard] Failed to create task:', error);

    return {
      success: false,
      error: error.message || '创建灵感图任务失败',
      type: 'error',
    };
  }
}

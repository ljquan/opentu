/**
 * 宫格图生成服务
 *
 * 创建宫格图任务：调用图片生成 API → 任务完成后分割 → 布局计算 → 批量插入画板
 */

import type { MCPExecuteOptions, MCPTaskResult } from '../../mcp/types';
import type { LayoutStyle, GridConfig } from '../../types/photo-wall.types';
import { GRID_IMAGE_DEFAULTS, GRID_IMAGE_PROMPT_TEMPLATE } from '../../types/photo-wall.types';
import { taskQueueService } from '../task-queue';
import { TaskType } from '../../types/task.types';
import { geminiSettings } from '../../utils/settings-manager';
import { getDefaultImageModel } from '../../constants/model-config';
import { getPreferredModels } from '../../utils/runtime-model-discovery';

/**
 * 宫格图参数
 */
export interface GridImageParams {
  /** 主题描述 */
  theme: string;
  /** 网格行数（默认 3） */
  rows?: number;
  /** 网格列数（默认 3） */
  cols?: number;
  /** 布局风格（默认散落） */
  layoutStyle?: LayoutStyle;
  /** 图片尺寸（默认 1x1） */
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
 * 构建宫格图生图提示词
 */
function buildGridImagePrompt(theme: string, gridConfig: GridConfig): string {
  const template = GRID_IMAGE_PROMPT_TEMPLATE.zh;
  return template(theme, gridConfig.rows, gridConfig.cols);
}

/**
 * 创建宫格图任务
 */
export function createGridImageTask(
  params: GridImageParams,
  options?: Omit<MCPExecuteOptions, 'mode'>
): MCPTaskResult {
  const {
    theme,
    rows = GRID_IMAGE_DEFAULTS.gridConfig.rows,
    cols = GRID_IMAGE_DEFAULTS.gridConfig.cols,
    layoutStyle = GRID_IMAGE_DEFAULTS.layoutStyle,
    imageSize = GRID_IMAGE_DEFAULTS.imageSize,
    referenceImages,
    model,
  } = params;

  // 获取实际使用的模型
  const actualModel = model || getCurrentImageModel();

  if (!theme || typeof theme !== 'string') {
    return {
      success: false,
      error: '缺少必填参数 theme（主题描述）',
      type: 'error',
    };
  }

  // 验证参数范围
  const validRows = Math.min(Math.max(2, rows), 5);
  const validCols = Math.min(Math.max(2, cols), 5);

  const gridConfig: GridConfig = { rows: validRows, cols: validCols };

  // 构建生图提示词
  const prompt = buildGridImagePrompt(theme, gridConfig);

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
      // 创建宫格图任务
      task = taskQueueService.createTask(
        {
          prompt,
          size: imageSize,
          model: actualModel,
          uploadedImages: uploadedImages && uploadedImages.length > 0 ? uploadedImages : undefined,
          // 宫格图特有参数
          gridImageRows: validRows,
          gridImageCols: validCols,
          gridImageLayoutStyle: layoutStyle as 'scattered' | 'grid' | 'circular',
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
        gridConfig,
        layoutStyle,
        prompt: prompt.substring(0, 100) + '...',
      },
      type: 'image',
      taskId: task.id,
      task,
    };
  } catch (error: any) {
    console.error('[GridImage] Failed to create task:', error);

    return {
      success: false,
      error: error.message || '创建宫格图任务失败',
      type: 'error',
    };
  }
}

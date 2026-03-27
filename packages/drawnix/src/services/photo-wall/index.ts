/**
 * GridImageService - 宫格图主服务
 *
 * 串联生图、分割、布局、插入的完整流程
 */

import { PlaitBoard, Point } from '@plait/core';
import { DrawTransforms } from '@plait/draw';
import { gridSplitter } from './grid-splitter';
import { layoutEngine } from './layout-engine';
import type {
  GridImageParams,
  GridImageResult,
  PositionedElement,
  GridConfig,
  LayoutStyle,
  LayoutParams,
  GRID_IMAGE_DEFAULTS,
} from '../../types/photo-wall.types';
import { GRID_IMAGE_PROMPT_TEMPLATE, GRID_IMAGE_DEFAULTS as DEFAULTS } from '../../types/photo-wall.types';
import { defaultGeminiClient } from '../../utils/gemini-api';
import { unifiedCacheService } from '../unified-cache-service';
import { getInsertionPointBelowBottommostElement } from '../../utils/selection-utils';
import { normalizeImageDataUrl } from '@aitu/utils';

/**
 * GridImageService 类
 *
 * 宫格图功能的核心服务，协调生图、分割、布局流程
 */
export class GridImageService {
  private board: PlaitBoard | null = null;
  
  /**
   * 设置画板引用
   */
  setBoard(board: PlaitBoard | null): void {
    this.board = board;
  }
  
  /**
   * 获取画板引用
   */
  getBoard(): PlaitBoard | null {
    return this.board;
  }
  
  /**
   * 生成宫格图
   *
   * @param params - 宫格图参数
   * @returns 生成结果
   */
  async generate(params: GridImageParams): Promise<GridImageResult> {
    const {
      theme,
      gridConfig = DEFAULTS.gridConfig,
      layoutStyle = DEFAULTS.layoutStyle,
      imageSize = DEFAULTS.imageSize,
      imageQuality = DEFAULTS.imageQuality,
    } = params;

    // console.log('[GridImageService] Starting generation with params:', params);

    try {
      // 1. 生成拼贴图提示词
      const prompt = this.buildPrompt(theme, gridConfig);
      // console.log('[GridImageService] Generated prompt:', prompt);
      
      // 2. 调用 AI 生成拼贴图
      // console.log('[GridImageService] Calling AI to generate collage image...');
      const imageResult = await defaultGeminiClient.generateImage(prompt, {
        size: imageSize,
        quality: imageQuality,
        response_format: 'url',
      });
      
      if (!imageResult.data || imageResult.data.length === 0) {
        throw new Error('AI 生成图片失败：未返回图片数据');
      }
      
      const rawImageUrl = imageResult.data[0].url || imageResult.data[0].b64_json;
      const originalImageUrl = rawImageUrl
        ? normalizeImageDataUrl(String(rawImageUrl))
        : rawImageUrl;
      if (!originalImageUrl) {
        throw new Error('AI 生成图片失败：未返回图片 URL');
      }
      
      // console.log('[GridImageService] Got original image URL');
      
      // 3. 将图片转换为 base64（确保可以被 Canvas 处理）
      const imageData = await unifiedCacheService.getImageForAI(originalImageUrl);
      const imageDataUrl = imageData.type === 'base64' ? imageData.value : originalImageUrl;
      
      // 4. 分割图片
      // console.log('[GridImageService] Splitting image into grid...');
      const splitElements = await gridSplitter.split(imageDataUrl, gridConfig);
      // console.log(`[GridImageService] Split into ${splitElements.length} elements`);
      
      // 5. 计算布局
      const layoutParams = this.calculateLayoutParams(splitElements);
      // console.log('[GridImageService] Calculating layout with style:', layoutStyle);
      
      const positionedElements = layoutEngine.calculate(
        splitElements,
        layoutStyle,
        layoutParams
      );
      
      //       // console.log('[GridImageService] Layout calculated, ready to insert');

      return {
        success: true,
        originalImageUrl,
        elements: positionedElements,
      };
    } catch (error: any) {
      console.error('[GridImageService] Generation failed:', error);
      return {
        success: false,
        error: error.message || '宫格图生成失败',
      };
    }
  }
  
  /**
   * 处理已有图片：分割和布局
   * 用于任务完成后的后处理，避免重新生成图片
   *
   * @param imageUrl - 已生成的拼贴图 URL
   * @param gridConfig - 网格配置
   * @param layoutStyle - 布局风格
   * @returns 处理结果
   */
  async processExistingImage(
    imageUrl: string,
    gridConfig: GridConfig,
    layoutStyle: LayoutStyle = 'scattered'
  ): Promise<GridImageResult> {
    // console.log('[GridImageService] Processing existing image with config:', { gridConfig, layoutStyle });

    try {
      // 1. 将图片转换为 base64（确保可以被 Canvas 处理）
      const imageData = await unifiedCacheService.getImageForAI(imageUrl);
      const imageDataUrl = imageData.type === 'base64' ? imageData.value : imageUrl;

      // 2. 分割图片
      // console.log('[GridImageService] Splitting image into grid...');
      const splitElements = await gridSplitter.split(imageDataUrl, gridConfig);
      // console.log(`[GridImageService] Split into ${splitElements.length} elements`);

      // 3. 计算布局
      const layoutParams = this.calculateLayoutParams(splitElements);
      // console.log('[GridImageService] Calculating layout with style:', layoutStyle);

      const positionedElements = layoutEngine.calculate(
        splitElements,
        layoutStyle,
        layoutParams
      );

      // console.log('[GridImageService] Layout calculated, ready to insert');

      return {
        success: true,
        originalImageUrl: imageUrl,
        elements: positionedElements,
      };
    } catch (error: any) {
      console.error('[GridImageService] Processing failed:', error);
      return {
        success: false,
        error: error.message || '宫格图处理失败',
      };
    }
  }

  /**
   * 将宫格图元素插入画板
   *
   * @param elements - 带位置信息的元素数组
   * @param startPoint - 起始位置（可选）
   */
  async insertToBoard(
    elements: PositionedElement[],
    startPoint?: Point
  ): Promise<void> {
    if (!this.board) {
      throw new Error('画板未初始化，请先调用 setBoard');
    }
    
    // 计算插入基准点
    let baseX = startPoint?.[0] ?? 100;
    let baseY = startPoint?.[1];
    
    if (baseY === undefined) {
      // 获取画板最底部元素下方的位置
      const bottomPoint = getInsertionPointBelowBottommostElement(this.board, 800);
      baseY = bottomPoint?.[1] ?? 100;
      baseX = bottomPoint?.[0] ?? baseX;
    }
    
    // console.log(`[GridImageService] Inserting ${elements.length} elements at (${baseX}, ${baseY})`);
    
    // 按 zIndex 排序，确保正确的层叠顺序
    const sortedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex);
    
    // 逐个插入元素
    for (const element of sortedElements) {
      const insertX = baseX + element.x;
      const insertY = baseY + element.y;
      
      // 构建图片项
      const imageItem = {
        url: element.imageData,
        width: element.width * element.scale,
        height: element.height * element.scale,
      };
      
      // 插入图片
      // 注意：Plait 框架目前不直接支持旋转，旋转效果需要通过 CSS 或后续扩展实现
      DrawTransforms.insertImage(
        this.board,
        imageItem,
        [insertX, insertY] as Point
      );
    }
    
    // console.log('[GridImageService] All elements inserted successfully');
  }
  
  /**
   * 一键生成并插入宫格图
   * 
   * @param params - 宫格图参数
   * @param startPoint - 起始位置
   */
  async generateAndInsert(
    params: GridImageParams,
    startPoint?: Point
  ): Promise<GridImageResult> {
    const result = await this.generate(params);
    
    if (result.success && result.elements) {
      await this.insertToBoard(result.elements, startPoint);
    }
    
    return result;
  }
  
  /**
   * 构建生图提示词
   */
  private buildPrompt(theme: string, gridConfig: GridConfig): string {
    const template = GRID_IMAGE_PROMPT_TEMPLATE.zh;
    return template(theme, gridConfig.rows, gridConfig.cols);
  }
  
  /**
   * 计算布局参数
   */
  private calculateLayoutParams(elements: PositionedElement[] | { width: number; height: number }[]): LayoutParams {
    // 计算所有元素的总尺寸
    const totalWidth = elements.reduce((sum, e) => sum + e.width, 0);
    const totalHeight = elements.reduce((sum, e) => sum + e.height, 0);
    
    // 估算合理的画布尺寸
    const count = elements.length;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    
    const avgWidth = totalWidth / count;
    const avgHeight = totalHeight / count;
    
    // 画布尺寸 = 网格尺寸 + 间距 + 边距
    const gap = 30;
    const padding = 50;
    
    const canvasWidth = cols * avgWidth + (cols + 1) * gap + padding * 2;
    const canvasHeight = rows * avgHeight + (rows + 1) * gap + padding * 2;
    
    return {
      canvasWidth,
      canvasHeight,
      startX: 0,
      startY: 0,
      gap,
    };
  }
}

/**
 * 默认的 GridImageService 实例
 */
export const gridImageService = new GridImageService();

// 导出子模块
export { gridSplitter, GridSplitter } from './grid-splitter';
export { layoutEngine, LayoutEngine } from './layout-engine';

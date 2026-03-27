/**
 * SW Capabilities Handler
 *
 * Executes delegated operations from Service Worker.
 * Each operation handler is responsible for DOM/Board operations
 * that cannot run in the SW context.
 */

import type { PlaitBoard, Point } from '@plait/core';
import { getRectangleByElements, WritableClipboardOperationType, BoardTransforms, PlaitBoard as PlaitBoardUtils, getViewportOrigination } from '@plait/core';
import { DrawTransforms } from '@plait/draw';
import type {
  DelegatedOperation,
  CapabilityResult,
  CanvasInsertParams,
  MermaidParams,
  MindmapParams,
  SvgParams,
  GridImageParams,
  InspirationBoardParams,
  SplitImageParams,
  LongVideoParams,
  AIAnalyzeParams,
  ImageGenerationParams,
  VideoGenerationParams,
} from './types';
import { insertImageFromUrl } from '../../data/image';
import { insertVideoFromUrl } from '../../data/video';
import { scrollToPointIfNeeded } from '../../utils/selection-utils';
import { WorkZoneTransforms } from '../../plugins/with-workzone';
import type { PlaitWorkZone } from '../../types/workzone.types';

/**
 * Board reference holder
 */
let boardRef: PlaitBoard | null = null;

/**
 * Set board reference
 */
export function setCapabilitiesBoard(board: PlaitBoard | null): void {
  boardRef = board;
}

/**
 * Get board reference
 */
export function getCapabilitiesBoard(): PlaitBoard | null {
  return boardRef;
}

/**
 * SW Capabilities Handler class
 */
export class SWCapabilitiesHandler {
  /**
   * Execute a delegated operation
   */
  async execute(operation: DelegatedOperation): Promise<CapabilityResult> {
    const { operation: opType, args } = operation;

    switch (opType) {
      case 'canvas_insert':
        return this.handleCanvasInsert(args as unknown as CanvasInsertParams);

      case 'insert_to_canvas':
        return this.handleInsertToCanvas(args as unknown as CanvasInsertParams);

      case 'insert_mermaid':
        return this.handleMermaid(args as unknown as MermaidParams);

      case 'insert_mindmap':
        return this.handleMindmap(args as unknown as MindmapParams);

      case 'insert_svg':
        return this.handleSvg(args as unknown as SvgParams);

      case 'generate_grid_image':
        return this.handleGridImage(args as unknown as GridImageParams);

      case 'generate_inspiration_board':
        return this.handleInspirationBoard(args as unknown as InspirationBoardParams);

      case 'split_image':
        return this.handleSplitImage(args as unknown as SplitImageParams);

      case 'generate_long_video':
        return this.handleLongVideo(args as unknown as LongVideoParams);

      case 'ai_analyze':
        return this.handleAIAnalyze(args as unknown as AIAnalyzeParams);

      case 'generate_image':
        return this.handleGenerateImage(args as unknown as ImageGenerationParams);

      case 'generate_video':
        return this.handleGenerateVideo(args as unknown as VideoGenerationParams);

      default:
        return {
          success: false,
          error: `Unknown operation: ${opType}`,
          type: 'error',
        };
    }
  }

  /**
   * Find WorkZone associated with a specific MCP operation
   * Looks for WorkZone with workflow steps containing the specified MCP tool
   */
  private findWorkZoneForMCP(board: PlaitBoard, mcpTool: string): PlaitWorkZone | null {
    const allWorkZones = WorkZoneTransforms.getAllWorkZones(board);
    // console.log('[SWCapabilities] findWorkZoneForMCP:', mcpTool, 'total WorkZones:', allWorkZones.length);

    if (allWorkZones.length === 0) {
      return null;
    }

    // First, try to find WorkZone with matching MCP tool in steps
    for (const workzone of allWorkZones) {
      const hasMatchingStep = workzone.workflow.steps?.some(step => step.mcp === mcpTool);
      if (hasMatchingStep) {
        // console.log('[SWCapabilities] Found WorkZone with matching MCP step:', workzone.id);
        return workzone;
      }
    }

    // Fallback: return the most recent WorkZone
    const sortedWorkZones = allWorkZones.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    // console.log('[SWCapabilities] Using most recent WorkZone:', sortedWorkZones[0]?.id);
    return sortedWorkZones[0] || null;
  }

  /**
   * Handle insert_to_canvas operation
   * 支持 markdown 文本解析为 Card 标签贴，图片/视频直接插入
   */
  private async handleInsertToCanvas(params: CanvasInsertParams): Promise<CapabilityResult> {
    const board = boardRef;
    if (!board) {
      return { success: false, error: '画布未初始化', type: 'error' };
    }

    const { items, startPoint, verticalGap = 50 } = params;

    if (!items || items.length === 0) {
      return { success: false, error: '没有要插入的内容', type: 'error' };
    }

    try {
      // 动态导入 markdown 解析工具
      const { parseMarkdownToCards } = await import('../../utils/markdown-to-cards');
      const { insertCardsToCanvas } = await import('../../utils/insert-cards');

      let currentPoint: Point = startPoint || this.getInsertionPoint(board);
      let insertedCount = 0;

      for (const item of items) {
        const { type, content } = item;

        switch (type) {
          case 'text': {
            // 尝试解析为 Markdown Card 块
            const cardBlocks = parseMarkdownToCards(content);
            if (cardBlocks && cardBlocks.length > 0) {
              const cardWidth = Math.round(window.innerWidth * 0.5);
              insertCardsToCanvas(board, cardBlocks, currentPoint, cardWidth);
              const cols = Math.min(cardBlocks.length, 3);
              const rows = Math.ceil(cardBlocks.length / 3);
              currentPoint = [currentPoint[0], currentPoint[1] + rows * (120 + 20) + verticalGap] as Point;
            } else {
              DrawTransforms.insertText(board, currentPoint, content);
              currentPoint = [currentPoint[0], currentPoint[1] + 100 + verticalGap] as Point;
            }
            insertedCount++;
            break;
          }

          case 'image':
            await insertImageFromUrl(board, content, currentPoint, false, { width: 400, height: 400 }, false, true);
            currentPoint = [currentPoint[0], currentPoint[1] + 400 + verticalGap] as Point;
            insertedCount++;
            break;

          case 'video':
            await insertVideoFromUrl(board, content, currentPoint);
            currentPoint = [currentPoint[0], currentPoint[1] + 300 + verticalGap] as Point;
            insertedCount++;
            break;

          case 'svg': {
            const dataUrl = this.svgToDataUrl(content);
            const imageItem = { url: dataUrl, width: 400, height: 400 };
            DrawTransforms.insertImage(board, imageItem, currentPoint);
            currentPoint = [currentPoint[0], currentPoint[1] + 400 + verticalGap] as Point;
            insertedCount++;
            break;
          }
        }
      }

      // 滚动到插入位置
      const firstPoint = startPoint || this.getInsertionPoint(board);
      requestAnimationFrame(() => {
        scrollToPointIfNeeded(board, firstPoint);
      });

      // 触发生成完成事件
      window.dispatchEvent(new CustomEvent('ai-generation-complete', {
        detail: { type: 'text', success: true }
      }));

      return {
        success: true,
        data: { insertedCount },
        type: 'canvas',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || '插入失败',
        type: 'error',
      };
    }
  }

  /**
   * Handle canvas insertion
   */
  private async handleCanvasInsert(params: CanvasInsertParams): Promise<CapabilityResult> {
    const board = boardRef;
    if (!board) {
      return { success: false, error: '画布未初始化', type: 'error' };
    }

    const { items, startPoint, verticalGap = 50, horizontalGap = 20 } = params;

    if (!items || items.length === 0) {
      return { success: false, error: '没有要插入的内容', type: 'error' };
    }

    try {
      let currentPoint = startPoint || this.getInsertionPoint(board);
      let insertedCount = 0;

      for (const item of items) {
        const { type, content } = item;

        switch (type) {
          case 'image':
            // 使用默认尺寸立即插入，不等待图片下载完成
            await insertImageFromUrl(board, content, currentPoint, false, { width: 400, height: 400 }, false, true);
            currentPoint = [currentPoint[0], currentPoint[1] + 400 + verticalGap] as Point;
            insertedCount++;
            break;

          case 'video':
            await insertVideoFromUrl(board, content, currentPoint);
            currentPoint = [currentPoint[0], currentPoint[1] + 300 + verticalGap] as Point;
            insertedCount++;
            break;

          case 'text':
            DrawTransforms.insertText(board, currentPoint, content);
            currentPoint = [currentPoint[0], currentPoint[1] + 100 + verticalGap] as Point;
            insertedCount++;
            break;

          case 'svg':
            const dataUrl = this.svgToDataUrl(content);
            const imageItem = { url: dataUrl, width: 400, height: 400 };
            DrawTransforms.insertImage(board, imageItem, currentPoint);
            currentPoint = [currentPoint[0], currentPoint[1] + 400 + verticalGap] as Point;
            insertedCount++;
            break;
        }
      }

      return {
        success: true,
        data: { insertedCount },
        type: 'canvas',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || '插入失败',
        type: 'error',
      };
    }
  }

  /**
   * Handle mermaid diagram insertion
   */
  private async handleMermaid(params: MermaidParams): Promise<CapabilityResult> {
    const board = boardRef;
    if (!board) {
      return { success: false, error: '画布未初始化', type: 'error' };
    }

    const { mermaid } = params;
    if (!mermaid) {
      return { success: false, error: '缺少 mermaid 参数', type: 'error' };
    }

    // console.log('[SWCapabilities] handleMermaid called, mermaid length:', mermaid.length);

    try {
      // Dynamic import mermaid-to-drawnix
      const { parseMermaidToDrawnix } = await import('@plait-board/mermaid-to-drawnix');

      // Extract mermaid code from markdown code block if present
      const mermaidCode = this.extractCodeBlock(mermaid, 'mermaid');
      // console.log('[SWCapabilities] Extracted mermaid code length:', mermaidCode.length);

      // Parse mermaid to drawnix elements
      let result;
      try {
        result = await parseMermaidToDrawnix(mermaidCode);
      } catch {
        // Retry with quote replacement
        result = await parseMermaidToDrawnix(mermaidCode.replace(/"/g, "'"));
      }

      const { elements } = result;
      if (!elements || elements.length === 0) {
        return { success: false, error: 'Mermaid 解析未生成元素', type: 'error' };
      }

      // Find WorkZone associated with this mermaid operation
      const targetWorkZone = this.findWorkZoneForMCP(board, 'insert_mermaid');
      // console.log('[SWCapabilities] Target WorkZone:', targetWorkZone?.id, 'expectedInsertPosition:', targetWorkZone?.expectedInsertPosition);

      // Get viewport center as insertion point for better centering
      const viewportCenter = this.getViewportCenter(board);
      // console.log('[SWCapabilities] Viewport center:', viewportCenter);

      // Insert elements to canvas at viewport center
      const insertResult = this.insertElementsToCanvasAtPoint(board, elements, viewportCenter);
      // console.log('[SWCapabilities] Insert result:', insertResult);

      if (insertResult.success) {
        // Center the inserted elements in viewport after a short delay
        requestAnimationFrame(() => {
          this.centerInsertedElementsInViewport(board, elements.length);
        });

        if (targetWorkZone) {
          // Remove the WorkZone after successful insertion
          // console.log('[SWCapabilities] Removing WorkZone:', targetWorkZone.id);
          setTimeout(() => {
            WorkZoneTransforms.removeWorkZone(board, targetWorkZone!.id);
            // console.log('[SWCapabilities] WorkZone removed successfully');
            
            // Dispatch event to notify AI input bar that generation is complete
            window.dispatchEvent(new CustomEvent('ai-generation-complete', {
              detail: { type: 'mermaid', success: true }
            }));
          }, 100);
        }
      }

      return {
        success: insertResult.success,
        data: { elementsCount: insertResult.elementsCount },
        type: 'canvas',
        error: insertResult.error,
      };
    } catch (error: any) {
      console.error('[SWCapabilities] Mermaid conversion failed:', error);
      return {
        success: false,
        error: `Mermaid 转换失败: ${error.message}`,
        type: 'error',
      };
    }
  }

  /**
   * Handle mindmap insertion
   */
  private async handleMindmap(params: MindmapParams): Promise<CapabilityResult> {
    const board = boardRef;
    if (!board) {
      console.error('[SWCapabilities] ❌ handleMindmap: 画布未初始化');
      return { success: false, error: '画布未初始化', type: 'error' };
    }

    const { markdown } = params;
    if (!markdown) {
      console.error('[SWCapabilities] ❌ handleMindmap: 缺少 markdown 参数');
      return { success: false, error: '缺少 markdown 参数', type: 'error' };
    }

    try {
      // Dynamic import markdown-to-drawnix
      const { parseMarkdownToDrawnix } = await import('@plait-board/markdown-to-drawnix');

      // Extract markdown code
      const markdownCode = this.extractCodeBlock(markdown, 'markdown');
      // console.log('[SWCapabilities] Extracted markdown code length:', markdownCode.length);

      // Parse markdown to mindmap element
      let mindElement;
      try {
        mindElement = await parseMarkdownToDrawnix(markdownCode);
      } catch {
        mindElement = await parseMarkdownToDrawnix(markdownCode.replace(/"/g, "'"));
      }

      if (!mindElement) {
        return { success: false, error: 'Markdown 解析未生成元素', type: 'error' };
      }

      // Set initial position
      mindElement.points = [[0, 0]];

      // Find WorkZone associated with this mindmap operation
      const targetWorkZone = this.findWorkZoneForMCP(board, 'insert_mindmap');
      // console.log('[SWCapabilities] Target WorkZone:', targetWorkZone?.id, 'expectedInsertPosition:', targetWorkZone?.expectedInsertPosition);

      // Get viewport center as insertion point for better centering
      const viewportCenter = this.getViewportCenter(board);
      // console.log('[SWCapabilities] Viewport center:', viewportCenter);

      // Insert to canvas at viewport center
      const insertResult = this.insertElementsToCanvasAtPoint(board, [mindElement], viewportCenter);

      if (insertResult.success) {
        // Center the inserted mindmap in viewport after a short delay
        requestAnimationFrame(() => {
          this.centerInsertedElementsInViewport(board, 1);
        });

        if (targetWorkZone) {
          // Remove the WorkZone after successful insertion
          setTimeout(() => {
            WorkZoneTransforms.removeWorkZone(board, targetWorkZone!.id);

            // Dispatch event to notify AI input bar that generation is complete
            window.dispatchEvent(new CustomEvent('ai-generation-complete', {
              detail: { type: 'mindmap', success: true }
            }));
          }, 100);
        }
      } else {
        console.error('[SWCapabilities] ❌ Mindmap insert failed:', insertResult.error);
      }

      return {
        success: insertResult.success,
        data: { type: 'mindmap', elementsCount: insertResult.elementsCount },
        type: 'canvas',
        error: insertResult.error,
      };
    } catch (error: any) {
      console.error('[SWCapabilities] ❌ Mindmap conversion failed:', error);
      return {
        success: false,
        error: `思维导图转换失败: ${error.message}`,
        type: 'error',
      };
    }
  }

  /**
   * Handle SVG insertion
   */
  private async handleSvg(params: SvgParams): Promise<CapabilityResult> {
    const board = boardRef;
    if (!board) {
      return { success: false, error: '画布未初始化', type: 'error' };
    }

    const { svg, width = 400, startPoint } = params;
    if (!svg) {
      return { success: false, error: '缺少 svg 参数', type: 'error' };
    }

    try {
      // Extract and normalize SVG
      const svgCode = this.extractSvgCode(svg);
      const normalizedSvg = this.normalizeSvg(svgCode);

      // Parse dimensions
      const dimensions = this.parseSvgDimensions(normalizedSvg);
      const effectiveWidth = Math.min(Math.max(width, 100), 800);
      const aspectRatio = dimensions.height / dimensions.width;
      const effectiveHeight = effectiveWidth * aspectRatio;

      // Convert to data URL
      const dataUrl = this.svgToDataUrl(normalizedSvg);

      // Determine insertion point
      let insertionPoint = startPoint || this.getInsertionPoint(board);
      insertionPoint = [insertionPoint[0] - effectiveWidth / 2, insertionPoint[1]] as Point;

      // Insert image
      const imageItem = { url: dataUrl, width: effectiveWidth, height: effectiveHeight };
      DrawTransforms.insertImage(board, imageItem, insertionPoint);

      // Scroll to insertion point
      const centerPoint: Point = [
        insertionPoint[0] + effectiveWidth / 2,
        insertionPoint[1] + effectiveHeight / 2,
      ];
      requestAnimationFrame(() => {
        scrollToPointIfNeeded(board, centerPoint);
      });

      return {
        success: true,
        data: { width: effectiveWidth, height: effectiveHeight },
        type: 'canvas',
      };
    } catch (error: any) {
      return {
        success: false,
        error: `SVG 插入失败: ${error.message}`,
        type: 'error',
      };
    }
  }

  /**
   * Handle grid image generation
   */
  private async handleGridImage(params: GridImageParams): Promise<CapabilityResult> {
    try {
      const { createGridImageTask } = await import('../canvas-operations/grid-image');
      const result = await createGridImageTask(params as any);

      return {
        success: result.success,
        data: result.data,
        type: result.type,
        taskId: result.taskId,
        error: result.error,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `宫格图生成失败: ${error.message}`,
        type: 'error',
      };
    }
  }

  /**
   * Handle inspiration board generation
   */
  private async handleInspirationBoard(params: InspirationBoardParams): Promise<CapabilityResult> {
    try {
      const { createInspirationBoardTask } = await import('../canvas-operations/inspiration-board');
      const result = await createInspirationBoardTask(params);

      return {
        success: result.success,
        data: result.data,
        type: result.type,
        taskId: result.taskId,
        error: result.error,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `灵感图生成失败: ${error.message}`,
        type: 'error',
      };
    }
  }

  /**
   * Handle image splitting
   */
  private async handleSplitImage(params: SplitImageParams): Promise<CapabilityResult> {
    const board = boardRef;
    if (!board) {
      return { success: false, error: '画布未初始化', type: 'error' };
    }

    const { imageUrl } = params;
    if (!imageUrl) {
      return { success: false, error: '缺少 imageUrl 参数', type: 'error' };
    }

    try {
      const { splitAndInsertImages } = await import('../../utils/image-splitter');
      const result = await splitAndInsertImages(board, imageUrl, { scrollToResult: true });

      return {
        success: result.success,
        data: { count: result.count },
        type: 'canvas',
        error: result.error,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `图片拆分失败: ${error.message}`,
        type: 'error',
      };
    }
  }

  /**
   * Handle long video generation
   */
  private async handleLongVideo(params: LongVideoParams): Promise<CapabilityResult> {
    try {
      const { createLongVideoTask } = await import('../canvas-operations/long-video');
      const result = await createLongVideoTask(params as any);

      return {
        success: result.success,
        data: result.data,
        type: result.type,
        taskId: result.taskId,
        error: result.error,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `长视频生成失败: ${error.message}`,
        type: 'error',
      };
    }
  }

  /**
   * Handle AI analysis
   */
  private async handleAIAnalyze(params: AIAnalyzeParams): Promise<CapabilityResult> {
    try {
      const { analyzeWithAI } = await import('../canvas-operations/ai-analyze');
      
      // Debug: Log context to check if selection.images is present
      // console.log('[AIAnalyze] Context received:', {
      //   userInstruction: params.context?.userInstruction?.substring(0, 50),
      //   selectionImages: params.context?.selection?.images?.length || 0,
      //   selectionGraphics: (params.context?.selection as any)?.graphics?.length || 0,
      // });
      
      const result = await analyzeWithAI(params.context as any, {
        onChunk: (chunk) => {
          // TODO: Forward chunks to SW via postMessage
          // console.log('[AIAnalyze] Chunk:', chunk);
        },
        onAddSteps: (steps) => {
          // Steps will be returned in the result
          // console.log('[AIAnalyze] Add steps:', steps);
        },
      }, params.modelRef || null);

      return {
        success: result.success,
        data: { response: result.response },
        type: 'text',
        addSteps: result.generatedSteps?.map((s) => ({
          id: s.id,
          mcp: s.mcp,
          args: s.args,
          description: s.description,
          status: s.status,
        })),
        error: result.error,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `AI 分析失败: ${error.message}`,
        type: 'error',
      };
    }
  }

  /**
   * Handle image generation (delegated from SW)
   * Uses queue mode to create tasks for tracking
   */
  private async handleGenerateImage(params: ImageGenerationParams): Promise<CapabilityResult> {
    try {
      const { createImageTask } = await import('../../mcp/tools/image-generation');

      const result = await createImageTask(params);

      if (!result.success) {
        console.error('[SWCapabilities] Image task creation failed:', result.error);
        return {
          success: false,
          error: result.error || '图片生成任务创建失败',
          type: 'error',
        };
      }

      return {
        success: true,
        data: result.data,
        type: 'image',
        taskId: result.taskId,
        taskIds: (result.data as any)?.taskIds,
      };
    } catch (error: any) {
      console.error('[SWCapabilities] Image generation error:', error);
      return {
        success: false,
        error: `图片生成失败: ${error.message}`,
        type: 'error',
      };
    }
  }

  /**
   * Handle video generation (delegated from SW)
   * Uses queue mode to create tasks for tracking
   */
  private async handleGenerateVideo(params: VideoGenerationParams): Promise<CapabilityResult> {
    try {
      const { createVideoTask } = await import('../../mcp/tools/video-generation');

      const result = await createVideoTask(params as any);

      if (!result.success) {
        console.error('[SWCapabilities] Video task creation failed:', result.error);
        return {
          success: false,
          error: result.error || '视频生成任务创建失败',
          type: 'error',
        };
      }

      return {
        success: true,
        data: result.data,
        type: 'video',
        taskId: result.taskId,
        taskIds: (result.data as any)?.taskIds,
      };
    } catch (error: any) {
      console.error('[SWCapabilities] Video generation error:', error);
      return {
        success: false,
        error: `视频生成失败: ${error.message}`,
        type: 'error',
      };
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get insertion point based on current selection or canvas state
   */
  private getInsertionPoint(board: PlaitBoard): Point {
    const appState = (board as any).appState;
    const savedElementIds = appState?.lastSelectedElementIds || [];

    if (savedElementIds.length > 0) {
      const elements = savedElementIds
        .map((id: string) => board.children.find((el: any) => el.id === id))
        .filter(Boolean);

      if (elements.length > 0) {
        try {
          const boundingRect = getRectangleByElements(board, elements, false);
          return [
            boundingRect.x + boundingRect.width / 2,
            boundingRect.y + boundingRect.height + 50,
          ] as Point;
        } catch {
          // Fall through to default
        }
      }
    }

    // Default: bottom of canvas
    if (board.children && board.children.length > 0) {
      let maxY = 0;
      let maxYCenterX = 100;

      for (const element of board.children) {
        try {
          const rect = getRectangleByElements(board, [element], false);
          const elementBottom = rect.y + rect.height;
          if (elementBottom > maxY) {
            maxY = elementBottom;
            maxYCenterX = rect.x + rect.width / 2;
          }
        } catch {
          // Ignore
        }
      }

      return [maxYCenterX, maxY + 50] as Point;
    }

    return [100, 100] as Point;
  }

  /**
   * Insert elements to canvas
   */
  private insertElementsToCanvas(
    board: PlaitBoard,
    elements: any[]
  ): { success: boolean; elementsCount?: number; error?: string } {
    try {
      const insertPoint = this.getInsertionPoint(board);

      // Use board.insertFragment to correctly insert elements
      // This handles element positioning and ID generation properly
      board.insertFragment(
        { elements: JSON.parse(JSON.stringify(elements)) },
        insertPoint,
        WritableClipboardOperationType.paste
      );

      // Scroll to inserted elements
      requestAnimationFrame(() => {
        scrollToPointIfNeeded(board, insertPoint);
      });

      return { success: true, elementsCount: elements.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Insert elements to canvas at a specific point
   */
  private insertElementsToCanvasAtPoint(
    board: PlaitBoard,
    elements: any[],
    insertPoint: Point
  ): { success: boolean; elementsCount?: number; error?: string } {
    try {
      // console.log('[SWCapabilities] insertElementsToCanvasAtPoint called, point:', insertPoint, 'elements count:', elements.length);

      // Use board.insertFragment to correctly insert elements
      // This handles element positioning and ID generation properly
      board.insertFragment(
        { elements: JSON.parse(JSON.stringify(elements)) },
        insertPoint,
        WritableClipboardOperationType.paste
      );

      // Scroll to inserted elements
      requestAnimationFrame(() => {
        scrollToPointIfNeeded(board, insertPoint);
      });

      // console.log('[SWCapabilities] Elements inserted successfully at point:', insertPoint);
      return { success: true, elementsCount: elements.length };
    } catch (error: any) {
      console.error('[SWCapabilities] insertElementsToCanvasAtPoint failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get the center point of the current viewport in canvas coordinates
   */
  private getViewportCenter(board: PlaitBoard): Point {
    try {
      const boardContainer = PlaitBoardUtils.getBoardContainer(board);
      const containerRect = boardContainer.getBoundingClientRect();
      const zoom = board.viewport.zoom;
      const origination = getViewportOrigination(board);

      if (!origination) {
        // Fallback to a default position
        return [0, 0];
      }

      // Calculate the center of the viewport in canvas coordinates
      const centerX = origination[0] + containerRect.width / (2 * zoom);
      const centerY = origination[1] + containerRect.height / (2 * zoom);

      // console.log('[SWCapabilities] getViewportCenter:', { centerX, centerY, zoom, origination });
      return [centerX, centerY];
    } catch (error) {
      console.warn('[SWCapabilities] Error getting viewport center:', error);
      return [0, 0];
    }
  }

  /**
   * Center the most recently inserted elements in the viewport and fit to screen
   * This finds the last N elements (based on elementsCount), calculates optimal zoom, and centers them
   */
  private centerInsertedElementsInViewport(board: PlaitBoard, elementsCount: number): void {
    try {
      // Get the last N elements that were just inserted
      const allElements = board.children;
      const insertedElements = allElements.slice(-elementsCount);

      if (insertedElements.length === 0) {
        console.warn('[SWCapabilities] No inserted elements found to center');
        return;
      }

      // Calculate the bounding rectangle of all inserted elements
      const boundingRect = getRectangleByElements(board, insertedElements as any[], false);
      // console.log('[SWCapabilities] Inserted elements bounding rect:', boundingRect);

      // Get viewport dimensions
      const boardContainer = PlaitBoardUtils.getBoardContainer(board);
      const containerRect = boardContainer.getBoundingClientRect();

      // Add padding around the elements (in pixels)
      const padding = 80;
      const availableWidth = containerRect.width - padding * 2;
      const availableHeight = containerRect.height - padding * 2;

      // Calculate optimal zoom to fit the elements in the viewport
      const zoomX = availableWidth / boundingRect.width;
      const zoomY = availableHeight / boundingRect.height;
      let optimalZoom = Math.min(zoomX, zoomY);

      // Clamp zoom to reasonable bounds (min 0.2, max 1.5)
      // Don't zoom in too much if elements are small
      optimalZoom = Math.min(Math.max(optimalZoom, 0.2), 1.5);

      // console.log('[SWCapabilities] Calculated optimal zoom:', {
      //   boundingRect,
      //   availableWidth,
      //   availableHeight,
      //   zoomX,
      //   zoomY,
      //   optimalZoom,
      // });

      // Calculate the center of the inserted elements
      const elementsCenterX = boundingRect.x + boundingRect.width / 2;
      const elementsCenterY = boundingRect.y + boundingRect.height / 2;

      // Calculate new viewport origination to center the elements with optimal zoom
      const newOriginationX = elementsCenterX - containerRect.width / (2 * optimalZoom);
      const newOriginationY = elementsCenterY - containerRect.height / (2 * optimalZoom);

      // console.log('[SWCapabilities] Centering and fitting elements in viewport:', {
      //   elementsCenter: [elementsCenterX, elementsCenterY],
      //   newOrigination: [newOriginationX, newOriginationY],
      //   optimalZoom,
      // });

      // Update viewport with optimal zoom and centered position
      BoardTransforms.updateViewport(board, [newOriginationX, newOriginationY], optimalZoom);
    } catch (error) {
      console.warn('[SWCapabilities] Error centering inserted elements:', error);
    }
  }

  /**
   * Extract code block from markdown
   */
  private extractCodeBlock(input: string, language: string): string {
    // Try standard markdown code block format: ```language\n...\n```
    const regex = new RegExp(`\`\`\`${language}\\s*\\n([\\s\\S]*?)\\n\\s*\`\`\``, 'i');
    const match = input.match(regex);
    if (match) {
      return match[1].trim();
    }

    // Try without newline requirement
    const regex2 = new RegExp(`\`\`\`${language}\\s*([\\s\\S]*?)\\s*\`\`\``, 'i');
    const match2 = input.match(regex2);
    if (match2) {
      return match2[1].trim();
    }

    // If input starts with the language name followed by newline, strip it
    // This handles cases like "mermaid\nflowchart TD..."
    const langPrefix = new RegExp(`^${language}\\s*\\n`, 'i');
    if (langPrefix.test(input.trim())) {
      return input.trim().replace(langPrefix, '').trim();
    }

    return input.trim();
  }

  /**
   * Extract SVG code from input
   */
  private extractSvgCode(input: string): string {
    let svg = this.extractCodeBlock(input, 'svg');
    if (svg === input) {
      svg = this.extractCodeBlock(input, 'xml');
    }

    if (svg === input && !svg.trim().startsWith('<svg')) {
      const svgMatch = svg.match(/<svg[\s\S]*?<\/svg>/i);
      if (svgMatch) {
        svg = svgMatch[0];
      }
    }

    return svg.trim();
  }

  /**
   * Normalize SVG code
   */
  private normalizeSvg(svg: string): string {
    let normalized = svg.trim();
    if (!normalized.includes('xmlns=')) {
      normalized = normalized.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return normalized;
  }

  /**
   * Parse SVG dimensions
   */
  private parseSvgDimensions(svg: string): { width: number; height: number } {
    const viewBoxMatch = svg.match(/viewBox=["']([^"']+)["']/i);
    if (viewBoxMatch) {
      const [, , vbWidth, vbHeight] = viewBoxMatch[1].split(/\s+/).map(Number);
      if (vbWidth && vbHeight) {
        return { width: vbWidth, height: vbHeight };
      }
    }

    const widthMatch = svg.match(/width=["'](\d+)(?:px)?["']/i);
    const heightMatch = svg.match(/height=["'](\d+)(?:px)?["']/i);
    if (widthMatch && heightMatch) {
      return { width: parseInt(widthMatch[1]), height: parseInt(heightMatch[1]) };
    }

    return { width: 400, height: 400 };
  }

  /**
   * Convert SVG to data URL
   */
  private svgToDataUrl(svg: string): string {
    const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
    return `data:image/svg+xml,${encoded}`;
  }
}

/**
 * Singleton instance
 */
export const swCapabilitiesHandler = new SWCapabilitiesHandler();

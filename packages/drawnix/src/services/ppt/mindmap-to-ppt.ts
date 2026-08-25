/**
 * 思维导图转 PPT 服务
 *
 * 将思维导图的树形结构转换为 PPT 演示文稿
 *
 * 转换规则：
 * - 根节点 → 封面页标题
 * - 一级子节点 → 目录项 + 独立内容页标题
 * - 二级及更深子节点 → 内容页的正文要点
 */

import type { PlaitBoard, PlaitElement, Point } from '@plait/core';
import { Transforms, BoardTransforms, PlaitBoard as PlaitBoardUtils, RectangleClient } from '@plait/core';
import { MindElement, PlaitMind } from '@plait/mind';
import { Node } from 'slate';
import { FrameTransforms } from '../../plugins/with-frame';
import { setFramePPTMeta } from '../../utils/frame-insertion-utils';
import { PlaitFrame } from '../../types/frame.types';
import type {
  MindmapNodeInfo,
  MindmapToPPTOptions,
  MindmapToPPTResult,
  PPTOutline,
  PPTPageSpec,
  PPTFrameMeta,
} from './ppt.types';
import { PPT_FRAME_WIDTH, PPT_FRAME_HEIGHT } from './ppt-layout-engine';
import {
  buildPPTImageGenerationPrompt,
  createDefaultPPTStyleSpec,
  formatPPTCommonPrompt,
  generateSlideImagePrompt,
} from './ppt-prompts';
import {
  calcPPTFrameInsertionStartPosition,
  getPPTFrameGridPositions,
  loadPPTFrameLayoutColumns,
} from './ppt-frame-layout';
import { analytics } from '../../utils/umami-analytics';

/**
 * 从 MindElement 的 data 中提取纯文本
 *
 * MindElement.data 结构为 BaseData = { topic: ParagraphElement }
 * 其中 ParagraphElement 是 Slate BaseElement，结构为 { children: [{ text: "..." }] }
 */
export function extractTextFromMindData(data: MindElement['data']): string {
  if (!data) return '';

  // data 是 BaseData = { topic: ParagraphElement }
  // ParagraphElement 是 Slate Element，可用 Node.string 提取纯文本
  if (typeof data === 'object' && 'topic' in data && data.topic) {
    try {
      return Node.string(data.topic as any).trim();
    } catch {
      // fallback: 尝试递归提取 text
    }
  }

  // 兼容：如果 data 本身就是 Slate 节点（有 children 属性）
  if (typeof data === 'object' && 'children' in data) {
    try {
      return Node.string(data as any).trim();
    } catch {
      return '';
    }
  }

  // 如果 data 直接是字符串
  if (typeof data === 'string') {
    return (data as any).trim();
  }

  return '';
}

/**
 * 递归遍历思维导图，提取层级结构
 *
 * @param element - MindElement 节点
 * @param depth - 当前深度（根节点为 0）
 * @returns 节点信息
 */
export function extractMindmapStructure(element: MindElement, depth: number = 0): MindmapNodeInfo {
  const text = extractTextFromMindData(element.data);

  const children: MindmapNodeInfo[] = [];
  if (element.children && Array.isArray(element.children)) {
    for (const child of element.children) {
      children.push(extractMindmapStructure(child, depth + 1));
    }
  }

  return {
    text,
    children,
    depth,
  };
}

/**
 * 将子节点展平为要点列表
 * 处理多层嵌套，将深层节点格式化为缩进要点
 *
 * @param children - 子节点列表
 * @param maxDepth - 最大展开深度（相对于当前节点）
 * @returns 要点文本数组
 */
export function flattenChildrenToBullets(children: MindmapNodeInfo[], maxDepth: number = 2): string[] {
  const bullets: string[] = [];

  function traverse(nodes: MindmapNodeInfo[], currentDepth: number) {
    for (const node of nodes) {
      if (!node.text) continue;

      // 根据深度添加缩进前缀
      const indent = currentDepth > 0 ? '  '.repeat(currentDepth) : '';
      bullets.push(`${indent}${node.text}`);

      // 继续遍历子节点，但限制深度
      if (node.children.length > 0 && currentDepth < maxDepth - 1) {
        traverse(node.children, currentDepth + 1);
      }
    }
  }

  traverse(children, 0);
  return bullets;
}

/**
 * 将思维导图结构转换为 PPT 大纲
 *
 * @param rootInfo - 思维导图根节点信息
 * @param options - 转换选项
 * @returns PPT 大纲
 */
export function convertMindmapToOutline(
  rootInfo: MindmapNodeInfo,
  options: MindmapToPPTOptions = {}
): PPTOutline {
  const { includeToc = true, endingTitle = '谢谢观看', endingSubtitle } = options;

  const pages: PPTPageSpec[] = [];
  const title = rootInfo.text || '未命名演示文稿';

  // 1. 封面页
  pages.push({
    layout: 'cover',
    title,
    subtitle: rootInfo.children.length > 0 ? `共 ${rootInfo.children.length} 个主题` : undefined,
  });

  // 2. 目录页（如果有一级子节点且启用目录）
  if (includeToc && rootInfo.children.length > 0) {
    const tocBullets = rootInfo.children
      .map((child) => child.text)
      .filter((text) => text); // 过滤空文本

    if (tocBullets.length > 0) {
      pages.push({
        layout: 'toc',
        title: '目录',
        bullets: tocBullets,
      });
    }
  }

  // 3. 内容页（每个一级子节点生成一页）
  for (const child of rootInfo.children) {
    if (!child.text) continue;

    const pageSpec: PPTPageSpec = {
      layout: 'title-body',
      title: child.text,
    };

    // 将二级及更深子节点转换为要点
    if (child.children.length > 0) {
      pageSpec.bullets = flattenChildrenToBullets(child.children);
    }

    pages.push(pageSpec);
  }

  // 4. 结尾页
  pages.push({
    layout: 'ending',
    title: endingTitle,
    subtitle: endingSubtitle,
  });

  return {
    title,
    styleSpec: createDefaultPPTStyleSpec(),
    pages,
  };
}

/**
 * 将思维导图元素转换为 PPT 大纲（纯函数，便于测试）
 *
 * 从 MindElement 提取结构 → 转换为 PPT 大纲，不依赖 board
 *
 * @param mindElement - 思维导图根元素
 * @param options - 转换选项
 * @returns PPT 大纲
 */
export function mindmapToOutline(
  mindElement: MindElement,
  options: MindmapToPPTOptions = {}
): PPTOutline {
  const rootInfo = extractMindmapStructure(mindElement);
  return convertMindmapToOutline(rootInfo, options);
}

/**
 * 聚焦视口到指定 Frame
 */
function focusOnFrame(board: PlaitBoard, frame: PlaitFrame): void {
  const rect = RectangleClient.getRectangleByPoints(frame.points);
  const padding = 80;

  const container = PlaitBoardUtils.getBoardContainer(board);
  const viewportWidth = container?.clientWidth ?? 1920;
  const viewportHeight = container?.clientHeight ?? 1080;

  // 计算缩放比例，让 Frame 适应视口
  const scaleX = viewportWidth / (rect.width + padding * 2);
  const scaleY = viewportHeight / (rect.height + padding * 2);
  const zoom = Math.min(scaleX, scaleY, 1);

  // 计算 Frame 中心点
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  // 计算 origination：使 Frame 中心对齐视口中心
  const origination: [number, number] = [centerX - viewportWidth / 2 / zoom, centerY - viewportHeight / 2 / zoom];

  BoardTransforms.updateViewport(board, origination, zoom);
}

/**
 * 创建单个 PPT 页面（Frame + 整页图片元数据）
 */
function createPPTPage(
  board: PlaitBoard,
  outline: PPTOutline,
  pageSpec: PPTPageSpec,
  pageIndex: number,
  framePosition: Point
): { frame: PlaitFrame; slidePrompt: string } {
  // 1. 创建 Frame
  const framePoints: [Point, Point] = [
    framePosition,
    [framePosition[0] + PPT_FRAME_WIDTH, framePosition[1] + PPT_FRAME_HEIGHT],
  ];
  const frameName = pageSpec.title || `Slide ${pageIndex}`;
  const frame = FrameTransforms.insertFrame(board, framePoints, frameName);

  // 4. 设置 pptMeta 扩展属性
  const slidePrompt = generateSlideImagePrompt(outline, pageSpec, pageIndex);
  const commonPrompt = formatPPTCommonPrompt(outline.styleSpec);
  const pptMeta: PPTFrameMeta = {
    layout: pageSpec.layout,
    pageIndex,
    slidePrompt,
    styleSpec: outline.styleSpec,
    commonPrompt,
    slideImageStatus: 'loading',
    imageStatus: 'loading',
  };
  if (pageSpec.imagePrompt) {
    pptMeta.imagePrompt = pageSpec.imagePrompt;
  }
  if (pageSpec.notes) {
    pptMeta.notes = pageSpec.notes;
  }

  // 查找 frame 在 board.children 中的索引并设置属性
  const frameIndex = board.children.findIndex((el) => el.id === frame.id);
  if (frameIndex !== -1) {
    Transforms.setNode(board, { pptMeta } as any, [frameIndex]);
  }

  return { frame, slidePrompt };
}

async function enqueueSlideImageTask(
  frame: PlaitFrame,
  prompt: string,
  slidePrompt: string
): Promise<boolean> {
  try {
    const { createImageTask } = await import('../../mcp/tools/image-generation');
    const result = await createImageTask({
      prompt,
      size: '16x9',
      pptSlidePrompt: slidePrompt,
      autoInsertToCanvas: true,
      targetFrameId: frame.id,
      targetFrameDimensions: {
        width: PPT_FRAME_WIDTH,
        height: PPT_FRAME_HEIGHT,
      },
      pptSlideImage: true,
    });
    return !!result.success;
  } catch (error) {
    console.warn('[MindmapToPPT] Slide image task creation failed:', error);
    return false;
  }
}

/**
 * 检查元素是否为 PlaitMind（思维导图根元素）
 */
export function isPlaitMind(element: unknown): element is MindElement {
  return PlaitMind.isMind(element);
}

/**
 * 从选中的元素中找到思维导图根元素
 *
 * 支持以下场景：
 * 1. 选中单个根元素（PlaitMind）→ 直接返回
 * 2. 选中一个或多个子节点（MindElement）→ 向上查找根元素
 *
 * @returns 根元素，如果选中元素不属于同一个思维导图则返回 null
 */
export function findMindRootFromSelection(
  board: PlaitBoard,
  selectedElements: PlaitElement[]
): MindElement | null {
  if (selectedElements.length === 0) return null;

  // 场景 1：选中单个根元素
  if (selectedElements.length === 1 && PlaitMind.isMind(selectedElements[0])) {
    return selectedElements[0] as unknown as MindElement;
  }

  // 场景 2：选中的元素中包含思维导图节点，查找根元素
  for (const element of selectedElements) {
    // 先检查是否是根元素
    if (PlaitMind.isMind(element)) {
      return element as unknown as MindElement;
    }

    // 检查是否是 MindElement（子节点），向上查找根元素
    if (MindElement.isMindElement(board, element)) {
      try {
        const root = MindElement.getRoot(board, element as MindElement);
        if (root) return root as unknown as MindElement;
      } catch {
        // getRoot 可能抛出异常
      }
    }
  }

  return null;
}

/**
 * 从思维导图生成 PPT
 *
 * @param board - Plait 画布实例
 * @param mindElement - 思维导图元素（必须是根元素，即 type='mindmap'）
 * @param options - 转换选项
 * @returns 转换结果
 */
export async function generatePPTFromMindmap(
  board: PlaitBoard,
  mindElement: MindElement,
  options: MindmapToPPTOptions = {}
): Promise<MindmapToPPTResult> {
  const startTime = Date.now();
  try {
    // 1. 验证输入
    if (!isPlaitMind(mindElement)) {
      analytics.trackPPTAction({
        action: 'mindmap_to_ppt',
        source: 'popup_toolbar',
        status: 'failed',
        error: 'InvalidMindmapSelection',
      });
      return {
        success: false,
        error: '请选择一个完整的思维导图（根节点）',
      };
    }

    // 2. 提取思维导图结构并转换为大纲
    const outline = mindmapToOutline(mindElement, options);
    analytics.trackPPTAction({
      action: 'mindmap_to_ppt',
      source: 'popup_toolbar',
      status: 'start',
      pageCount: outline.pages.length,
      prompt: outline.title,
      metadata: {
        include_toc: options.includeToc !== false,
        has_ending_subtitle: Boolean(options.endingSubtitle),
      },
    });

    // 3. 验证大纲
    if (outline.pages.length <= 2) {
      // 只有封面页和结尾页，说明思维导图内容为空
      const rootInfo = extractMindmapStructure(mindElement);
      if (!rootInfo.text && rootInfo.children.length === 0) {
        analytics.trackPPTAction({
          action: 'mindmap_to_ppt',
          source: 'popup_toolbar',
          status: 'failed',
          pageCount: outline.pages.length,
          error: 'EmptyMindmap',
        });
        return {
          success: false,
          error: '思维导图内容为空，请先添加内容',
        };
      }
    }

    // 4. 逐页创建 Frame，并生成整页图片
    let firstFrame: PlaitFrame | null = null;
    let createdCount = 0;
    let queuedImageTaskCount = 0;
    let failedImageTaskCount = 0;
    const startPosition = calcPPTFrameInsertionStartPosition(board);
    const framePositions = getPPTFrameGridPositions(
      outline.pages.length,
      startPosition,
      loadPPTFrameLayoutColumns()
    );

    for (let i = 0; i < outline.pages.length; i++) {
      const pageSpec = outline.pages[i];
      const pageIndex = i + 1;

      // 计算 Frame 位置
      const framePosition = framePositions[i];

      // 创建页面
      const { frame, slidePrompt } = createPPTPage(
        board,
        outline,
        pageSpec,
        pageIndex,
        framePosition
      );

      if (i === 0) {
        firstFrame = frame;
      }

      if (slidePrompt) {
        const queued = await enqueueSlideImageTask(
          frame,
          buildPPTImageGenerationPrompt(
            formatPPTCommonPrompt(outline.styleSpec),
            slidePrompt
          ),
          slidePrompt
        );
        if (queued) {
          queuedImageTaskCount++;
        }
        if (!queued) {
          failedImageTaskCount++;
          setFramePPTMeta(board, frame.id, {
            slideImageStatus: 'failed',
            imageStatus: 'failed',
          });
        }
      }

      createdCount++;
    }

    // 5. 聚焦到第一个 Frame
    if (firstFrame) {
      focusOnFrame(board, firstFrame);
    }

    analytics.trackPPTAction({
      action: 'mindmap_to_ppt',
      source: 'popup_toolbar',
      status: failedImageTaskCount > 0 ? 'failed' : 'success',
      pageCount: createdCount,
      frameCount: createdCount,
      successCount: queuedImageTaskCount,
      failedCount: failedImageTaskCount,
      durationMs: Date.now() - startTime,
      prompt: outline.title,
      metadata: {
        image_task_count: queuedImageTaskCount,
        layout_count: outline.pages.reduce<Record<string, number>>(
          (acc, page) => {
            acc[page.layout] = (acc[page.layout] || 0) + 1;
            return acc;
          },
          {}
        ),
      },
    });
    return {
      success: true,
      pageCount: createdCount,
    };
  } catch (error: any) {
    console.error('[MindmapToPPT] Conversion failed:', error);
    analytics.trackPPTAction({
      action: 'mindmap_to_ppt',
      source: 'popup_toolbar',
      status: 'failed',
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.name || 'Error' : typeof error,
    });
    return {
      success: false,
      error: error.message || '思维导图转 PPT 失败',
    };
  }
}

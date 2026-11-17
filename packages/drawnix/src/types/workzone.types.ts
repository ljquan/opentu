import type { GenerationOrigin } from '../services/generation-node-lifecycle';
/**
 * WorkZone 类型定义
 *
 * WorkZone 是一个画布元素，用于在画布上直接显示工作流进度
 * 类似于 ChatDrawer 中的 WorkflowMessageBubble，但固定在画布上
 */

import type { PlaitElement, Point } from '@plait/core';
import type { WorkflowMessageData } from './chat.types';

/**
 * WorkZone 画布元素
 */
export interface PlaitWorkZone extends PlaitElement {
  type: 'workzone';
  generationOrigin?: GenerationOrigin;
  /** 两个点定义矩形区域 [左上角, 右下角] */
  points: [Point, Point];
  /** 旋转角度 */
  angle: number;
  /** 关联的工作流数据 */
  workflow: WorkflowMessageData;
  /** 创建时间 */
  createdAt: number;
  /** 预期的元素插入位置 [leftX, topY]（leftX 是左边缘X坐标，用于元素生成后左对齐插入） */
  expectedInsertPosition?: Point;
  /** 目标 Frame ID（选中 Frame 时生成的媒体将插入到 Frame 内部） */
  targetFrameId?: string;
  /** 目标 Frame 的尺寸（用于将生成结果缩放到 Frame 尺寸） */
  targetFrameDimensions?: { width: number; height: number };
  /** 画布缩放级别（用于内容等比缩放） */
  zoom: number;
}

/**
 * WorkZone 创建选项
 */
export interface WorkZoneCreateOptions {
  /** 初始工作流数据 */
  workflow: WorkflowMessageData;
  /** 位置 */
  position: Point;
  /** 尺寸 */
  size?: { width: number; height: number };
  /** 预期的元素插入位置 [leftX, topY]（leftX 是左边缘X坐标，用于元素生成后左对齐插入） */
  expectedInsertPosition?: Point;
  /** 目标 Frame ID（选中 Frame 时生成的媒体将插入到 Frame 内部） */
  targetFrameId?: string;
  /** 目标 Frame 的尺寸（用于将生成结果缩放到 Frame 尺寸） */
  targetFrameDimensions?: { width: number; height: number };
  /** 画布缩放级别（用于内容等比缩放） */
  zoom: number;
}

/**
 * 默认 WorkZone 尺寸（画布坐标）
 * 因为容器应用了 scale(1/zoom)，所以这是固定的物理尺寸
 */
export const DEFAULT_WORKZONE_SIZE = {
  width: 360,
  height: 240,
};

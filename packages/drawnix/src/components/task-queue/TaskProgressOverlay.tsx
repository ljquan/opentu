/**
 * TaskProgressOverlay Component
 *
 * 任务进度覆盖层组件，在图片/视频/音频预览区域显示带比例的 loading 状态
 *
 * 进度设计：
 * - 视频/音频任务：显示真实的 API 返回进度（0-100%）
 * - 图片任务：模拟进度，分三个阶段
 *   1. 生成阶段（0-90%）：基于预估时间模拟，默认 5 分钟
 *   2. 获取链接（90%）：任务完成但图片未加载
 *   3. 图片加载（90-100%）：图片正在加载中
 */

import React, { useState, useEffect, useRef } from 'react';
import { TaskType, TaskStatus } from '../../types/task.types';
import {
  IMAGE_GENERATION_ESTIMATE_MS,
  getImageTaskProgressStatusText,
} from '../../utils/image-task-progress';
import { ImageGenerationProgressDisplay } from '../shared/ImageGenerationProgressDisplay';
import { useImageTaskProgress } from '../../hooks/useImageTaskProgress';
import type { PptExplainerStage } from '../../services/ppt-explainer/types';
import './task-progress-overlay.scss';

const PPT_EXPLAINER_STAGE_TEXT: Partial<Record<PptExplainerStage, string>> = {
  preparing: '正在生成PPT大纲',
  review_pending: 'PPT大纲待确认',
  snapshotting: '正在生成并固定PPT页面',
  scripting: '正在生成逐页讲稿',
  submitting: '正在生成讲解音轨',
  polling: '正在生成讲解音轨',
  finalizing: '正在合成PPT讲解视频',
};

export function getPptExplainerStageText(stage: unknown): string | undefined {
  return typeof stage === 'string'
    ? PPT_EXPLAINER_STAGE_TEXT[stage as PptExplainerStage]
    : undefined;
}

export function getPptExplainerModelLabel(
  stage: unknown,
  videoModel?: string
): string | undefined {
  if (!getPptExplainerStageText(stage)) return videoModel;
  return stage === 'submitting' || stage === 'polling'
    ? videoModel || 'PPT讲解'
    : 'PPT讲解';
}

interface TaskProgressOverlayProps {
  /** 任务类型 */
  taskType: TaskType;
  /** 任务状态 */
  taskStatus: TaskStatus;
  /** 视频任务的真实进度（0-100） */
  realProgress?: number;
  /** 任务开始时间戳（用于计算模拟进度） */
  startedAt?: number;
  /** 媒体 URL（用于判断是否进入加载阶段） */
  mediaUrl?: string;
  /** 是否正在加载图片 */
  isImageLoading?: boolean;
  /** 图片加载完成回调 */
  onImageLoaded?: () => void;
  /** 图片加载失败回调 */
  onImageError?: () => void;
  /** 预估生成时间（毫秒），默认 5 分钟 */
  estimatedDuration?: number;
  /** PPT 讲解根任务的当前编排阶段 */
  pptExplainerStage?: PptExplainerStage;
}

export const TaskProgressOverlay: React.FC<TaskProgressOverlayProps> = ({
  taskType,
  taskStatus,
  realProgress,
  startedAt,
  mediaUrl,
  isImageLoading = false,
  onImageLoaded,
  onImageError,
  estimatedDuration = IMAGE_GENERATION_ESTIMATE_MS,
  pptExplainerStage,
}) => {
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const { displayProgress } = useImageTaskProgress({
    taskType,
    taskStatus,
    startedAt,
    realProgress,
    mediaUrl,
    isImageLoading,
    estimatedDuration,
  });

  // 基准尺寸：内容在此尺寸下正常显示（环形 56px + 文字约 20px + 间距）
  const BASE_CONTENT_HEIGHT = 90;
  const BASE_CONTENT_WIDTH = 80;
  // 最小缩放比例
  const MIN_SCALE = 0.5;
  // 最大缩放比例
  const MAX_SCALE = 1.2;

  // 监听容器尺寸变化，计算缩放比例
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const calculateScale = () => {
      const { width, height } = container.getBoundingClientRect();
      // 预留底部进度条空间（3px）和上下边距
      const availableHeight = height - 10;
      const availableWidth = width - 20;

      // 根据高度和宽度计算缩放比例，取较小值
      const scaleByHeight = availableHeight / BASE_CONTENT_HEIGHT;
      const scaleByWidth = availableWidth / BASE_CONTENT_WIDTH;
      const newScale = Math.min(scaleByHeight, scaleByWidth, MAX_SCALE);

      setScale(Math.max(newScale, MIN_SCALE));
    };

    // 初始计算
    calculateScale();

    // 监听尺寸变化
    const resizeObserver = new ResizeObserver(calculateScale);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  // PPT 大纲待确认仍需展示明确阶段，其他任务只在处理中显示。
  if (
    taskStatus !== TaskStatus.PROCESSING &&
    !(
      taskStatus === TaskStatus.PENDING &&
      pptExplainerStage === 'review_pending'
    )
  ) {
    return null;
  }

  const progress = displayProgress ?? 0;
  const statusText =
    getPptExplainerStageText(pptExplainerStage) ||
    (taskType === TaskType.IMAGE
      ? getImageTaskProgressStatusText(progress, !!mediaUrl, isImageLoading)
      : taskType === TaskType.AUDIO
      ? progress < 10
        ? '提交任务...'
        : progress < 45
        ? '生成旋律...'
        : progress < 85
        ? '渲染音轨...'
        : '整理结果...'
      : progress < 10
      ? '准备中...'
      : progress < 50
      ? '生成中...'
      : progress < 90
      ? '渲染中...'
      : '即将完成...');

  // 构建类名
  const overlayClassName = [
    'task-progress-overlay',
    taskType === TaskType.VIDEO || taskType === TaskType.AUDIO
      ? 'task-progress-overlay--video'
      : '',
    mediaUrl && isImageLoading ? 'task-progress-overlay--loading' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={containerRef} className={overlayClassName}>
      {/* 背景层 */}
      <div className="task-progress-overlay__backdrop" />
      <div className="task-progress-overlay__pulse" />
      <div className="task-progress-overlay__dots" />

      {/* 进度内容（等比缩放） */}
      <div
        className="task-progress-overlay__content"
        style={{ transform: `scale(${scale})` }}
      >
        <ImageGenerationProgressDisplay
          progress={progress}
          progressMode="determinate"
          statusText={statusText}
          tone={mediaUrl && isImageLoading ? 'loading' : 'default'}
          className="task-progress-overlay__progress"
        />
      </div>

      {/* 底部进度条 */}
      <div className="task-progress-overlay__bar">
        <div
          className="task-progress-overlay__bar-fill"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

export default TaskProgressOverlay;

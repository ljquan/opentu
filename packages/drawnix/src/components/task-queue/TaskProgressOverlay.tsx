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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TaskType, TaskStatus } from '../../types/task.types';
import './task-progress-overlay.scss';

// 图片生成预估时间（毫秒）- 默认 5 分钟
const IMAGE_GENERATION_ESTIMATE_MS = 5 * 60 * 1000;
// 生成阶段最大进度
const GENERATION_MAX_PROGRESS = 90;
// 进度更新间隔（毫秒）
const PROGRESS_UPDATE_INTERVAL = 1000;

// 缓动函数：开始快，结束慢（easeOutCubic）
const easeOutCubic = (t: number): number => {
  return 1 - Math.pow(1 - t, 3);
};

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
}

/**
 * 计算模拟进度
 * 使用缓动函数让进度开始快、结束慢，更符合用户心理预期
 */
function calculateSimulatedProgress(
  startedAt: number,
  estimatedDuration: number,
  maxProgress: number = GENERATION_MAX_PROGRESS
): number {
  const elapsed = Date.now() - startedAt;
  const rawProgress = Math.min(elapsed / estimatedDuration, 1);
  // 应用缓动函数
  const easedProgress = easeOutCubic(rawProgress);
  return Math.floor(easedProgress * maxProgress);
}

/**
 * 获取进度状态描述
 */
function getProgressStatusText(
  taskType: TaskType,
  progress: number,
  hasMediaUrl: boolean,
  isImageLoading: boolean
): string {
  if (taskType === TaskType.AUDIO) {
    if (progress < 10) return '提交任务...';
    if (progress < 45) return '生成旋律...';
    if (progress < 85) return '渲染音轨...';
    return '整理结果...';
  }

  if (taskType === TaskType.VIDEO) {
    if (progress < 10) return '准备中...';
    if (progress < 50) return '生成中...';
    if (progress < 90) return '渲染中...';
    return '即将完成...';
  }

  // 图片任务
  if (hasMediaUrl && isImageLoading) {
    return '加载图片...';
  }
  if (progress < 30) return '分析提示词...';
  if (progress < 60) return '生成中...';
  if (progress < 90) return '优化细节...';
  return '即将完成...';
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
}) => {
  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const [imageLoadProgress, setImageLoadProgress] = useState(0);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const imageLoadIntervalRef = useRef<ReturnType<typeof setInterval>>();

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

  // 计算最终显示的进度
  const displayProgress = useCallback(() => {
    // 视频任务：使用真实进度
    if (taskType === TaskType.VIDEO || taskType === TaskType.AUDIO) {
      return realProgress ?? 0;
    }

    // 图片任务
    if (mediaUrl && isImageLoading) {
      // 已获取链接，正在加载图片：90% + 图片加载进度
      return GENERATION_MAX_PROGRESS + Math.floor(imageLoadProgress * 10 / 100);
    }

    // 生成阶段：使用模拟进度
    return simulatedProgress;
  }, [taskType, realProgress, mediaUrl, isImageLoading, imageLoadProgress, simulatedProgress]);

  // 模拟进度更新（图片任务）
  useEffect(() => {
    if (taskType !== TaskType.IMAGE || taskStatus !== TaskStatus.PROCESSING) {
      return;
    }

    if (!startedAt) {
      setSimulatedProgress(0);
      return;
    }

    // 如果已经有媒体 URL，停止模拟进度
    if (mediaUrl) {
      setSimulatedProgress(GENERATION_MAX_PROGRESS);
      return;
    }

    // 重试时重置进度：先设为 0，再开始计算
    setSimulatedProgress(0);

    // 开始模拟进度
    const updateProgress = () => {
      const progress = calculateSimulatedProgress(startedAt, estimatedDuration);
      setSimulatedProgress(progress);
    };

    // 延迟一帧后开始更新，确保重置生效
    requestAnimationFrame(updateProgress);

    // 定时更新
    intervalRef.current = setInterval(updateProgress, PROGRESS_UPDATE_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [taskType, taskStatus, startedAt, mediaUrl, estimatedDuration]);

  // 图片加载进度模拟
  useEffect(() => {
    if (!mediaUrl || !isImageLoading || taskType !== TaskType.IMAGE) {
      // 重置图片加载进度
      setImageLoadProgress(0);
      return;
    }

    // 重置并开始模拟图片加载进度（约 5 秒完成）
    setImageLoadProgress(0);
    const startTime = Date.now();
    const loadDuration = 5000; // 5 秒

    const updateLoadProgress = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / loadDuration, 1) * 100;
      setImageLoadProgress(progress);

      if (progress >= 100) {
        if (imageLoadIntervalRef.current) {
          clearInterval(imageLoadIntervalRef.current);
        }
      }
    };

    imageLoadIntervalRef.current = setInterval(updateLoadProgress, 100);

    return () => {
      if (imageLoadIntervalRef.current) {
        clearInterval(imageLoadIntervalRef.current);
      }
    };
  }, [mediaUrl, isImageLoading, taskType]);

  // 只在处理中状态显示
  if (taskStatus !== TaskStatus.PROCESSING) {
    return null;
  }

  const progress = displayProgress();
  const statusText = getProgressStatusText(taskType, progress, !!mediaUrl, isImageLoading);

  // 构建类名
  const overlayClassName = [
    'task-progress-overlay',
    taskType === TaskType.VIDEO || taskType === TaskType.AUDIO
      ? 'task-progress-overlay--video'
      : '',
    mediaUrl && isImageLoading ? 'task-progress-overlay--loading' : '',
  ].filter(Boolean).join(' ');

  return (
    <div ref={containerRef} className={overlayClassName}>
      {/* 背景层 */}
      <div className="task-progress-overlay__backdrop" />

      {/* 进度内容（等比缩放） */}
      <div 
        className="task-progress-overlay__content"
        style={{ transform: `scale(${scale})` }}
      >
        {/* 环形进度条 */}
        <div className="task-progress-overlay__ring">
          <svg viewBox="0 0 100 100" className="task-progress-overlay__ring-svg">
            {/* 背景圆环 */}
            <circle
              className="task-progress-overlay__ring-bg"
              cx="50"
              cy="50"
              r="42"
              fill="none"
              strokeWidth="6"
            />
            {/* 进度圆环 */}
            <circle
              className="task-progress-overlay__ring-progress"
              cx="50"
              cy="50"
              r="42"
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              style={{
                strokeDasharray: `${2 * Math.PI * 42}`,
                strokeDashoffset: `${2 * Math.PI * 42 * (1 - progress / 100)}`,
              }}
            />
          </svg>
          {/* 百分比文字 */}
          <div className="task-progress-overlay__percentage">
            {progress}%
          </div>
        </div>

        {/* 状态文字 */}
        <div className="task-progress-overlay__status">
          {statusText}
        </div>
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

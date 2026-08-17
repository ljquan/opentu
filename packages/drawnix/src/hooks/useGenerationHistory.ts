/**
 * useGenerationHistory Hook
 *
 * Provides generation history from task queue data.
 * Replaces the old localStorage-based history management.
 */

import { useMemo } from 'react';
import { useTaskQueue } from './useTaskQueue';
import { isUserVisibleTaskResult, TaskType } from '../types/task.types';
import {
  ImageHistoryItem,
  VideoHistoryItem,
  HistoryItem
} from '../components/generation-history/generation-history';

/**
 * Hook for accessing generation history
 * History is derived from completed tasks in the task queue
 *
 * @returns Object containing image and video history arrays
 */
export function useGenerationHistory() {
  const { completedTasks } = useTaskQueue();

  // Convert completed image tasks to history items
  const imageHistory = useMemo((): ImageHistoryItem[] => {
    return completedTasks
      .filter(
        (task) =>
          task.type === TaskType.IMAGE &&
          isUserVisibleTaskResult(task.result) &&
          task.result?.url
      )
      .map(task => ({
        id: task.id,
        type: 'image' as const,
        prompt: task.params.prompt,
        timestamp: task.completedAt || task.createdAt,
        imageUrl: task.result!.url,
        width: task.result!.width || 1024,
        height: task.result!.height || 1024,
        uploadedImages: task.params.uploadedImages, // 包含参考图片
      }))
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first
  }, [completedTasks]);

  // Convert completed video tasks to history items
  const videoHistory = useMemo((): VideoHistoryItem[] => {
    return completedTasks
      .filter(
        (task) =>
          task.type === TaskType.VIDEO &&
          isUserVisibleTaskResult(task.result) &&
          task.result?.url
      )
      .map(task => ({
        id: task.id,
        type: 'video' as const,
        prompt: task.params.prompt,
        timestamp: task.completedAt || task.createdAt,
        imageUrl: task.result!.thumbnailUrl || task.result!.url, // Use thumbnail if available
        width: task.result!.width || 400,
        height: task.result!.height || 225,
        duration: task.result!.duration,
        previewUrl: task.result!.url,
        downloadUrl: task.result!.url,
        uploadedImage: task.params.uploadedImage, // 包含参考图片
      }))
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first
  }, [completedTasks]);

  // Combined history (both images and videos)
  const allHistory = useMemo((): HistoryItem[] => {
    return [...imageHistory, ...videoHistory]
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [imageHistory, videoHistory]);

  return {
    imageHistory,
    videoHistory,
    allHistory,
  };
}

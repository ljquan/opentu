/**
 * Long Video Chain Service
 *
 * 处理长视频片段的串行生成：
 * 1. 监听视频任务完成事件
 * 2. 提取已完成视频的尾帧
 * 3. 创建下一个视频任务（尾帧作为首帧）
 * 4. 所有片段完成后，合并视频并插入画布
 */

import { taskQueueService } from './task-queue';
import { TaskStatus, TaskType, Task } from '../types/task.types';
import { extractLastFrame } from '@aitu/utils';
import { mergeVideos, type MergeProgressCallback, type TransitionConfig } from './video-merge-webcodecs';
import type { TransitionHint } from '../mcp/tools/video-analyze';
import {
  createLongVideoSegmentTask,
  type LongVideoMeta,
  type VideoSegmentScript,
} from './canvas-operations/long-video';
import { quickInsert } from './canvas-operations/canvas-insertion';

/** 长视频批次跟踪信息 */
interface LongVideoBatch {
  batchId: string;
  totalSegments: number;
  completedSegments: Map<number, string>; // segmentIndex -> videoUrl
  /** 已处理的片段索引（防止重复处理） */
  processedSegments: Set<number>;
  /** 正在创建下一个任务的片段索引（防止并发创建） */
  creatingNextFor: number | null;
  isMerging: boolean;
  mergeCompleted: boolean;
  /** 完整脚本列表（从首个任务 meta 中提取） */
  scripts: VideoSegmentScript[];
  /** 角色参考图 URL 列表，传递给每个片段任务 */
  characterReferenceUrls?: string[];
  /** 角色一致性描述，传递给每个片段任务 */
  characterDescription?: string;
}

/**
 * 检查任务是否是长视频链的一部分
 */
function isLongVideoTask(task: Task): boolean {
  return !!(task.params as any)?.longVideoMeta;
}

/**
 * 获取长视频元数据
 */
function getLongVideoMeta(task: Task): LongVideoMeta | null {
  return (task.params as any)?.longVideoMeta || null;
}

/**
 * Long Video Chain Service 类
 * 单例模式，管理长视频的串行生成和合并
 */
class LongVideoChainService {
  private static instance: LongVideoChainService;
  private isInitialized = false;
  /** 跟踪每个批次的完成状态 */
  private batches: Map<string, LongVideoBatch> = new Map();
  /** 服务初始化时间戳，用于过滤旧任务 */
  private initTimestamp: number = 0;

  private constructor() {}

  static getInstance(): LongVideoChainService {
    if (!LongVideoChainService.instance) {
      LongVideoChainService.instance = new LongVideoChainService();
    }
    return LongVideoChainService.instance;
  }

  /**
   * 初始化服务 - 开始监听任务事件
   */
  initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.initTimestamp = Date.now();

    // console.log('[LongVideoChain] Service initialized at', this.initTimestamp);

    // 订阅任务更新事件
    taskQueueService.observeTaskUpdates().subscribe(event => {
      // 只处理视频任务完成事件
      if (
        event.type === 'taskUpdated' &&
        event.task.status === TaskStatus.COMPLETED &&
        event.task.type === TaskType.VIDEO &&
        isLongVideoTask(event.task)
      ) {
        // 忽略服务初始化之前完成的任务（从存储恢复的旧任务）
        const completedAt = event.task.completedAt || 0;
        if (completedAt < this.initTimestamp) {
          // console.log(`[LongVideoChain] Ignoring old completed task ${event.task.id}, completedAt: ${completedAt}`);
          return;
        }

        this.handleSegmentCompleted(event.task).catch(error => {
          console.error('[LongVideoChain] Error handling completed segment:', error);
        });
      }
    });
  }

  /**
   * 处理已完成的视频片段
   */
  private async handleSegmentCompleted(task: Task): Promise<void> {
    const meta = getLongVideoMeta(task);
    if (!meta) return;

    const { segmentIndex, totalSegments, scripts, batchId } = meta;
    const videoUrl = task.result?.url;

    // 获取或创建批次跟踪
    let batch = this.batches.get(batchId);
    if (!batch) {
      batch = {
        batchId,
        totalSegments,
        completedSegments: new Map(),
        processedSegments: new Set(),
        creatingNextFor: null,
        isMerging: false,
        mergeCompleted: false,
        scripts: scripts || [],
        characterReferenceUrls: meta.characterReferenceUrls,
        characterDescription: meta.characterDescription,
      };
      this.batches.set(batchId, batch);
    }

    // 防止重复处理同一个片段
    if (batch.processedSegments.has(segmentIndex)) {
      // console.log(`[LongVideoChain] Segment ${segmentIndex} already processed, skipping`);
      return;
    }

    // 标记为已处理
    batch.processedSegments.add(segmentIndex);

    // console.log(`[LongVideoChain] Segment ${segmentIndex}/${totalSegments} completed`);

    // 记录已完成的片段
    if (videoUrl) {
      batch.completedSegments.set(segmentIndex, videoUrl);
    }

    // 检查是否所有片段都已完成
    if (batch.completedSegments.size === totalSegments) {
      // 所有片段完成，触发合并
      await this.mergeAndInsert(batch);
      return;
    }

    // 防止并发创建下一个任务
    if (batch.creatingNextFor === segmentIndex) {
      // console.log(`[LongVideoChain] Already creating next segment for ${segmentIndex}, skipping`);
      return;
    }

    // 还有片段未完成，创建下一个任务
    if (segmentIndex < totalSegments) {
      batch.creatingNextFor = segmentIndex;
      try {
        await this.createNextSegment(task, meta, scripts, videoUrl, batch.characterReferenceUrls, batch.characterDescription);
      } finally {
        batch.creatingNextFor = null;
      }
    }
  }

  /**
   * 创建下一个视频片段任务
   */
  private async createNextSegment(
    _currentTask: Task,
    currentMeta: LongVideoMeta,
    scripts: VideoSegmentScript[],
    videoUrl?: string,
    characterReferenceUrls?: string[],
    characterDescription?: string
  ): Promise<void> {
    const nextIndex = currentMeta.segmentIndex + 1;
    const nextScript = scripts.find(s => s.index === nextIndex);

    if (!nextScript) {
      console.error(`[LongVideoChain] Script not found for segment ${nextIndex}`);
      return;
    }

    // 提取尾帧（如果有视频URL）
    let lastFrameDataUrl: string | undefined;
    if (videoUrl) {
      try {
        // console.log(`[LongVideoChain] Extracting last frame from segment ${currentMeta.segmentIndex}...`);
        const lastFrame = await extractLastFrame(videoUrl);
        lastFrameDataUrl = lastFrame.dataUrl;
        // console.log(`[LongVideoChain] Last frame extracted: ${lastFrame.width}x${lastFrame.height}`);
      } catch (error) {
        console.error(`[LongVideoChain] Failed to extract last frame:`, error);
      }
    }

    // 构建新的元数据
    const nextMeta: LongVideoMeta = {
      ...currentMeta,
      segmentIndex: nextIndex,
      needsLastFrame: nextIndex < currentMeta.totalSegments,
      characterReferenceUrls: characterReferenceUrls ?? currentMeta.characterReferenceUrls,
      characterDescription: characterDescription ?? currentMeta.characterDescription,
    };

    // 创建任务
    const task = createLongVideoSegmentTask(nextScript, nextMeta, lastFrameDataUrl);
    // console.log(`[LongVideoChain] Created segment ${nextIndex}/${currentMeta.totalSegments}: ${task.id}`);
  }

  /**
   * 合并所有视频片段并插入画布
   */
  private async mergeAndInsert(batch: LongVideoBatch): Promise<void> {
    if (batch.isMerging || batch.mergeCompleted) {
      return;
    }

    batch.isMerging = true;
    // console.log(`[LongVideoChain] Starting merge for batch ${batch.batchId}`);

    try {
      // 按顺序收集所有视频URL
      const videoUrls: string[] = [];
      for (let i = 1; i <= batch.totalSegments; i++) {
        const url = batch.completedSegments.get(i);
        if (url) {
          videoUrls.push(url);
        }
      }

      if (videoUrls.length === 0) {
        console.error('[LongVideoChain] No video URLs to merge');
        return;
      }

      // console.log(`[LongVideoChain] Merging ${videoUrls.length} videos...`);

      // 从任务 meta 中提取转场信息
      const transitions = this.extractTransitions(batch);

      // 合并视频
      const onProgress: MergeProgressCallback = (progress, stage, message) => {
        const msg = message || `${stage} ${progress.toFixed(1)}%`;
        // console.log(`[LongVideoChain] Merge progress: ${msg}`);
        // TODO: 可以在这里更新 UI 显示进度
      };

      const result = await mergeVideos(videoUrls, onProgress, {
        transitions,
        transitionDuration: 0.5,
      });

      // console.log(`[LongVideoChain] Merge completed, duration: ${result.duration}s`);

      // 插入画布
      await this.insertMergedVideo(result.url);

      batch.mergeCompleted = true;
      // console.log(`[LongVideoChain] Merged video inserted to canvas`);
      
      // 清理 batch 释放内存
      this.cleanupBatch(batch.batchId);
    } catch (error) {
      console.error('[LongVideoChain] Merge failed:', error);
      // 失败时也要清理，避免内存泄漏
      this.cleanupBatch(batch.batchId);
    } finally {
      batch.isMerging = false;
    }
  }

  /**
   * 将合并后的视频插入画布
   */
  private async insertMergedVideo(videoUrl: string): Promise<void> {
    try {
      // 使用 quickInsert 插入视频
      await quickInsert('video', videoUrl);
      // console.log(`[LongVideoChain] Merged video inserted to canvas`);
    } catch (error) {
      console.error('[LongVideoChain] Failed to insert video to canvas:', error);
      // 回退：输出视频URL供用户手动下载
      // console.log(`[LongVideoChain] Merged video URL: ${videoUrl}`);
    }
  }

  /**
   * 从批次的脚本中提取转场信息
   */
  private extractTransitions(batch: LongVideoBatch): TransitionHint[] {
    if (!batch.scripts || batch.scripts.length === 0) return [];
    return batch.scripts
      .sort((a, b) => a.index - b.index)
      .slice(0, -1)
      .map(s => ((s as any).transition_hint as TransitionHint) || 'cut');
  }

  /**
   * 清理已完成的批次，释放内存
   */
  private cleanupBatch(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (batch) {
      // 清理内部 Map 和 Set
      batch.completedSegments.clear();
      batch.processedSegments.clear();
      // 从 batches Map 中删除
      this.batches.delete(batchId);
    }
  }

  /**
   * 获取批次状态（用于UI显示）
   */
  getBatchStatus(batchId: string): {
    completed: number;
    total: number;
    isMerging: boolean;
    mergeCompleted: boolean;
  } | null {
    const batch = this.batches.get(batchId);
    if (!batch) return null;

    return {
      completed: batch.completedSegments.size,
      total: batch.totalSegments,
      isMerging: batch.isMerging,
      mergeCompleted: batch.mergeCompleted,
    };
  }
}

// 导出单例实例
export const longVideoChainService = LongVideoChainService.getInstance();

/**
 * 初始化长视频链服务
 * 应在应用启动时调用一次
 */
export function initializeLongVideoChainService(): void {
  longVideoChainService.initialize();
}

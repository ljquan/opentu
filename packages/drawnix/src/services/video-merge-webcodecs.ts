/**
 * Video Merge Service (WebCodecs)
 *
 * 使用 Chrome 原生 WebCodecs API 合并视频
 * 优势：0 依赖、硬件加速、无需下载 FFmpeg
 * 劣势：需要重新编码（有轻微质量损失）
 */

import type { TransitionHint } from '../mcp/tools/video-analyze';

/** 转场配置 */
export interface TransitionConfig {
  /** 每对相邻视频之间的转场类型，长度 = videoUrls.length - 1 */
  transitions?: TransitionHint[];
  /** 转场时长（秒），默认 0.5 */
  transitionDuration?: number;
}

/** 合并进度回调 */
export interface MergeProgressCallback {
  (progress: number, stage: 'downloading' | 'decoding' | 'encoding' | 'finalizing', message?: string): void;
}

/** 合并结果 */
export interface MergeResult {
  blob: Blob;
  url: string;
  duration: number;
  taskId?: string; // IndexedDB 中的任务ID，用于刷新后恢复
}

/** 视频帧数据 */
interface VideoFrameData {
  frame: VideoFrame;
  timestamp: number;
}

/**
 * 检查浏览器是否支持 WebCodecs
 */
function checkWebCodecsSupport(): void {
  if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') {
    throw new Error(
      '当前浏览器不支持 WebCodecs API。\n' +
      '请使用 Chrome 94+ 或 Edge 94+ 浏览器。'
    );
  }
}

/**
 * 从视频文件提取编码配置
 */
async function extractVideoConfig(videoBlob: Blob): Promise<{
  width: number;
  height: number;
  frameRate: number;
}> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      // 假设 30 fps（实际项目中可以从 MP4 元数据读取）
      const frameRate = 30;

      URL.revokeObjectURL(video.src);
      resolve({ width, height, frameRate });
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('无法读取视频元数据'));
    };

    video.src = URL.createObjectURL(videoBlob);
  });
}

/**
 * 解码视频并提取所有帧
 */
async function decodeVideo(
  videoBlob: Blob,
  onProgress?: (progress: number) => void
): Promise<VideoFrameData[]> {
  // console.log('[WebCodecs] Decoding video...');

  const frames: VideoFrameData[] = [];
  let processedChunks = 0;
  let totalChunks = 0;

  // 创建 VideoDecoder
  const decoder = new VideoDecoder({
    output: (frame) => {
      frames.push({
        frame: frame.clone(), // 克隆帧以避免引用问题
        timestamp: frame.timestamp || 0,
      });
      frame.close();

      processedChunks++;
      if (onProgress && totalChunks > 0) {
        onProgress((processedChunks / totalChunks) * 100);
      }
    },
    error: (error) => {
      console.error('[WebCodecs] Decoder error:', error);
    },
  });

  // 配置解码器（使用通用配置）
  decoder.configure({
    codec: 'vp09.00.10.08', // VP9 编码
    // 注意：实际项目中应该从 MP4 文件解析真实的编码参数
  });

  // 读取视频数据并解码
  // 注意：这是简化实现，实际需要使用 MP4Box.js 等库来解封装 MP4
  // 这里我们使用 MediaSource API 的简化方案

  const arrayBuffer = await videoBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // 创建 EncodedVideoChunk（简化实现）
  // 实际项目中需要正确解析 MP4 的 mdat box
  const chunk = new EncodedVideoChunk({
    type: 'key',
    timestamp: 0,
    data: uint8Array,
  });

  totalChunks = 1;
  decoder.decode(chunk);

  await decoder.flush();
  decoder.close();

  // console.log(`[WebCodecs] Decoded ${frames.length} frames`);
  return frames;
}

/**
 * 检测最佳输出格式
 */
function getBestVideoFormat(): { mimeType: string; extension: string } {
  // 检测浏览器支持的格式
  const formats = [
    { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' }, // Safari 支持
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' }, // Chrome 支持
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' }, // 备用
  ];

  for (const format of formats) {
    if (MediaRecorder.isTypeSupported(format.mimeType)) {
      // console.log(`[WebCodecs] Using format: ${format.mimeType}`);
      return format;
    }
  }

  // 降级到默认
  console.warn('[WebCodecs] No preferred format supported, using default');
  return { mimeType: 'video/webm', extension: 'webm' };
}

/**
 * 使用 MediaRecorder 合并视频（更简单的方案）
 */
async function mergeVideosWithMediaRecorder(
  videoUrls: string[],
  onProgress?: MergeProgressCallback,
  transitionConfig?: TransitionConfig
): Promise<MergeResult> {
  // console.log('[WebCodecs] Using MediaRecorder to merge videos...');

  // 创建一个画布
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  if (!ctx) {
    throw new Error('无法创建 Canvas 2D 上下文');
  }

  // 获取第一个视频的尺寸
  const firstVideo = document.createElement('video');
  firstVideo.crossOrigin = 'anonymous';
  firstVideo.src = videoUrls[0];

  await new Promise<void>((resolve, reject) => {
    firstVideo.onloadedmetadata = () => resolve();
    firstVideo.onerror = () => reject(new Error('无法加载第一个视频'));
  });

  canvas.width = firstVideo.videoWidth;
  canvas.height = firstVideo.videoHeight;

  // console.log(`[WebCodecs] Canvas size: ${canvas.width}x${canvas.height}`);

  // 获取最佳格式
  const format = getBestVideoFormat();

  // 创建音频上下文用于合并音频
  const audioContext = new AudioContext();
  const audioDestination = audioContext.createMediaStreamDestination();

  // 创建 MediaRecorder（包含视频和音频）
  const videoStream = canvas.captureStream(30); // 30 fps
  const combinedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);

  const mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType: format.mimeType,
    videoBitsPerSecond: 8000000, // 8 Mbps
    audioBitsPerSecond: 128000,  // 128 kbps for audio
  });

  // console.log(`[WebCodecs] MediaRecorder tracks: ${combinedStream.getTracks().length} (video: ${combinedStream.getVideoTracks().length}, audio: ${combinedStream.getAudioTracks().length})`);

  const recordedChunks: Blob[] = [];

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  // 开始录制
  mediaRecorder.start();
  onProgress?.(0, 'encoding', '开始录制视频...');

  // 逐个播放和录制视频
  const transitions = transitionConfig?.transitions || [];
  const tDur = transitionConfig?.transitionDuration ?? 0.5;

  for (let i = 0; i < videoUrls.length; i++) {
    // console.log(`[WebCodecs] Processing video ${i + 1}/${videoUrls.length}`);
    onProgress?.(
      (i / videoUrls.length) * 100,
      'encoding',
      `正在处理视频 ${i + 1}/${videoUrls.length}...`
    );

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = videoUrls[i];
    // 不要静音 - 我们需要捕获音频!
    video.volume = 1.0;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`无法加载视频 ${i + 1}`));
    });

    // 创建音频源并连接到音频目标
    let audioSource: MediaElementAudioSourceNode | null = null;
    try {
      audioSource = audioContext.createMediaElementSource(video);
      audioSource.connect(audioDestination);
      // console.log(`[WebCodecs] Connected audio from video ${i + 1}`);
    } catch (error) {
      console.warn(`[WebCodecs] Failed to connect audio from video ${i + 1}:`, error);
    }

    // 播放视频并绘制到画布（支持转场效果）
    const transitionType = i < transitions.length ? transitions[i] : 'cut';
    const needsFadeOut = transitionType === 'dissolve' || transitionType === 'fade_to_black';

    await new Promise<void>((resolve) => {
      video.play().catch(err => {
        console.warn(`[WebCodecs] Failed to play video ${i + 1}:`, err);
      });

      const drawFrame = () => {
        if (video.ended) {
          resolve();
          return;
        }

        // 计算转场 alpha
        let alpha = 1.0;
        if (needsFadeOut && video.duration > 0) {
          const timeLeft = video.duration - video.currentTime;
          if (timeLeft < tDur) {
            alpha = Math.max(0, timeLeft / tDur);
          }
        }

        // fade_to_black: 先画黑底
        if (transitionType === 'fade_to_black' && alpha < 1.0) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.globalAlpha = alpha;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1.0;

        requestAnimationFrame(drawFrame);
      };

      video.onended = () => resolve();
      drawFrame();
    });

    // 断开音频源
    if (audioSource) {
      audioSource.disconnect();
    }

    video.pause();
    video.src = '';
    video.load();
  }

  // 停止录制
  // console.log('[WebCodecs] Finalizing...');
  onProgress?.(100, 'finalizing', '正在生成最终视频...');

  await new Promise<void>((resolve) => {
    mediaRecorder.onstop = () => resolve();
    mediaRecorder.stop();
  });

  // 清理音频上下文
  await audioContext.close();
  // console.log('[WebCodecs] Audio context closed');

  // 合并所有录制的数据
  // 注意：不包含 codecs 参数，避免 Blob URL 和下载时的兼容性问题
  const simpleMimeType = format.mimeType.split(';')[0]; // 'video/webm;codecs=vp9' → 'video/webm'
  const finalBlob = new Blob(recordedChunks, { type: simpleMimeType });

  // 计算总时长（假设每段 8 秒）
  const duration = videoUrls.length * 8;

  // console.log(`[WebCodecs] Merge complete, size: ${(finalBlob.size / 1024 / 1024).toFixed(2)} MB, format: ${simpleMimeType} (original: ${format.mimeType})`);

  // 缓存到 Cache API（由 Service Worker 处理）
  try {
    const { unifiedCacheService } = await import('./unified-cache-service');
    const taskId = `merged-video-${Date.now()}`;

    // 虚拟路径 URL（稳定，由 Service Worker 拦截并返回缓存内容）
    // 格式: /__aitu_cache__/video/{taskId}.mp4
    const stableUrl = `/__aitu_cache__/video/${taskId}.mp4`;

    // 使用相对路径作为缓存 key，避免代理场景下 origin 不一致导致缓存查找失败
    const cacheKey = stableUrl;

    // 缓存 blob
    await unifiedCacheService.cacheMediaFromBlob(
      cacheKey,
      finalBlob,
      'video',
      { taskId }
    );
    // console.log(`[WebCodecs] Video cached: ${cacheKey}, mimeType: ${simpleMimeType}`);

    return { blob: finalBlob, url: stableUrl, duration, taskId };
  } catch (cacheError) {
    // 降级到 blob URL（页面刷新后会失效）
    console.warn('[WebCodecs] Failed to cache video, using blob URL:', cacheError);
    const url = URL.createObjectURL(finalBlob);
    return { blob: finalBlob, url, duration };
  }
}

/**
 * Video Merge Service (WebCodecs)
 */
class VideoMergeWebCodecsService {
  private static instance: VideoMergeWebCodecsService;

  private constructor() {}

  static getInstance(): VideoMergeWebCodecsService {
    if (!VideoMergeWebCodecsService.instance) {
      VideoMergeWebCodecsService.instance = new VideoMergeWebCodecsService();
    }
    return VideoMergeWebCodecsService.instance;
  }

  /**
   * 合并多个视频
   */
  async mergeVideos(
    videoUrls: string[],
    onProgress?: MergeProgressCallback,
    transitionConfig?: TransitionConfig
  ): Promise<MergeResult> {
    if (videoUrls.length === 0) {
      throw new Error('没有视频可合并');
    }

    if (videoUrls.length === 1) {
      // 只有一个视频，直接返回
      onProgress?.(0, 'downloading', '下载视频...');
      const response = await fetch(videoUrls[0]);
      const blob = await response.blob();
      return {
        blob,
        url: URL.createObjectURL(blob),
        duration: 0,
      };
    }

    checkWebCodecsSupport();

    try {
      // MediaRecorder 按顺序消费 URL；不要预先把全部片段复制到内存。
      return await mergeVideosWithMediaRecorder(videoUrls, onProgress, transitionConfig);
    } catch (error) {
      console.error('[WebCodecs] Merge failed:', error);
      throw new Error(`视频合并失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 检查是否支持
   */
  static isSupported(): boolean {
    return typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined';
  }
}

// 导出单例
export const videoMergeWebCodecsService = VideoMergeWebCodecsService.getInstance();

/**
 * 便捷方法：合并视频
 */
export async function mergeVideos(
  videoUrls: string[],
  onProgress?: MergeProgressCallback,
  transitionConfig?: TransitionConfig
): Promise<MergeResult> {
  return videoMergeWebCodecsService.mergeVideos(videoUrls, onProgress, transitionConfig);
}

/**
 * 检查浏览器支持
 */
export function isWebCodecsSupported(): boolean {
  return VideoMergeWebCodecsService.isSupported();
}

/**
 * 视频帧图片缓存工具
 *
 * 将本地视频通过 <video> + <canvas> 提取的帧图片缓存到 Cache Storage
 */

import { unifiedCacheService } from '../services/unified-cache-service';

/**
 * 将 Blob 帧图片缓存到 Cache Storage
 * @returns 缓存 URL (/__aitu_cache__/...)
 */
export async function cacheFrameBlob(
  blob: Blob,
  shotId: string,
  frameType: 'first' | 'last'
): Promise<string> {
  if (blob.size === 0) {
    throw new Error('Invalid frame blob: size is 0');
  }

  const cacheUrl = `/__aitu_cache__/video-frame_${shotId}_${frameType}`;

  await unifiedCacheService.cacheMediaFromBlob(cacheUrl, blob, 'image', {
    metadata: {
      source: 'video-frame',
      shotId,
      frameType,
    },
  });

  return cacheUrl;
}

/**
 * 从本地视频文件中按时间点提取帧图片
 * 使用 <video> + <canvas> 方案，仅适用于本地上传的视频
 *
 * @param videoFile 本地视频文件
 * @param timestamps 需要提取帧的时间点列表（秒）
 * @param onProgress 进度回调
 * @returns 按顺序返回每个时间点的帧 Blob（提取失败的为 null）
 */
export async function extractFramesFromVideo(
  videoFile: File,
  timestamps: number[],
  onProgress?: (current: number, total: number) => void
): Promise<(Blob | null)[]> {
  const videoUrl = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';

  try {
    // 等待视频元数据加载
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));
      video.src = videoUrl;
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // 限制输出分辨率，节省缓存空间
    const maxW = 320;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const results: (Blob | null)[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      onProgress?.(i, timestamps.length);
      try {
        const blob = await seekAndCapture(video, canvas, ctx, timestamps[i]);
        results.push(blob);
      } catch {
        results.push(null);
      }
    }

    onProgress?.(timestamps.length, timestamps.length);
    return results;
  } finally {
    URL.revokeObjectURL(videoUrl);
    video.src = '';
  }
}

/**
 * 从视频 URL 提取首帧或尾帧并缓存
 * @param videoUrl 视频地址（支持 /__aitu_cache__/ 虚拟路径和 http(s) URL）
 * @param shotId 镜头 ID，用于缓存 key
 * @param frameType 缓存 key 中的帧类型（决定存储位置）
 * @param extractPosition 实际提取位置，默认与 frameType 一致
 * @returns 缓存后的 URL，失败返回 null
 */
export async function extractFrameFromUrl(
  videoUrl: string,
  shotId: string,
  frameType: 'first' | 'last',
  extractPosition?: 'first' | 'last'
): Promise<string | null> {
  const position = extractPosition || frameType;
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));
      video.src = videoUrl;
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const maxW = 1280;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    // 首帧取 0.1s（避免纯黑），尾帧取 duration - 0.1s
    const timestamp = position === 'first'
      ? Math.min(0.1, video.duration)
      : Math.max(0, video.duration - 0.1);

    const blob = await seekAndCapture(video, canvas, ctx, timestamp);
    return await cacheFrameBlob(blob, shotId, frameType);
  } catch (e) {
    console.debug('[video-frame-cache] extractFrameFromUrl failed:', e);
    return null;
  } finally {
    video.src = '';
  }
}

/** seek 到指定时间并截取当前帧 */
function seekAndCapture(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  timestamp: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const clampedTime = Math.min(Math.max(0, timestamp), video.duration || 0);
    video.currentTime = clampedTime;

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size > 0) {
            resolve(blob);
          } else {
            reject(new Error('toBlob returned empty'));
          }
        },
        'image/jpeg',
        0.85
      );
    };

    video.addEventListener('seeked', onSeeked);
  });
}

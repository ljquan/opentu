/**
 * Video Thumbnail Generator (Main Thread)
 * 
 * 在主线程中从视频 Blob 生成预览图
 * 使用 video 元素和 canvas，因为 Service Worker 没有 DOM
 */

const THUMBNAIL_QUALITY = 0.8;
const VIDEO_SEEK_TIME = 0.1; // 0.1秒处，避免完全黑屏

/**
 * 计算预览图尺寸（保持宽高比）
 */
function calculateThumbnailSize(
  originalWidth: number,
  originalHeight: number,
  maxSize: number
): { width: number; height: number } {
  const aspectRatio = originalWidth / originalHeight;
  
  let width = maxSize;
  let height = maxSize;
  
  if (aspectRatio > 1) {
    // 横向视频
    height = maxSize / aspectRatio;
  } else {
    // 纵向视频
    width = maxSize * aspectRatio;
  }
  
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * 从视频 Blob 生成预览图（主线程中）
 * @param blob 视频 Blob
 * @param maxSize 最大尺寸（默认 400）
 * @returns 预览图 Blob（JPEG格式）
 */
export async function generateVideoThumbnailFromBlob(
  blob: Blob,
  maxSize: number = 400
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const videoUrl = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;

    let isResolved = false;

    const cleanup = () => {
      URL.revokeObjectURL(videoUrl);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      video.src = '';
      video.load();
    };

    const handleLoadedData = () => {
      try {
        // 设置为第一帧（0.1秒处，避免完全黑屏）
        video.currentTime = VIDEO_SEEK_TIME;
      } catch (error) {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(new Error('Failed to seek video'));
        }
      }
    };

    const handleSeeked = () => {
      if (isResolved) return;

      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }

        // 计算预览图尺寸
        const { width, height } = calculateThumbnailSize(
          video.videoWidth,
          video.videoHeight,
          maxSize
        );

        canvas.width = width;
        canvas.height = height;

        // 绘制视频帧
        ctx.drawImage(video, 0, 0, width, height);

        // 转换为 Blob
        canvas.toBlob(
          (thumbnailBlob) => {
            if (isResolved) return;
            isResolved = true;
            cleanup();

            if (thumbnailBlob) {
              resolve(thumbnailBlob);
            } else {
              reject(new Error('Failed to convert canvas to blob'));
            }
          },
          'image/jpeg',
          THUMBNAIL_QUALITY
        );
      } catch (error) {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(error instanceof Error ? error : new Error('Failed to generate thumbnail'));
        }
      }
    };

    const handleError = () => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        reject(new Error('Failed to load video'));
      }
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    // 设置超时（30秒）
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        reject(new Error('Video thumbnail generation timeout'));
      }
    }, 30000);

    // 开始加载视频
    video.src = videoUrl;

    // 清理超时
    const originalResolve = resolve;
    const originalReject = reject;
    resolve = (value) => {
      clearTimeout(timeout);
      originalResolve(value);
    };
    reject = (error) => {
      clearTimeout(timeout);
      originalReject(error);
    };
  });
}

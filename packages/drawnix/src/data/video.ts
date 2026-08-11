import {
  PlaitBoard,
  Point,
} from '@plait/core';
import { getInsertionPointForSelectedElements, getInsertionPointBelowBottommostElement, scrollToPointIfNeeded } from '../utils/selection-utils';
import { analytics } from '../utils/posthog-analytics';
import { getInsertionPointFromSavedSelection } from '../utils/canvas-insertion-layout';

/**
 * 获取视频真实尺寸的接口
 */
export interface VideoDimensions {
  width: number;
  height: number;
}

/**
 * 获取视频的真实尺寸
 * @param videoUrl 视频URL
 * @returns Promise<VideoDimensions> 视频的宽度和高度
 */
// 防止重复调用的缓存
const dimensionsCache = new Map<string, Promise<VideoDimensions>>();

export const getVideoDimensions = (videoUrl: string): Promise<VideoDimensions> => {
  // 检查缓存
  if (dimensionsCache.has(videoUrl)) {
    // console.log('[getVideoDimensions] Using cached dimensions for:', videoUrl);
    return dimensionsCache.get(videoUrl)!;
  }

  // console.log('[getVideoDimensions] Loading video metadata for:', videoUrl);

  const promise = new Promise<VideoDimensions>((resolve) => {
    const video = document.createElement('video');
    // Remove crossOrigin to avoid CORS issues with external video URLs
    // video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';  // 只加载元数据，不加载整个视频
    
    // 设置超时时间，防止长时间等待
    const timeout = setTimeout(() => {
      console.warn('Video dimensions loading timeout for:', videoUrl);
      video.src = '';
      
      // 从缓存中移除超时的URL
      dimensionsCache.delete(videoUrl);
      
      // 超时时返回默认尺寸而不是抛出错误
      resolve({
        width: 400,
        height: 225
      });
    }, 10000); // 10秒超时
    
    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      try {
        const dimensions: VideoDimensions = {
          width: video.videoWidth || 400, // 如果无法获取宽度，使用默认值
          height: video.videoHeight || 225 // 如果无法获取高度，使用默认值
        };

        // console.log('[getVideoDimensions] Successfully loaded metadata:', {
        //   url: videoUrl,
        //   dimensions,
        //   videoWidth: video.videoWidth,
        //   videoHeight: video.videoHeight,
        //   readyState: video.readyState
        // });

        // 清理视频元素
        video.src = '';
        video.load();

        resolve(dimensions);
      } catch (error) {
        clearTimeout(timeout);
        video.src = '';

        console.error('[getVideoDimensions] Error extracting dimensions:', error);
        // 从缓存中移除失败的URL
        dimensionsCache.delete(videoUrl);

        // 使用默认尺寸而不是抛出错误
        resolve({
          width: 400,
          height: 225
        });
      }
    };

    video.onerror = (error) => {
      clearTimeout(timeout);
      console.error('[getVideoDimensions] Video load error:', {
        error,
        url: videoUrl,
        networkState: video.networkState,
        readyState: video.readyState,
        errorCode: (video.error as any)?.code,
        errorMessage: (video.error as any)?.message
      });

      // 从缓存中移除失败的URL
      dimensionsCache.delete(videoUrl);

      // 如果视频加载失败，返回默认尺寸而不是抛出错误
      resolve({
        width: 400,
        height: 225
      });
    };
    
    // 开始加载视频元数据
    video.src = videoUrl;
  });
  
  // 将Promise添加到缓存
  dimensionsCache.set(videoUrl, promise);
  return promise;
};

/**
 * 计算适合画板显示的视频尺寸
 * 保持宽高比，但限制最大尺寸避免过大
 */
const calculateDisplayDimensions = (
  originalWidth: number,
  originalHeight: number,
  referenceDimensions?: { width: number; height: number }
): VideoDimensions => {
  if (referenceDimensions) {
    // 如果提供了参考尺寸，使用参考尺寸作为目标大小
    // 保持视频的宽高比，适配参考尺寸
    const referenceAspectRatio = referenceDimensions.width / referenceDimensions.height;
    const videoAspectRatio = originalWidth / originalHeight;

    let width, height;
    if (videoAspectRatio > referenceAspectRatio) {
      // 视频更宽，以宽度为准
      width = referenceDimensions.width;
      height = width / videoAspectRatio;
    } else {
      // 视频更高，以高度为准
      height = referenceDimensions.height;
      width = height * videoAspectRatio;
    }

    // console.log('Using reference dimensions for video sizing:', {
    //   reference: referenceDimensions,
    //   calculated: { width: Math.round(width), height: Math.round(height) },
    //   originalAspectRatio: videoAspectRatio
    // });

    return {
      width: Math.round(width),
      height: Math.round(height)
    };
  } else {
    // 如果没有参考尺寸，使用固定的最大尺寸限制
    const MAX_SIZE = 600; // 最大宽度或高度限制

    // 如果尺寸在限制内，直接使用原始尺寸
    if (originalWidth <= MAX_SIZE && originalHeight <= MAX_SIZE) {
      return {
        width: originalWidth,
        height: originalHeight
      };
    }

    // 计算缩放比例，保持宽高比
    const widthScale = MAX_SIZE / originalWidth;
    const heightScale = MAX_SIZE / originalHeight;
    const scale = Math.min(widthScale, heightScale);

    return {
      width: Math.round(originalWidth * scale),
      height: Math.round(originalHeight * scale)
    };
  }
};

/**
 * 插入视频到画布（作为带视频元数据的图片元素）
 * @param board PlaitBoard实例
 * @param videoUrl 视频URL
 * @param startPoint 插入位置（可选）
 * @param isDrop 是否为拖拽操作
 * @param referenceDimensions 参考尺寸（可选，用于适应选中元素的大小）
 * @param skipScroll 是否跳过滚动
 * @param skipCentering 是否跳过自动居中（当 startPoint 已经是左上角坐标时使用）
 * @param lockReferenceDimensions 是否直接使用参考尺寸作为最终尺寸
 */
export const insertVideoFromUrl = async (
  board: PlaitBoard | null,
  videoUrl: string,
  startPoint?: Point,
  isDrop?: boolean,
  referenceDimensions?: { width: number; height: number },
  skipScroll?: boolean,
  skipCentering?: boolean,
  lockReferenceDimensions?: boolean
) => {
  if (!board) {
    throw new Error('Board is required for video insertion');
  }

  try {
    if (!startPoint && !isDrop && !referenceDimensions) {
      const { insertMediaIntoSelectedFrame } = await import(
        '../utils/frame-insertion-utils'
      );
    const inserted = await insertMediaIntoSelectedFrame(
      board,
      videoUrl,
      'video'
    );
      if (inserted) return inserted.elementId;
    }

    // 使用默认尺寸立即插入，不等待获取视频真实尺寸
    // 这样可以让视频立刻出现在画布上，提升用户体验
    // 默认使用 16:9 比例的尺寸
    const defaultDimensions: VideoDimensions = { width: 400, height: 225 };

    // 计算适合画板显示的尺寸（保持比例但使用参考尺寸或限制大小）
    const displayDimensions =
      lockReferenceDimensions && referenceDimensions
        ? referenceDimensions
        : calculateDisplayDimensions(
            defaultDimensions.width,
            defaultDimensions.height,
            referenceDimensions
          );
    // console.log('Using default dimensions for immediate insertion:', displayDimensions);

    // 注意：合并视频已在 video-merge-webcodecs.ts 中通过 cacheMediaFromBlob 缓存
    // 外部视频 URL 会被 Service Worker 自动缓存
    // 虚拟路径 URL (/__aitu_cache__/video/...) 不需要额外缓存

    // 计算插入位置
    let insertionPoint = startPoint;

    // 如果提供了起始点(startPoint),它应该是选中元素的中心点
    // 需要将X坐标向左偏移视频宽度的一半,让视频以中心点对齐
    // 除非 skipCentering=true（表示 startPoint 已经是左上角坐标）
    if (insertionPoint && !isDrop && !skipCentering) {
      insertionPoint = [insertionPoint[0] - displayDimensions.width / 2, insertionPoint[1]] as Point;
      // console.log('insertVideoFromUrl: Adjusted insertion point for video centering:', insertionPoint);
    } else if (!startPoint && !isDrop) {
      // 没有提供起始点时,优先使用保存的选中元素IDs计算插入位置
      insertionPoint = getInsertionPointFromSavedSelection(board, {
        align: 'center',
        targetWidth: displayDimensions.width,
        logPrefix: 'video',
      });

      // 如果没有保存的选中元素,回退到使用当前选中元素(向后兼容)
      if (!insertionPoint) {
        const calculatedPoint = getInsertionPointForSelectedElements(board);
        if (calculatedPoint) {
          // 调整X坐标，让视频以计算点为中心左右居中显示
          insertionPoint = [calculatedPoint[0] - displayDimensions.width / 2, calculatedPoint[1]] as Point;
        } else {
          // 如果没有选中元素,在最下方元素的下方插入
          insertionPoint = getInsertionPointBelowBottommostElement(board, displayDimensions.width);
        }
      }
    }

    // 如果没有计算出插入位置，使用默认位置
    if (!insertionPoint) {
      insertionPoint = [100, 100] as Point;
    }

    // console.log('Inserting video element with display dimensions:', displayDimensions, 'at point:', insertionPoint);

    // 直接使用原始URL，并添加 #video 标识符
    // 这样刷新后视频仍然可以正常显示（只要原始URL有效）
    // 如果URL已经有hash fragment（如merged-video），就不再添加#video
    const videoWithFragment = videoUrl.includes('#') ? videoUrl : `${videoUrl}#video`;
    const videoAsImageElement = {
      url: videoWithFragment,
      width: displayDimensions.width,
      height: displayDimensions.height,
      isVideo: true,
      videoType: 'video',
    };

    // console.log('[insertVideoFromUrl] Creating video as image element:', {
    //   originalUrl: videoUrl,
    //   urlWithFragment: videoWithFragment,
    //   dimensions: displayDimensions,
    //   insertionPoint,
    //   isBlobUrl: videoUrl.startsWith('blob:')
    // });

    // 使用DrawTransforms插入视频元素
    const { DrawTransforms } = await import('@plait/draw');
    const childrenCountBefore = board.children.length;
    DrawTransforms.insertImage(board, videoAsImageElement, insertionPoint);
    const newElement = board.children[childrenCountBefore];

    // 埋点：视频插入画布
    analytics.track('asset_insert_canvas', {
      type: 'video',
      source: videoUrl.startsWith('/__aitu_cache__/') || videoUrl.startsWith('/asset-library/') ? 'local' : 'external',
      width: displayDimensions.width,
      height: displayDimensions.height,
    });

    // 插入后滚动视口到新元素位置（如果不在视口内）
    // skipScroll 用于批量插入场景，由上层统一处理滚动
    if (insertionPoint && !isDrop && !skipScroll) {
      // 计算视频中心点位置用于滚动
      const centerPoint: Point = [
        insertionPoint[0] + displayDimensions.width / 2,
        insertionPoint[1] + displayDimensions.height / 2,
      ];
      // 使用 requestAnimationFrame 确保 DOM 更新后再滚动
      requestAnimationFrame(() => {
        scrollToPointIfNeeded(board, centerPoint);
      });
    }

    return newElement?.id;
  } catch (error) {
    console.error('Failed to insert video:', error);
    throw new Error(`Video insertion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

import {
  getHitElementByPoint,
  getSelectedElements,
  PlaitBoard,
  Point,
  addSelectedElement,
  clearSelectedElement,
  Transforms,
} from '@plait/core';
import { DataURL } from '../types';
import { MindElement, MindTransforms } from '@plait/mind';
import { DrawTransforms } from '@plait/draw';
import { getElementOfFocusedImage } from '@plait/common';
import {
  getInsertionPointForSelectedElements,
  getInsertionPointBelowBottommostElement,
  scrollToPointIfNeeded,
} from '../utils/selection-utils';
import { assetStorageService } from '../services/asset-storage-service';
import { analytics } from '../utils/posthog-analytics';
import { cacheRemoteUrl } from '../services/media-executor/fallback-utils';
import { normalizeImageDataUrl } from '@aitu/utils';
import { AssetSource, AssetType } from '../types/asset.types';
import { getInsertionPointFromSavedSelection } from '../utils/canvas-insertion-layout';

export const loadHTMLImageElement = (dataURL: DataURL, crossOrigin = false) => {
  const normalizedURL = normalizeImageDataUrl(dataURL) as DataURL;
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) {
      image.crossOrigin = 'anonymous';
    }
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      resolve(image);
    };
    image.onerror = (error) => {
      reject(error);
    };
    image.src = normalizedURL;
  });
};

const loadHTMLImageElementFromBlob = (blob: Blob) => {
  const objectUrl = URL.createObjectURL(blob);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(objectUrl);
      reject(error);
    };
    image.src = objectUrl;
  });
};

const getImageFileName = (file: File): string => {
  if (file.name?.trim()) {
    return file.name.trim();
  }

  const extension =
    file.type.split('/')[1]?.split('+')[0]?.replace('jpeg', 'jpg') || 'png';
  return `pasted-image-${Date.now()}.${extension}`;
};

/**
 * 添加 bypass_sw 参数到 URL，跳过 Service Worker 拦截
 */
function addBypassSWParam(url: string): string {
  try {
    const urlObj = new URL(url, window.location.origin);
    if (!urlObj.searchParams.has('bypass_sw')) {
      urlObj.searchParams.set('bypass_sw', '1');
    }
    return urlObj.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}bypass_sw=1`;
  }
}

/**
 * 带重试和绕过 SW 功能的图片加载
 *
 * @param dataURL - 图片 URL
 * @param crossOrigin - 是否设置 crossOrigin
 * @param maxRetries - 最大重试次数（默认 3）
 * @param bypassSWAfterRetries - 多少次重试后绕过 SW（默认 1）
 */
export const loadHTMLImageElementWithRetry = (
  dataURL: DataURL,
  crossOrigin = false,
  maxRetries = 3,
  bypassSWAfterRetries = 1
): Promise<HTMLImageElement> => {
  // 存量数据可能存有原始 base64，先统一转为 data URL
  const normalizedURL = normalizeImageDataUrl(dataURL) as DataURL;
  // 外部 URL 不设置 crossOrigin（避免 CORS），不追加参数（避免破坏签名）
  const isExternalUrl =
    normalizedURL.startsWith('http://') || normalizedURL.startsWith('https://');

  return new Promise((resolve, reject) => {
    let retryCount = 0;
    let currentUrl = normalizedURL;
    let bypassSW = false;

    const tryLoad = () => {
      const image = new Image();
      if (crossOrigin && !isExternalUrl) {
        image.crossOrigin = 'anonymous';
      }
      image.referrerPolicy = 'no-referrer';

      image.onload = () => {
        resolve(image);
      };

      image.onerror = (error) => {
        retryCount++;

        if (retryCount <= maxRetries) {
          if (isExternalUrl) {
            // 外部 URL 不追加任何参数，直接重试原始 URL
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
            setTimeout(() => {
              image.src = normalizedURL;
            }, delay);
          } else {
            // 本地 URL：可以追加 bypass_sw 和 _retry 参数
            if (retryCount >= bypassSWAfterRetries && !bypassSW) {
              bypassSW = true;
              currentUrl = addBypassSWParam(normalizedURL) as DataURL;
            }
            const separator = currentUrl.includes('?') ? '&' : '?';
            const retryUrl = `${currentUrl}${separator}_retry=${Date.now()}`;
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
            setTimeout(() => {
              image.src = retryUrl;
            }, delay);
          }
        } else {
          console.error(
            `[loadHTMLImageElement] 加载失败，已重试 ${maxRetries} 次:`,
            normalizedURL
          );
          reject(error);
        }
      };

      image.src = currentUrl;
    };

    tryLoad();
  });
};

export const buildImage = (
  image: HTMLImageElement,
  dataURL: DataURL,
  maxWidth?: number,
  useOriginalSize = false,
  referenceDimensions?: { width: number; height: number }
) => {
  let width, height;

  if (useOriginalSize) {
    const originalWidth = image.width;
    const originalHeight = image.height;

    if (referenceDimensions) {
      // 如果提供了参考尺寸，使用参考尺寸作为目标大小
      // 保持图片的宽高比，适配参考尺寸
      const referenceAspectRatio =
        referenceDimensions.width / referenceDimensions.height;
      const imageAspectRatio = originalWidth / originalHeight;

      if (imageAspectRatio > referenceAspectRatio) {
        // 图片更宽，以宽度为准
        width = referenceDimensions.width;
        height = width / imageAspectRatio;
      } else {
        // 图片更高，以高度为准
        height = referenceDimensions.height;
        width = height * imageAspectRatio;
      }

      // console.log('Using reference dimensions for image sizing:', {
      //   reference: referenceDimensions,
      //   calculated: { width, height },
      //   originalAspectRatio: imageAspectRatio,
      // });
    } else {
      // 如果没有参考尺寸，使用固定的最大尺寸限制
      const MAX_SIZE = 600; // 最大宽度或高度限制

      // 计算缩放比例，保持宽高比
      if (originalWidth > MAX_SIZE || originalHeight > MAX_SIZE) {
        const widthScale = MAX_SIZE / originalWidth;
        const heightScale = MAX_SIZE / originalHeight;
        const scale = Math.min(widthScale, heightScale);

        width = originalWidth * scale;
        height = originalHeight * scale;
      } else {
        // 如果尺寸在限制内，使用原始尺寸
        width = originalWidth;
        height = originalHeight;
      }
    }
  } else {
    // 使用限制最大宽度的逻辑（保持向后兼容）
    const effectiveMaxWidth = maxWidth || 400;
    width = image.width > effectiveMaxWidth ? effectiveMaxWidth : image.width;
    height = (width / image.width) * image.height;
  }

  return {
    url: dataURL,
    width,
    height,
  };
};

export const insertImage = async (
  board: PlaitBoard,
  imageFile: File,
  startPoint?: Point,
  isDrop?: boolean,
  skipScroll?: boolean
) => {
  // 只有在没有提供startPoint时,才获取当前选中元素
  // 当从文件选择器上传时,已经没有选中状态了,不应该依赖当前选中
  const selectedElement = startPoint
    ? null
    : getSelectedElements(board)[0] || getElementOfFocusedImage(board);
  const defaultImageWidth = selectedElement ? 240 : 400;

  const image = await loadHTMLImageElementFromBlob(imageFile);
  const imageName = getImageFileName(imageFile);
  let imageUrl: string;

  try {
    await assetStorageService.initialize();
    const asset = await assetStorageService.addAsset({
      type: AssetType.IMAGE,
      source: AssetSource.LOCAL,
      name: imageName,
      blob: imageFile,
      mimeType: imageFile.type,
    });
    imageUrl = asset.url;
  } catch {
    const { unifiedCacheService } = await import(
      '../services/unified-cache-service'
    );
    const cached = await unifiedCacheService.cacheLocalMediaByContent(
      imageFile,
      'image',
      {
        source: 'clipboard',
        name: imageName,
      }
    );
    imageUrl = cached.url;
  }

  const imageItem = buildImage(image, imageUrl as DataURL, defaultImageWidth);
  const element = startPoint && getHitElementByPoint(board, startPoint);

  if (isDrop && element && MindElement.isMindElement(board, element)) {
    MindTransforms.setImage(board, element as MindElement, imageItem);
    return;
  }

  if (
    selectedElement &&
    MindElement.isMindElement(board, selectedElement) &&
    !isDrop
  ) {
    MindTransforms.setImage(board, selectedElement as MindElement, imageItem);
  } else {
    let insertionPoint = startPoint;
    if (!startPoint && !isDrop) {
      insertionPoint = getInsertionPointFromSavedSelection(
        board,
        {
          align: 'center',
          targetWidth: imageItem.width,
          logPrefix: 'image',
        }
      );

      if (!insertionPoint) {
        const calculatedPoint = getInsertionPointForSelectedElements(board);
        if (calculatedPoint) {
          insertionPoint = [
            calculatedPoint[0] - imageItem.width / 2,
            calculatedPoint[1],
          ] as Point;
        } else {
          insertionPoint = getInsertionPointBelowBottommostElement(
            board,
            imageItem.width
          );
        }
      }
    }

    DrawTransforms.insertImage(board, imageItem, insertionPoint);

    if (insertionPoint && !isDrop && !skipScroll) {
      const centerPoint: Point = [
        insertionPoint[0] + imageItem.width / 2,
        insertionPoint[1] + imageItem.height / 2,
      ];
      requestAnimationFrame(() => {
        scrollToPointIfNeeded(board, centerPoint);
      });
    }
  }
};

export const insertImageFromUrl = async (
  board: PlaitBoard,
  imageUrl: string,
  startPoint?: Point,
  isDrop?: boolean,
  referenceDimensions?: { width: number; height: number },
  skipScroll?: boolean,
  // 如果为 true 且提供了 referenceDimensions，则跳过图片加载直接使用提供的尺寸
  skipImageLoad?: boolean,
  // 如果为 true，图片加载后不再按真实比例改写尺寸
  lockReferenceDimensions?: boolean,
  // 如果为 true，插入图片后不自动选中（用于自动插入场景，避免覆盖用户当前选中状态）
  skipSelect?: boolean
) => {
  // 外部 URL 和 data URL 先缓存到本地
  let resolvedUrl = normalizeImageDataUrl(imageUrl);
  if (
    resolvedUrl.startsWith('http://') ||
    resolvedUrl.startsWith('https://') ||
    resolvedUrl.startsWith('data:')
  ) {
    const cachedUrl = await cacheRemoteUrl(
      resolvedUrl,
      `insert-${Date.now()}`,
      'image',
      'png'
    );
    if (cachedUrl !== resolvedUrl) {
      resolvedUrl = cachedUrl;
    }
  }

  if (!startPoint && !isDrop && !referenceDimensions) {
    const { insertMediaIntoSelectedFrame } = await import(
      '../utils/frame-insertion-utils'
    );
    const inserted = await insertMediaIntoSelectedFrame(
      board,
      resolvedUrl,
      'image'
    );
    if (inserted) return;
  }
  // console.log(`[insertImageFromUrl] Called with:`, {
  //   imageUrl: imageUrl?.substring(0, 80),
  //   startPoint,
  //   isDrop,
  //   referenceDimensions,
  //   skipScroll,
  //   skipImageLoad,
  //   boardExists: !!board,
  // });

  // 只有在没有提供startPoint和referenceDimensions时,才获取当前选中元素
  // 当从AI生成对话框调用时,已经传入了这些参数,不应该依赖当前选中状态
  const selectedElement =
    !startPoint && !referenceDimensions
      ? getSelectedElements(board)[0] || getElementOfFocusedImage(board)
      : null;
  const defaultImageWidth = selectedElement ? 240 : 400;

  let imageItem: { url: DataURL; width: number; height: number };
  let shouldUpdateSizeAfterLoad = false;

  // 如果允许跳过图片加载且提供了参考尺寸，直接使用参考尺寸构建 imageItem
  // 这样可以立即插入图片到画布，不需要等待图片下载完成
  if (skipImageLoad && referenceDimensions) {
    imageItem = {
      url: resolvedUrl as DataURL,
      width: referenceDimensions.width,
      height: referenceDimensions.height,
    };
    shouldUpdateSizeAfterLoad = !lockReferenceDimensions; // 标记需要在图片加载后更新尺寸
    // console.log(`[insertImageFromUrl] Using provided dimensions:`, imageItem);
  } else {
    // 使用带重试的图片加载函数，支持自动绕过 SW
    // console.log(`[insertImageFromUrl] Loading image with retry...`);
    const image = await loadHTMLImageElementWithRetry(
      resolvedUrl as DataURL,
      true
    ); // 使用 crossOrigin 以支持外部 URL
    imageItem = buildImage(
      image,
      resolvedUrl as DataURL,
      defaultImageWidth,
      true,
      referenceDimensions
    ); // 使用原始尺寸并传递参考尺寸
    // console.log(`[insertImageFromUrl] Image loaded, imageItem:`, imageItem);
  }

  const element = startPoint && getHitElementByPoint(board, startPoint);
  if (isDrop && element && MindElement.isMindElement(board, element)) {
    MindTransforms.setImage(board, element as MindElement, imageItem);
    // console.log(`[insertImageFromUrl] Set image to MindElement`);
    return;
  }

  // 处理插入点逻辑
  let insertionPoint: Point | undefined = startPoint;

  // 只有在没有提供startPoint时才自动计算插入位置
  if (!startPoint && !isDrop) {
    // 优先使用保存的选中元素IDs计算插入位置
    insertionPoint = getInsertionPointFromSavedSelection(
      board,
      {
        align: 'center',
        targetWidth: imageItem.width,
        logPrefix: 'image',
      }
    );

    // 如果没有保存的选中元素,回退到使用当前选中元素(向后兼容)
    if (!insertionPoint) {
      const calculatedPoint = getInsertionPointForSelectedElements(board);
      if (calculatedPoint) {
        // 图片插入位置应该在所有选中元素垂直居中对齐
        // 将X坐标向左偏移图片宽度的一半，让图片以计算点为中心显示
        insertionPoint = [
          calculatedPoint[0] - imageItem.width / 2,
          calculatedPoint[1],
        ] as Point;
      } else {
        // 如果没有选中元素,在最下方元素的下方插入
        insertionPoint = getInsertionPointBelowBottommostElement(
          board,
          imageItem.width
        );
      }
    }
  }

  // 记录插入前的 children 数量，用于后续找到新插入的元素
  const childrenCountBefore = board.children.length;

  DrawTransforms.insertImage(board, imageItem, insertionPoint);

  // 埋点：图片插入画布
  analytics.track('asset_insert_canvas', {
    type: 'image',
    source:
      imageUrl.startsWith('/__aitu_cache__/') ||
      imageUrl.startsWith('/asset-library/')
        ? 'local'
        : 'external',
    width: imageItem.width,
    height: imageItem.height,
  });

  // 选中新插入的图片元素（如果没有跳过选中）
  if (!skipSelect) {
    const newElement = board.children[childrenCountBefore];
    if (newElement) {
      clearSelectedElement(board);
      addSelectedElement(board, newElement);
    }
  }

  // 如果跳过了图片加载，异步加载图片并更新元素尺寸
  if (shouldUpdateSizeAfterLoad && referenceDimensions) {
    // 同步捕获新插入元素的 ID，避免异步回调中索引失效
    const newElement = board.children[childrenCountBefore] as any;
    const elementId = newElement?.id as string | undefined;
    if (elementId) {
      updateImageSizeAfterLoad(
        board,
        resolvedUrl,
        elementId,
        referenceDimensions
      );
    }
  }

  // 插入后滚动视口到新元素位置（如果不在视口内）
  // skipScroll 用于批量插入场景，由上层统一处理滚动
  if (insertionPoint && !isDrop && !skipScroll) {
    // 计算图片中心点位置用于滚动
    const centerPoint: Point = [
      insertionPoint[0] + imageItem.width / 2,
      insertionPoint[1] + imageItem.height / 2,
    ];
    // 使用 requestAnimationFrame 确保 DOM 更新后再滚动
    requestAnimationFrame(() => {
      scrollToPointIfNeeded(board, centerPoint);
    });
  }
};

/**
 * 图片加载完成后更新元素尺寸
 * 用于 skipImageLoad=true 的场景，在图片实际加载后自适应调整元素尺寸
 *
 * 通过元素 ID 查找（而非索引），确保异步回调中仍能正确定位元素
 */
function updateImageSizeAfterLoad(
  board: PlaitBoard,
  imageUrl: string,
  elementId: string,
  referenceDimensions: { width: number; height: number }
): void {
  // 使用带重试的加载函数，提高虚拟 URL 场景的可靠性
  loadHTMLImageElementWithRetry(imageUrl as DataURL, true)
    .then((img) => {
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;

      if (!naturalWidth || !naturalHeight) {
        return;
      }

      // 计算图片的实际宽高比
      const imageAspectRatio = naturalWidth / naturalHeight;
      const referenceAspectRatio =
        referenceDimensions.width / referenceDimensions.height;

      // 如果宽高比相同（误差 < 1%），不需要更新
      if (
        Math.abs(imageAspectRatio - referenceAspectRatio) /
          referenceAspectRatio <
        0.01
      ) {
        return;
      }

      // 根据实际图片比例计算新的显示尺寸
      // 以预设宽度为基准，调整高度以匹配实际比例
      let newWidth = referenceDimensions.width;
      let newHeight = newWidth / imageAspectRatio;

      // 如果新高度超过预设高度，则以高度为基准
      if (newHeight > referenceDimensions.height) {
        newHeight = referenceDimensions.height;
        newWidth = newHeight * imageAspectRatio;
      }

      // 通过 ID 查找元素（比索引更可靠，不受插入/删除影响）
      const elementIndex = board.children.findIndex(
        (el: any) => el.id === elementId
      );
      if (elementIndex === -1) {
        // 元素已被删除
        return;
      }

      const targetElement = board.children[elementIndex];

      // 使用元素当前的左上角位置（用户可能已移动元素）
      const currentTopLeft: Point = targetElement.points?.[0] || [0, 0];

      const newPoints: [Point, Point] = [
        currentTopLeft,
        [currentTopLeft[0] + newWidth, currentTopLeft[1] + newHeight],
      ];

      Transforms.setNode(board, { points: newPoints }, [elementIndex]);
    })
    .catch((error) => {
      console.warn(
        '[updateImageSizeAfterLoad] Failed to load image for size update:',
        error
      );
    });
}

/**
 * 使用 img 标签直接加载图片（不需要 CORS）
 * 仅用于获取图片尺寸
 */
const loadImageDirectly = (imageUrl: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // 不设置 crossOrigin，这样可以加载不支持 CORS 的图片
    image.referrerPolicy = 'no-referrer';
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(error);
    image.src = imageUrl;
  });
};

/**
 * 从 URL 插入图片到画布并选中
 * 用于从工具 iframe 拖拽图片到画布的场景
 * 直接使用 img 标签加载图片获取尺寸，避免 CORS 问题
 */
export const insertImageFromUrlAndSelect = async (
  board: PlaitBoard,
  imageUrl: string,
  startPoint: Point,
  referenceDimensions?: { width: number; height: number }
): Promise<void> => {
  const childrenCountBefore = board.children.length;
  const defaultImageWidth = 400;

  let image: HTMLImageElement;

  try {
    // 使用直接加载方式获取图片尺寸（不需要 CORS）
    // 图片会使用原始 URL 存储，浏览器渲染 <img> 标签时不需要 CORS
    // console.log('[insertImageFromUrlAndSelect] Loading image directly:', imageUrl);
    image = await loadImageDirectly(imageUrl);
    // console.log('[insertImageFromUrlAndSelect] Load successful, dimensions:', image.width, 'x', image.height);
  } catch (error) {
    console.error('[insertImageFromUrlAndSelect] Failed to load image:', error);
    throw new Error('无法加载图片，请检查图片 URL 是否有效');
  }

  const imageItem = buildImage(
    image,
    imageUrl as DataURL,
    defaultImageWidth,
    true,
    referenceDimensions
  );

  // 检查是否拖放到 MindElement 上
  const element = getHitElementByPoint(board, startPoint);
  if (element && MindElement.isMindElement(board, element)) {
    MindTransforms.setImage(board, element as MindElement, imageItem);
    return;
  }

  // 插入图片
  DrawTransforms.insertImage(board, imageItem, startPoint);

  // 选中新插入的图片元素
  const newElement = board.children[childrenCountBefore];
  if (newElement) {
    clearSelectedElement(board);
    addSelectedElement(board, newElement);
  }
};

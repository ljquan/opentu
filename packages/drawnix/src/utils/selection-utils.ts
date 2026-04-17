import { getSelectedElements, PlaitBoard, PlaitElement, getRectangleByElements, RectangleClient, toImage, Point, BoardTransforms, getViewportOrigination } from '@plait/core';
import { MindElement } from '@plait/mind';
import { PlaitDrawElement } from '@plait/draw';
import { Node } from 'slate';
import { Freehand } from '../plugins/freehand/type';
import { PenPath } from '../plugins/pen/type';
import { SAME_ROW_THRESHOLD } from '../components/ttd-dialog/shared/size-constants';
import { trimImageWhiteAndTransparentBorder } from '@aitu/utils';
import { isFillConfig, ImageFillConfig } from '../types/fill.types';
import { generateFillDefId } from './fill-renderer';
import { isCardElement } from '../types/card.types';

/**
 * 从图片 URL 获取原始尺寸
 * @param url 图片 URL（支持 http/https/data URL）
 * @returns Promise<{ width: number; height: number } | null>
 */
export const getImageDimensionsFromUrl = (url: string): Promise<{ width: number; height: number } | null> => {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    
    const img = new Image();
    
    // 对于外部 URL，不设置 crossOrigin（只获取尺寸不需要 CORS）
    // 这样可以避免服务器 CORS 配置错误（如返回 *, *）导致的加载失败
    // 注意：如果后续需要读取像素数据，需要单独处理 CORS
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/')) {
      // 本地资源不需要设置
    } else {
      // 外部 URL 设置 referrerPolicy 防止 referer 泄露，但不设置 crossOrigin
      img.referrerPolicy = 'no-referrer';
    }
    
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    
    img.onerror = () => {
      resolve(null);
    };
    
    img.src = url;
  });
};

/**
 * 压缩图像URL（用于生成的图像）
 */
export const compressImageUrl = (imageUrl: string, maxWidth: number = 512, maxHeight: number = 512, quality: number = 0.8): Promise<string> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    
    img.onload = () => {
      // 计算缩放比例
      let { width, height } = img;
      const aspectRatio = width / height;
      
      if (width > maxWidth || height > maxHeight) {
        if (width > height) {
          width = Math.min(width, maxWidth);
          height = width / aspectRatio;
          
          if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
          }
        } else {
          height = Math.min(height, maxHeight);
          width = height * aspectRatio;
          
          if (width > maxWidth) {
            width = maxWidth;
            height = width / aspectRatio;
          }
        }
      }
      
      // 设置画布尺寸
      canvas.width = width;
      canvas.height = height;
      
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }
      
      // 绘制图片
      ctx.drawImage(img, 0, 0, width, height);
      
      // 转换为data URL
      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedDataUrl);
    };
    
    img.onerror = () => {
      // 如果压缩失败，返回原始URL
      resolve(imageUrl);
    };
    
    img.src = imageUrl;
  });
};

export interface ExtractedContent {
  text: string;
  images: { url: string; name?: string; width?: number; height?: number }[];
}

export interface ProcessedContent {
  remainingImages: { url: string; name?: string; width?: number; height?: number }[];
  remainingText: string;
  graphicsImage?: string;
  /** 图形图片的尺寸（如果有） */
  graphicsImageDimensions?: { width: number; height: number };
}

/**
 * Sort elements by position (left to right, top to bottom) while preserving layer order for overlapping elements
 */
export const sortElementsByPosition = (board: PlaitBoard, elements: PlaitElement[]): PlaitElement[] => {
  try {
    // Get original indices to preserve layer order
    const elementIndices = new Map(elements.map((element, index) => [element.id, index]));
    
    // Create array with elements and their position data
    const elementsWithPosition = elements.map(element => {
      try {
        const rect = getRectangleByElements(board, [element], false);
        return {
          element,
          x: rect.x,
          y: rect.y,
          centerX: rect.x + rect.width / 2, // 用中心点X坐标进行排序
          centerY: rect.y + rect.height / 2,  // 用中心点Y坐标进行排序
          originalIndex: elementIndices.get(element.id) || 0 // 保存原始索引用于层级排序
        };
      } catch (error) {
        console.warn('Failed to get position for element:', element.id, error);
        // 如果获取位置失败，给予默认位置
        return {
          element,
          x: 0,
          y: 0,
          centerX: 0,
          centerY: 0,
          originalIndex: elementIndices.get(element.id) || 0
        };
      }
    });

    // Sort by position: first by Y (top to bottom), then by X (left to right), finally by original index (layer order)
    elementsWithPosition.sort((a, b) => {
      // 如果Y坐标差异很小，认为在同一行，按X坐标排序
      const yDiff = Math.abs(a.centerY - b.centerY);
      if (yDiff < SAME_ROW_THRESHOLD) {
        const xDiff = Math.abs(a.centerX - b.centerX);
        // 如果在同一行且X坐标也很接近（可能重叠），保持原始层级顺序
        if (xDiff < SAME_ROW_THRESHOLD) {
          return a.originalIndex - b.originalIndex; // 按原始索引排序，保持层级
        }
        return a.centerX - b.centerX; // 按X坐标从左到右排序
      }
      return a.centerY - b.centerY; // 按Y坐标从上到下排序
    });

    // console.log('Elements sorted by position with layer preservation');
    // Return sorted elements
    return elementsWithPosition.map(item => item.element);
  } catch (error) {
    console.warn('Error sorting elements by position:', error);
    return elements; // 如果排序失败，返回原始顺序
  }
};

/**
 * Extract text content from a Plait element
 */
export const extractTextFromElement = (element: PlaitElement, board?: PlaitBoard): string => {
  const texts: string[] = [];

  if (isCardElement(element)) {
    const body = element.body?.trim() || '';
    if (element.title?.trim()) {
      return `# ${element.title.trim()}\n${body}`;
    }
    return body;
  }

  if (element.type === 'audio' && 'title' in element && typeof element.title === 'string') {
    const title = element.title.trim();
    if (title) {
      texts.push(title);
    }
  }
  
  // Handle MindElement (mind map nodes)
  if (board && MindElement.isMindElement(board, element)) {
    const mindElement = element as MindElement;
    
    if (mindElement.data && Array.isArray(mindElement.data)) {
      // Extract text from Slate nodes
      for (const node of mindElement.data) {
        if (Node.isNode(node)) {
          const text = Node.string(node);
          if (text.trim()) {
            texts.push(text.trim());
          }
        }
      }
    }
  }
  
  // Handle other text elements - check if they have a 'data' property with text
  if ('data' in element && Array.isArray(element.data)) {
    for (const node of element.data) {
      if (Node.isNode(node)) {
        const text = Node.string(node);
        if (text.trim()) {
          texts.push(text.trim());
        }
      }
    }
  }
  
  // Handle elements with direct text property
  if ('text' in element) {
    // Handle string text
    if (typeof element.text === 'string' && element.text.trim()) {
      texts.push(element.text.trim());
    }
    
    // Handle structured text (like the geometry text format)
    if (element.text && typeof element.text === 'object' && 'children' in element.text) {
      const structuredText = element.text as any;
      if (Array.isArray(structuredText.children)) {
        for (const child of structuredText.children) {
          if (child && typeof child === 'object' && 'text' in child && typeof child.text === 'string') {
            const childText = child.text.trim();
            if (childText) {
              texts.push(childText);
            }
          }
        }
      }
    }
  }
  
  // Handle elements with textContent property
  if ('textContent' in element && typeof element.textContent === 'string') {
    texts.push(element.textContent.trim());
  }
  
  return texts.join(' ');
};

/**
 * Classify element as image-containing
 */
export const isImageElement = (board: PlaitBoard, element: PlaitElement): boolean => {
  // Mind elements with images
  if (MindElement.isMindElement(board, element)) {
    const mindElement = element as MindElement;
    return !!(mindElement.image && mindElement.image.url);
  }
  
  // Draw image elements
  if (PlaitDrawElement.isImage && PlaitDrawElement.isImage(element)) {
    return true;
  }
  
  // Elements with url property (fallback for other image types)
  if ('url' in element && typeof element.url === 'string') {
    return true;
  }
  
  // Elements with image property
  if ('image' in element && element.image && typeof element.image === 'object' && 'url' in element.image) {
    return true;
  }
  
  return false;
};

/**
 * Classify element as pure text-containing (not graphics)
 * Mind elements are now treated as graphics, not text-only elements
 */
export const isTextElement = (board: PlaitBoard, element: PlaitElement): boolean => {
  // PlaitText elements (these are text-specific geometry elements)
  if (PlaitDrawElement.isText && PlaitDrawElement.isText(element)) {
    // console.log('Element classified as PlaitText element');
    return true;
  }
  
  // Pure text elements with text properties (fallback) - but exclude mind elements which are now graphics
  if (('text' in element && element.text) || ('textContent' in element && element.textContent)) {
    // Don't classify mind elements as text-only since they're now graphics
    if (MindElement.isMindElement(board, element)) {
      // console.log('Element is mind element, treating as graphics not text');
      return false;
    }
    // console.log('Element classified as text element (fallback)');
    return true;
  }
  
  // console.log('Element not classified as text element, type:', element.type);
  return false;
};

/**
 * Classify element as graphics/drawing
 */
export const isGraphicsElement = (board: PlaitBoard, element: PlaitElement): boolean => {
  // Mind maps/mind elements should be treated as graphics (like freehand)
  if (MindElement.isMindElement(board, element)) {
    // console.log('Element classified as mind element graphics');
    return true;
  }
  
  // Freehand drawings
  if (Freehand.isFreehand(element)) {
    // console.log('Element classified as freehand graphics');
    return true;
  }
  
  // Pen paths (vector paths created with pen tool)
  if (PenPath.isPenPath(element)) {
    // console.log('Element classified as pen path graphics');
    return true;
  }
  
  // Geometric shapes (but exclude text elements which also match geometry)
  if (PlaitDrawElement.isGeometry && PlaitDrawElement.isGeometry(element)) {
    // Double-check it's not a text element, since PlaitText extends PlaitGeometry
    if (PlaitDrawElement.isText && PlaitDrawElement.isText(element)) {
      // console.log('Element is geometry but also text, excluding from graphics');
      return false;
    }
    // console.log('Element classified as geometry graphics');
    return true;
  }
  
  // Lines and arrows (flowchart elements)
  if (PlaitDrawElement.isArrowLine && PlaitDrawElement.isArrowLine(element)) {
    // console.log('Element classified as arrow line graphics');
    return true;
  }
  
  if (PlaitDrawElement.isVectorLine && PlaitDrawElement.isVectorLine(element)) {
    // console.log('Element classified as vector line graphics');
    return true;
  }
  
  // Tables and swimlanes (these are considered graphics for composition purposes)
  if (PlaitDrawElement.isTable && PlaitDrawElement.isTable(element)) {
    // console.log('Element classified as table graphics');
    return true;
  }
  
  // Only classify as graphics if it's a draw element but NOT an image or pure text
  if (PlaitDrawElement.isDrawElement && PlaitDrawElement.isDrawElement(element)) {
    // Double-check to make sure it's not an image or pure text element
    const isImageElement = PlaitDrawElement.isImage && PlaitDrawElement.isImage(element);
    const isTextElement = PlaitDrawElement.isText && PlaitDrawElement.isText(element);
    
    if (!isImageElement && !isTextElement) {
      // console.log('Element classified as other draw graphics');
      return true;
    }
  }
  
  // Check if it's a pure image element - if so, it's NOT graphics
  if (isImageElement(board, element)) {
    // console.log('Element excluded from graphics (is image)');
    return false;
  }
  
  return false;
};

/**
 * Detect if two elements overlap spatially
 */
export const detectElementOverlap = (board: PlaitBoard, element1: PlaitElement, element2: PlaitElement): boolean => {
  try {
    const rect1 = getRectangleByElements(board, [element1], false);
    const rect2 = getRectangleByElements(board, [element2], false);
    
    // console.log(`Overlap check: ${element1.id} (${element1.type}) vs ${element2.id} (${element2.type})`);
    // console.log('  Rect1:', rect1);
    // console.log('  Rect2:', rect2);
    
    const overlaps = RectangleClient.isHit(rect1, rect2);
    // console.log('  Overlaps:', overlaps);
    
    return overlaps;
  } catch (error) {
    // console.warn('Error detecting element overlap:', error, 'Elements:', element1.id, element2.id);
    return false;
  }
};

/**
 * Find all elements that overlap with any graphic element
 */
export const findElementsOverlappingWithGraphics = (board: PlaitBoard, elements: PlaitElement[]): {
  graphicsElements: PlaitElement[];
  overlappingElements: PlaitElement[];
} => {
  // console.log('findElementsOverlappingWithGraphics: Processing', elements.length, 'elements');
  
  const graphicsElements = elements.filter(el => {
    const isGraphics = isGraphicsElement(board, el);
    // if (isGraphics) {
    //   console.log('Found graphics element:', el.id, 'type:', el.type);
    // }
    return isGraphics;
  });
  
  const nonGraphicsElements = elements.filter(el => {
    const isGraphics = isGraphicsElement(board, el);
    // if (!isGraphics) {
    //   const isImage = isImageElement(board, el);
    //   const isText = isTextElement(board, el);
    //   console.log('Found non-graphics element:', el.id, 'type:', el.type, 'isImage:', isImage, 'isText:', isText);
    // }
    return !isGraphics;
  });
  
  // console.log('Graphics elements:', graphicsElements.length, 'Non-graphics elements:', nonGraphicsElements.length);
  
  const overlappingElements: PlaitElement[] = [];
  
  for (const graphicsEl of graphicsElements) {
    // console.log('Checking overlaps for graphics element:', graphicsEl.id);
    for (const otherEl of nonGraphicsElements) {
      const overlaps = detectElementOverlap(board, graphicsEl, otherEl);
      // console.log('  Overlap check with', otherEl.id, ':', overlaps);
      if (overlaps && !overlappingElements.includes(otherEl)) {
        overlappingElements.push(otherEl);
        // console.log('  Added overlapping element:', otherEl.id);
      }
    }
  }
  
  // console.log('Final result - Graphics:', graphicsElements.length, 'Overlapping:', overlappingElements.length);
  return { graphicsElements, overlappingElements };
};

/**
 * 将图片 URL 转换为 base64 数据 URL
 * 支持普通 URL、虚拟路径（通过 fetch）和已有的 data URL
 */
const convertImageUrlToBase64 = async (imageUrl: string): Promise<string> => {
  // 如果已经是 data URL，直接返回
  if (imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  try {
    // 通过 fetch 获取图片（会被 Service Worker 拦截处理虚拟路径）
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const blob = await response.blob();

    // 转换为 base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to convert to base64'));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    // 转换失败时返回原 URL
    return imageUrl;
  }
};

/**
 * 为 toImage 创建使用 userSpaceOnUse 坐标的图片填充 pattern
 * 因为原始 pattern 使用 objectBoundingBox，在克隆时坐标系会出问题
 */
const createUserSpacePatternForToImage = (
  config: ImageFillConfig,
  id: string,
  elementRect: RectangleClient,
  base64ImageUrl?: string
): SVGPatternElement => {
  const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
  pattern.setAttribute('id', id);
  // 使用 userSpaceOnUse 以绝对坐标定义 pattern
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');

  const scale = config.scale ?? 1;
  const rotation = config.rotation ?? 0;
  const offsetX = config.offsetX ?? 0;
  const offsetY = config.offsetY ?? 0;

  const { x, y, width: elementWidth, height: elementHeight } = elementRect;

  // 创建 image 元素，优先使用转换后的 base64 URL
  const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  image.setAttribute('href', base64ImageUrl || config.imageUrl);
  image.setAttribute('preserveAspectRatio', 'none');

  switch (config.mode) {
    case 'stretch':
      // 拉伸模式：pattern 覆盖整个元素
      pattern.setAttribute('x', String(x + offsetX * elementWidth));
      pattern.setAttribute('y', String(y + offsetY * elementHeight));
      pattern.setAttribute('width', String(elementWidth));
      pattern.setAttribute('height', String(elementHeight));
      image.setAttribute('width', String(elementWidth * scale));
      image.setAttribute('height', String(elementHeight * scale));
      break;

    case 'tile': {
      // 平铺模式：使用原始图片尺寸
      const tileSize = 100 * scale;
      pattern.setAttribute('x', String(x + offsetX * tileSize));
      pattern.setAttribute('y', String(y + offsetY * tileSize));
      pattern.setAttribute('width', String(tileSize));
      pattern.setAttribute('height', String(tileSize));
      image.setAttribute('width', String(tileSize));
      image.setAttribute('height', String(tileSize));
      break;
    }

    case 'fit':
      // 适应模式：pattern 覆盖整个元素，图片保持比例
      pattern.setAttribute('x', String(x + offsetX * elementWidth));
      pattern.setAttribute('y', String(y + offsetY * elementHeight));
      pattern.setAttribute('width', String(elementWidth));
      pattern.setAttribute('height', String(elementHeight));
      image.setAttribute('width', String(elementWidth * scale));
      image.setAttribute('height', String(elementHeight * scale));
      image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      break;
  }

  // 应用旋转变换
  if (rotation !== 0) {
    const cx = x + elementWidth / 2;
    const cy = y + elementHeight / 2;
    pattern.setAttribute('patternTransform', `rotate(${rotation} ${cx} ${cy})`);
  }

  pattern.appendChild(image);
  return pattern;
};

/**
 * 将渐变和图片填充定义复制到元素 G 内部，以便 toImage 克隆时能包含填充
 * 对于图片填充，需要转换为 userSpaceOnUse 坐标系，并将 URL 转为 base64
 * 返回清理函数
 */
const copyFillDefsToElements = async (board: PlaitBoard, elements: PlaitElement[]): Promise<() => void> => {
  const host = PlaitBoard.getHost(board);
  const defs = host?.querySelector('defs');
  if (!defs) return () => {};

  const addedDefs: { element: Element; defsClone: Element }[] = [];

  // 收集需要处理的图片填充元素及其 base64 URL
  const imageFillTasks: {
    element: PlaitElement;
    fillConfig: any;
    elementG: Element;
    defId: string;
  }[] = [];

  // 第一遍：收集需要处理的元素
  for (const element of elements) {
    // 检查元素是否使用渐变或图片填充
    const fillConfig = (element as any).fillConfig;
    if (!fillConfig || !isFillConfig(fillConfig)) {
      continue;
    }

    // 只处理渐变和图片填充
    if (fillConfig.type !== 'gradient' && fillConfig.type !== 'image') {
      continue;
    }

    // 获取元素的 G 节点
    let elementG: Element | null = null;
    try {
      elementG = PlaitElement.getElementG(element);
    } catch {
      // 忽略
    }
    if (!elementG) continue;

    // 根据填充类型获取定义 ID
    const defType = fillConfig.type === 'gradient' ? 'gradient' : 'pattern';
    const defId = generateFillDefId(element.id, defType);
    const fillDef = defs.querySelector(`#${defId}`);
    if (!fillDef) continue;

    if (fillConfig.type === 'image' && fillConfig.image) {
      // 图片填充需要异步处理
      imageFillTasks.push({ element, fillConfig, elementG, defId });
    } else {
      // 渐变填充直接克隆
      const defsClone = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defsClone.appendChild(fillDef.cloneNode(true));
      elementG.insertBefore(defsClone, elementG.firstChild);
      addedDefs.push({ element: elementG, defsClone });
    }
  }

  // 第二遍：并行处理所有图片填充（转换 URL 为 base64）
  await Promise.all(
    imageFillTasks.map(async ({ element, fillConfig, elementG, defId }) => {
      // 将图片 URL 转换为 base64（支持虚拟路径和外部 URL）
      const base64Url = await convertImageUrlToBase64(fillConfig.image.imageUrl);

      // 创建使用 userSpaceOnUse 坐标的 pattern
      const elementRect = getRectangleByElements(board, [element], false);
      const newPattern = createUserSpacePatternForToImage(
        fillConfig.image,
        defId,
        elementRect,
        base64Url
      );

      const defsClone = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defsClone.appendChild(newPattern);
      elementG.insertBefore(defsClone, elementG.firstChild);
      addedDefs.push({ element: elementG, defsClone });
    })
  );

  // 返回清理函数
  return () => {
    addedDefs.forEach(({ element, defsClone }) => {
      element.removeChild(defsClone);
    });
  };
};

/**
 * Convert elements to image using Plait's native toImage function
 * This preserves all styling, colors, and rendering exactly as they appear
 * The resulting image is compressed to maximum 512x512px for AI image generation
 */
export const convertElementsToImage = async (board: PlaitBoard, elements: PlaitElement[]): Promise<string | null> => {
  try {
    if (elements.length === 0) {
      return null;
    }

    // console.log(`Converting ${elements.length} elements to image using Plait's native toImage function`);

    // Sort elements by their original order in the board to maintain layer hierarchy
    // Elements that appear later in the board.children array should be on top
    const sortedElements = elements.slice().sort((a, b) => {
      const indexA = board.children.findIndex(child => child.id === a.id);
      const indexB = board.children.findIndex(child => child.id === b.id);

      // If either element is not found in board.children, maintain original order
      if (indexA === -1 && indexB === -1) return 0;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;

      return indexA - indexB; // 保持原始顺序，早出现的在底层，晚出现的在顶层
    });

    // console.log('Elements sorted by board hierarchy for image conversion:',
    //   sortedElements.map(el => `${el.id}:${board.children.findIndex(child => child.id === el.id)}`));

    // 将渐变和图片填充定义复制到元素 G 内部，以便 toImage 克隆时能包含填充
    // Plait 的 cloneSvg 使用浅拷贝 SVG 根元素，不包含 <defs>，导致渐变/图片填充丢失
    // 对于图片填充，需要将 URL 转换为 base64 以支持虚拟路径和外部 URL
    const cleanupFillDefs = await copyFillDefsToElements(board, sortedElements);

    let imageDataUrl: string | undefined;
    try {
      // Use Plait's native toImage function with the same options as export
      // This ensures all colors, styles, and rendering are preserved exactly
      imageDataUrl = await toImage(board, {
        elements: sortedElements, // Use sorted elements to maintain layer order
        fillStyle: 'white', // White background for AI image generation
        inlineStyleClassNames: '.extend,.emojis,.text', // Include style classes for proper rendering
        padding: 20, // Add padding around elements
        ratio: 2, // Higher resolution for better quality (reduced from 4 to avoid too large images)
      });
    } finally {
      // 清理添加的填充定义（确保即使异常也会清理）
      cleanupFillDefs();
    }

    if (imageDataUrl) {
      // console.log(`Successfully converted elements to image using native Plait rendering`);

      // 使用公共方法去除白边
      const trimmedImageUrl = await trimImageWhiteAndTransparentBorder(imageDataUrl);

      // Compress the image to max 512x512px for AI image generation
      try {
        const compressedImageUrl = await compressImageUrl(trimmedImageUrl, 512, 512, 0.8);
        // console.log('Image compressed successfully for AI image generation');
        return compressedImageUrl;
      } catch (compressError) {
        // console.warn('Failed to compress converted image, using original:', compressError);
        return trimmedImageUrl;
      }
    } else {
      // console.warn('Plait toImage returned null');
      return null;
    }

  } catch (error) {
    console.error('Error converting elements to image using Plait toImage:', error);
    return null;
  }
};

/**
 * Extract image URLs from a Plait element
 */
export const extractImagesFromElement = (element: PlaitElement, board?: PlaitBoard): { url: string; name?: string; width?: number; height?: number }[] => {
  const images: { url: string; name?: string; width?: number; height?: number }[] = [];
  
  // Handle MindElement with images
  if (board && MindElement.isMindElement(board, element)) {
    const mindElement = element as MindElement;
    if (mindElement.image && mindElement.image.url) {
      // MindElement 的 image 可能有 width 和 height
      const imgWidth = (mindElement.image as any).width;
      const imgHeight = (mindElement.image as any).height;
      images.push({ 
        url: mindElement.image.url,
        name: `mind-image-${Date.now()}`,
        width: imgWidth,
        height: imgHeight,
      });
    }
  }
  
  // Handle DrawImage elements (assuming they have url property)
  if ('url' in element && typeof element.url === 'string') {
    // 尝试从元素中获取尺寸
    const elemWidth = (element as any).width;
    const elemHeight = (element as any).height;
    images.push({ 
      url: element.url,
      name: `draw-image-${Date.now()}`,
      width: elemWidth,
      height: elemHeight,
    });
  }
  
  // Handle elements with image property
  if ('image' in element && element.image && typeof element.image === 'object' && 'url' in element.image) {
    const imgObj = element.image as any;
    images.push({ 
      url: imgObj.url as string,
      name: `element-image-${Date.now()}`,
      width: imgObj.width,
      height: imgObj.height,
    });
  }
  
  return images;
};

/**
 * Extract text and images from currently selected elements on the board
 */
export const extractSelectedContent = (board: PlaitBoard): ExtractedContent => {
  const selectedElements = getSelectedElements(board);
  
  // Sort elements by position (left to right, top to bottom)
  const sortedElements = sortElementsByPosition(board, selectedElements);
  
  const texts: string[] = [];
  const images: { url: string; name?: string; width?: number; height?: number }[] = [];
  
  for (const element of sortedElements) {
    // Extract text
    const elementText = extractTextFromElement(element, board);
    if (elementText) {
      texts.push(elementText);
    }
    
    // Extract images
    const elementImages = extractImagesFromElement(element, board);
    images.push(...elementImages);
  }
  
  return {
    text: texts.join('\n'),
    images: images
  };
};

/**
 * Process selected elements according to new AI image generation rules
 * This implements the logic for handling graphics elements with overlap detection
 * @param board - The PlaitBoard instance
 * @param selectedElementIds - Optional array of element IDs to process. If not provided, uses currently selected elements.
 */
export const processSelectedContentForAI = async (
  board: PlaitBoard,
  selectedElementIds?: string[]
): Promise<ProcessedContent> => {
  let selectedElements: PlaitElement[];

  if (selectedElementIds && selectedElementIds.length > 0) {
    // 使用提供的元素IDs查找元素
    selectedElements = selectedElementIds
      .map(id => board.children.find((el: any) => el.id === id))
      .filter(Boolean) as PlaitElement[];
    // console.log('processSelectedContentForAI: Using provided element IDs, found elements:', selectedElements.length);
  } else {
    // 回退到当前选中的元素
    selectedElements = getSelectedElements(board);
    // console.log('processSelectedContentForAI: Using currently selected elements:', selectedElements.length);
  }

  // Sort elements by position (left to right, top to bottom)
  const sortedElements = sortElementsByPosition(board, selectedElements);
  // console.log('Elements sorted by position');
  
  // Debug: Log each selected element's details (using sorted elements)
  // sortedElements.forEach((el, index) => {
  //   console.log(`Element ${index} (sorted):`, {
  //     id: el.id,
  //     type: el.type,
  //     isImage: isImageElement(board, el),
  //     isText: isTextElement(board, el),
  //     isGraphics: isGraphicsElement(board, el),
  //     element: el
  //   });
  // });
  
  // Step 1: Find graphics elements and their overlapping elements (using sorted elements)
  const { graphicsElements, overlappingElements } = findElementsOverlappingWithGraphics(board, sortedElements);
  // console.log('Graphics elements:', graphicsElements.length, 'Overlapping elements:', overlappingElements.length);
  
  // Step 2: Combine graphics elements with overlapping elements, preserving sorted order
  const allGraphicsRelatedElementsSet = new Set([...graphicsElements, ...overlappingElements]);
  const allGraphicsRelatedElements = sortedElements.filter(el => allGraphicsRelatedElementsSet.has(el));
  
  // Step 3: Identify remaining elements (not graphics-related), preserving sorted order
  const remainingElements = sortedElements.filter(
    el => !allGraphicsRelatedElements.includes(el)
  );
  // console.log('Remaining elements count:', remainingElements.length);
  
  // Step 4: Generate image from graphics-related elements
  let graphicsImage: string | undefined;
  if (allGraphicsRelatedElements.length > 0) {
    // console.log('Converting graphics-related elements to image, count:', allGraphicsRelatedElements.length);
    try {
      const imageUrl = await convertElementsToImage(board, allGraphicsRelatedElements);
      // console.log('convertElementsToImage returned:', imageUrl ? 'success' : 'null');
      if (imageUrl) {
        graphicsImage = imageUrl;
      }
    } catch (error) {
      // console.warn('Failed to convert graphics elements to image:', error);
    }
  } else {
    // console.log('No graphics-related elements to convert to image');
  }
  
  // Step 5: Extract images and text from remaining elements
  const remainingImages: { url: string; name?: string; width?: number; height?: number }[] = [];
  const remainingTexts: string[] = [];
  
  for (const element of remainingElements) {
    // Extract text
    const elementText = extractTextFromElement(element, board);
    if (elementText) {
      remainingTexts.push(elementText);
      // console.log('Found text from element:', elementText.substring(0, 50));
    }
    
    // Extract images
    const elementImages = extractImagesFromElement(element, board);
    if (elementImages.length > 0) {
      remainingImages.push(...elementImages);
      // console.log('Found images from element:', elementImages.length);
    }
  }
  
  // Step 6: 异步获取缺失的图片尺寸
  const imagesWithDimensions = await Promise.all(
    remainingImages.map(async (img) => {
      // 如果已有有效尺寸，直接返回
      if (img.width && img.height && img.width > 0 && img.height > 0) {
        return img;
      }
      // 否则从 URL 获取尺寸
      const dimensions = await getImageDimensionsFromUrl(img.url);
      if (dimensions) {
        return { ...img, width: dimensions.width, height: dimensions.height };
      }
      return img;
    })
  );
  
  // 同样获取 graphicsImage 的尺寸
  let graphicsImageDimensions: { width: number; height: number } | undefined;
  if (graphicsImage) {
    const dims = await getImageDimensionsFromUrl(graphicsImage);
    if (dims) {
      graphicsImageDimensions = dims;
    }
  }
  
  const result = {
    remainingImages: imagesWithDimensions,
    remainingText: remainingTexts.join('\n'),
    graphicsImage,
    graphicsImageDimensions,
  };
  
  // console.log('Final result - Images:', result.remainingImages.length, 'Text length:', result.remainingText.length, 'Graphics image:', !!result.graphicsImage);
  
  return result;
};

/**
 * Convert image URL to File object for upload
 */
export const urlToFile = async (url: string, filename: string): Promise<File | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn('Failed to fetch image:', url);
      return null;
    }
    
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type });
  } catch (error) {
    console.warn('Error converting URL to file:', error);
    return null;
  }
};

/**
 * Calculate insertion point for new elements when there are selected elements
 * Returns the geometric center position at the bottom of all selected elements + 20px
 */
export const getInsertionPointForSelectedElements = (board: PlaitBoard): Point | null => {
  const selectedElements = getSelectedElements(board);
  
  if (selectedElements.length === 0) {
    return null;
  }
  
  try {
    // Get the bounding rectangle of all selected elements
    const boundingRect = getRectangleByElements(board, selectedElements, false);
    
    // Calculate the geometric center X coordinate
    const centerX = boundingRect.x + boundingRect.width / 2;
    
    // Calculate the bottom Y coordinate + 20px offset
    const insertionY = boundingRect.y + boundingRect.height + 50;
    
    // console.log('Insertion point calculated:', { centerX, insertionY, boundingRect });
    
    return [centerX, insertionY] as Point;
  } catch (error) {
    console.warn('Error calculating insertion point for selected elements:', error);
    return null;
  }
};

/**
 * Calculate insertion point at the bottom of the bottommost element on the board
 * Used when no elements are selected - prevents overlapping with existing content
 * @param board - The PlaitBoard instance
 * @param _imageWidth - Deprecated, kept for backward compatibility (no longer used)
 * @returns Point below the bottommost element, left-aligned with it
 */
export const getInsertionPointBelowBottommostElement = (board: PlaitBoard, _imageWidth?: number): Point | undefined => {
  if (!board.children || board.children.length === 0) {
    // console.log('No elements on board, no default insertion point');
    return undefined;
  }
  
  try {
    // Find the element with the largest Y coordinate (bottommost)
    let bottommostElement: PlaitElement | null = null;
    let maxBottomY = -Infinity;
    
    for (const element of board.children) {
      try {
        const rect = getRectangleByElements(board, [element as PlaitElement], false);
        const bottomY = rect.y + rect.height;
        
        if (bottomY > maxBottomY) {
          maxBottomY = bottomY;
          bottommostElement = element as PlaitElement;
        }
      } catch (error) {
        console.warn('Failed to get rectangle for element:', element, error);
      }
    }
    
    if (!bottommostElement) {
      // console.warn('Could not find any valid element on board');
      return undefined;
    }
    
    // Calculate insertion point below the bottommost element (left-aligned)
    const bottommostRect = getRectangleByElements(board, [bottommostElement], false);
    const leftX = bottommostRect.x; // 左对齐，使用最底部元素的左边缘 X 坐标
    const insertionY = bottommostRect.y + bottommostRect.height + 50; // 50px gap
    
    // console.log('Insertion point below bottommost element:', {
    //   leftX,
    //   insertionY,
    //   bottommostRect,
    // });
    
    // Return left-aligned position
    return [leftX, insertionY] as Point;
  } catch (error) {
    // console.warn('Error calculating insertion point below bottommost element:', error);
    return undefined;
  }
};

/**
 * Get the appropriate insertion point, considering selected elements
 * If elements are selected, return the calculated insertion point
 * Otherwise, return the provided default point
 */
export const getSmartInsertionPoint = (board: PlaitBoard, defaultPoint?: Point): Point | undefined => {
  const calculatedPoint = getInsertionPointForSelectedElements(board);
  return calculatedPoint || defaultPoint;
};

/**
 * 检查一个点是否在当前视口内可见
 * @param board - PlaitBoard 实例
 * @param point - 要检查的点坐标
 * @param margin - 边距，点距离视口边缘的最小距离（默认 50px）
 * @returns 如果点在视口内可见则返回 true
 */
export const isPointInViewport = (board: PlaitBoard, point: Point, margin: number = 50): boolean => {
  try {
    const boardContainer = PlaitBoard.getBoardContainer(board);
    const containerRect = boardContainer.getBoundingClientRect();
    const zoom = board.viewport.zoom;
    const origination = getViewportOrigination(board);

    if (!origination) {
      return false;
    }

    // 计算视口的画布坐标范围
    const viewportLeft = origination[0] + margin / zoom;
    const viewportTop = origination[1] + margin / zoom;
    const viewportRight = origination[0] + (containerRect.width - margin) / zoom;
    const viewportBottom = origination[1] + (containerRect.height - margin) / zoom;

    // 检查点是否在视口范围内
    return (
      point[0] >= viewportLeft &&
      point[0] <= viewportRight &&
      point[1] >= viewportTop &&
      point[1] <= viewportBottom
    );
  } catch (error) {
    console.warn('Error checking if point is in viewport:', error);
    return false;
  }
};

/**
 * 滚动视口使指定点居中显示
 * @param board - PlaitBoard 实例
 * @param point - 目标点坐标（画布坐标系）
 */
export const scrollToPoint = (board: PlaitBoard, point: Point): void => {
  try {
    const boardContainer = PlaitBoard.getBoardContainer(board);
    const containerRect = boardContainer.getBoundingClientRect();
    const zoom = board.viewport.zoom;

    // 计算新的视口原点，使目标点居中
    const newOriginationX = point[0] - containerRect.width / (2 * zoom);
    const newOriginationY = point[1] - containerRect.height / (2 * zoom);

    // console.log('[scrollToPoint] Scrolling to point:', {
    //   targetPoint: point,
    //   currentZoom: zoom,
    //   newOrigination: [newOriginationX, newOriginationY],
    // });

    // 使用 BoardTransforms 更新视口位置，保持当前缩放不变
    BoardTransforms.updateViewport(board, [newOriginationX, newOriginationY], zoom);
  } catch (error) {
    console.warn('Error scrolling to point:', error);
  }
};

/**
 * 如果点不在当前视口内，则滚动视口使其可见（居中显示）
 * @param board - PlaitBoard 实例
 * @param point - 目标点坐标（画布坐标系）
 * @param margin - 边距检查值（默认 100px）
 */
export const scrollToPointIfNeeded = (board: PlaitBoard, point: Point, margin: number = 100): void => {
  if (!isPointInViewport(board, point, margin)) {
    scrollToPoint(board, point);
  }
};

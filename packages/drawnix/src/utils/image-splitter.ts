/**
 * 智能图片分割器
 *
 * 检测图片中的白色/浅色分割线，自动将图片拆分成多个独立图片
 */

import {
  PlaitBoard,
  Point,
  getRectangleByElements,
  PlaitElement,
} from '@plait/core';
import { trackMemory } from './common';
import { DrawTransforms } from '@plait/draw';
import { loadImage, trimBorders } from '@aitu/utils';
import { scrollToPointIfNeeded } from './selection-utils';
import {
  type SplitImageElement,
  type TrimMode,
  getTrimParams,
} from './image-split-core';

// 重新导出核心模块的类型
export type { SplitImageElement, TrimMode } from './image-split-core';
export { SPLIT_PRESETS } from './image-split-core';

/**
 * 检测结果
 */
export interface GridDetectionResult {
  /** 检测到的行数 */
  rows: number;
  /** 检测到的列数 */
  cols: number;
  /** 行分割线位置（Y 坐标） */
  rowLines: number[];
  /** 列分割线位置（X 坐标） */
  colLines: number[];
  /** 白边偏移量，用于精确分割 */
  borderOffset?: { left: number; top: number; right: number; bottom: number };
  /** 使用检测到的线坐标裁剪，避免硬边界兜底被重新等分 */
  useDetectedLines?: boolean;
}

/**
 * 检测像素是否为白色/浅色（分割线颜色）
 */
function isLightPixel(
  r: number,
  g: number,
  b: number,
  threshold = 240
): boolean {
  // 检查是否接近白色
  return r >= threshold && g >= threshold && b >= threshold;
}

/**
 * 检测像素是否为透明（用于检测合并图片的透明区域）
 */
function isTransparentPixel(a: number, threshold = 50): boolean {
  // Alpha 值小于阈值认为是透明
  return a < threshold;
}

/**
 * 获取一行的白色像素比例
 */
function getRowWhiteRatio(imageData: ImageData, y: number): number {
  const { width, data } = imageData;
  let whiteCount = 0;

  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    if (isLightPixel(data[idx], data[idx + 1], data[idx + 2])) {
      whiteCount++;
    }
  }

  return whiteCount / width;
}

/**
 * 获取一行的透明像素比例
 */
function getRowTransparentRatio(imageData: ImageData, y: number): number {
  const { width, data } = imageData;
  let transparentCount = 0;

  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    if (isTransparentPixel(data[idx + 3])) {
      transparentCount++;
    }
  }

  return transparentCount / width;
}

/**
 * 获取一列的白色像素比例
 */
function getColWhiteRatio(imageData: ImageData, x: number): number {
  const { width, height, data } = imageData;
  let whiteCount = 0;

  for (let y = 0; y < height; y++) {
    const idx = (y * width + x) * 4;
    if (isLightPixel(data[idx], data[idx + 1], data[idx + 2])) {
      whiteCount++;
    }
  }

  return whiteCount / height;
}

/**
 * 获取一列的透明像素比例
 */
function getColTransparentRatio(imageData: ImageData, x: number): number {
  const { width, height, data } = imageData;
  let transparentCount = 0;

  for (let y = 0; y < height; y++) {
    const idx = (y * width + x) * 4;
    if (isTransparentPixel(data[idx + 3])) {
      transparentCount++;
    }
  }

  return transparentCount / height;
}

/**
 * 检测一行像素是否为分割线（大部分为白色）
 */
function isHorizontalSplitLine(
  imageData: ImageData,
  y: number,
  minWhiteRatio = 0.9
): boolean {
  return getRowWhiteRatio(imageData, y) >= minWhiteRatio;
}

/**
 * 检测一行像素是否为透明分割线（用于合并图片还原）
 * 要求 100% 透明，避免将图形/文字的细线误判为分割线
 */
function isHorizontalTransparentLine(
  imageData: ImageData,
  y: number,
  minTransparentRatio = 1.0 // 必须 100% 透明
): boolean {
  return getRowTransparentRatio(imageData, y) >= minTransparentRatio;
}

/**
 * 检测一列像素是否为分割线
 */
function isVerticalSplitLine(
  imageData: ImageData,
  x: number,
  minWhiteRatio = 0.9
): boolean {
  return getColWhiteRatio(imageData, x) >= minWhiteRatio;
}

/**
 * 检测一列像素是否为透明分割线（用于合并图片还原）
 * 要求 100% 透明，避免将图形/文字的细线误判为分割线
 */
function isVerticalTransparentLine(
  imageData: ImageData,
  x: number,
  minTransparentRatio = 1.0 // 必须 100% 透明
): boolean {
  return getColTransparentRatio(imageData, x) >= minTransparentRatio;
}

/**
 * 合并相邻的分割线位置
 */
function mergeSplitLines(lines: number[], minGap = 10): number[] {
  if (lines.length === 0) return [];

  const sorted = [...lines].sort((a, b) => a - b);
  const merged: number[] = [];
  let groupStart = sorted[0];
  let groupEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - groupEnd <= minGap) {
      // 继续当前组
      groupEnd = sorted[i];
    } else {
      // 保存当前组的中点
      merged.push(Math.floor((groupStart + groupEnd) / 2));
      groupStart = sorted[i];
      groupEnd = sorted[i];
    }
  }

  // 保存最后一组
  merged.push(Math.floor((groupStart + groupEnd) / 2));

  return merged;
}

/**
 * 根据图片比例筛选可能的宫格配置
 * 假设子图是正方形，根据图片宽高比计算合理的 rows/cols 组合
 *
 * @param width - 图片宽度
 * @param height - 图片高度
 * @returns 按可能性排序的宫格配置列表
 */
function getPossibleGridConfigs(
  width: number,
  height: number
): Array<{ rows: number; cols: number; score: number }> {
  // 所有候选配置
  const allConfigs = [
    { rows: 4, cols: 4 },
    { rows: 4, cols: 3 },
    { rows: 4, cols: 2 },
    { rows: 2, cols: 2 },
    { rows: 2, cols: 3 },
    { rows: 2, cols: 4 },
    { rows: 3, cols: 2 },
    { rows: 3, cols: 3 },
    { rows: 3, cols: 4 },
    { rows: 5, cols: 5 },
  ];

  // 计算每个配置的得分（子图越接近正方形得分越高）
  const scoredConfigs = allConfigs.map((config) => {
    // 子图的宽高比
    const cellWidth = width / config.cols;
    const cellHeight = height / config.rows;
    const cellAspectRatio = cellWidth / cellHeight;

    // 计算与正方形的偏离程度（1.0 表示完美正方形）
    // 偏离越小得分越高
    const deviation = Math.abs(cellAspectRatio - 1.0);
    const score = 1 / (1 + deviation * 10); // 转换为 0-1 的得分

    return { ...config, score, cellAspectRatio };
  });

  // 按得分降序排序，只保留子图接近正方形的配置（偏离不超过 20%）
  const validConfigs = scoredConfigs.filter(
    (c) => c.cellAspectRatio >= 0.8 && c.cellAspectRatio <= 1.25
  );

  return validConfigs;
}

/**
 * 直接使用图片数据检测标准宫格
 * 尝试常见的宫格配置（2x2, 3x3, 4x4, 2x3, 3x2 等），验证等间距分割线是否存在
 *
 * @param imageData - 图片像素数据
 * @param width - 图片宽度
 * @param height - 图片高度
 * @returns 检测到的宫格配置，如果不是标准宫格返回 null
 */
function detectStandardGridFromImage(
  imageData: ImageData,
  width: number,
  height: number
): { rows: number; cols: number } | null {
  // 根据图片比例获取可能的宫格配置（子图接近正方形的优先）
  const gridConfigs = getPossibleGridConfigs(width, height);

  if (gridConfigs.length === 0) {
    return null;
  }

  for (const config of gridConfigs) {
    const result = verifyGridConfig(
      imageData,
      width,
      height,
      config.rows,
      config.cols
    );
    if (result) {
      return { rows: config.rows, cols: config.cols };
    }
  }

  return null;
}

/**
 * 验证指定的宫格配置是否有效
 * 检查等间距位置是否存在白色分割线
 */
function verifyGridConfig(
  imageData: ImageData,
  width: number,
  height: number,
  rows: number,
  cols: number
): boolean {
  const cellWidth = width / cols;
  const cellHeight = height / rows;

  // 分割线检测的容差范围（像素）
  const tolerance = 10;
  // 分割线需要的最小白色像素比例（降低阈值以适应实际情况）
  const minWhiteRatio = 0.7;

  // 验证垂直分割线（列之间）
  for (let col = 1; col < cols; col++) {
    const expectedX = Math.round(col * cellWidth);
    let found = false;
    let maxRatio = 0;

    // 在容差范围内搜索分割线
    for (let x = expectedX - tolerance; x <= expectedX + tolerance; x++) {
      if (x < 0 || x >= width) continue;
      const ratio = getColWhiteRatio(imageData, x);
      maxRatio = Math.max(maxRatio, ratio);
      if (ratio >= minWhiteRatio) {
        found = true;
        break;
      }
    }

    if (!found) return false;
  }

  // 验证水平分割线（行之间）
  for (let row = 1; row < rows; row++) {
    const expectedY = Math.round(row * cellHeight);
    let found = false;
    let maxRatio = 0;

    // 在容差范围内搜索分割线
    for (let y = expectedY - tolerance; y <= expectedY + tolerance; y++) {
      if (y < 0 || y >= height) continue;
      const ratio = getRowWhiteRatio(imageData, y);
      maxRatio = Math.max(maxRatio, ratio);
      if (ratio >= minWhiteRatio) {
        found = true;
        break;
      }
    }

    if (!found) return false;
  }

  return true;
}

interface HardSeamStats {
  mean: number;
  strongRatio: number;
  edgeBalance: number;
}

interface HardSeamMatch extends HardSeamStats {
  position: number;
}

interface HardSeamGridConfig {
  rows: number;
  cols: number;
  minMean?: number;
  minStrongRatio?: number;
  score?: number;
  rowLines?: number[];
  colLines?: number[];
}

const HARD_SEAM_GRID_CONFIGS = [
  { rows: 2, cols: 2, minMean: 42, minStrongRatio: 0.46 },
  { rows: 2, cols: 3, minMean: 44, minStrongRatio: 0.48 },
  { rows: 3, cols: 2, minMean: 44, minStrongRatio: 0.48 },
  { rows: 2, cols: 4, minMean: 46, minStrongRatio: 0.5 },
  { rows: 4, cols: 2, minMean: 46, minStrongRatio: 0.5 },
  { rows: 3, cols: 3, minMean: 50, minStrongRatio: 0.52 },
];

function isReasonableHardSeamGrid(
  width: number,
  height: number,
  rows: number,
  cols: number
): boolean {
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const cellAspectRatio = cellWidth / cellHeight;

  return cellAspectRatio >= 0.72 && cellAspectRatio <= 1.4;
}

function getColorDistance(
  data: Uint8ClampedArray,
  leftIdx: number,
  rightIdx: number
): number {
  const dr = data[leftIdx] - data[rightIdx];
  const dg = data[leftIdx + 1] - data[rightIdx + 1];
  const db = data[leftIdx + 2] - data[rightIdx + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function getVerticalHardSeamStats(
  imageData: ImageData,
  x: number
): HardSeamStats {
  const { width, height, data } = imageData;
  if (x <= 0 || x >= width) {
    return { mean: 0, strongRatio: 0, edgeBalance: 0 };
  }

  const yStart = Math.floor(height * 0.03);
  const yEnd = Math.ceil(height * 0.97);
  const step = Math.max(1, Math.floor(height / 900));
  let total = 0;
  let strong = 0;
  let count = 0;
  let longestStrongRun = 0;
  let currentStrongRun = 0;

  for (let y = yStart; y < yEnd; y += step) {
    const leftIdx = (y * width + x - 1) * 4;
    const rightIdx = (y * width + x) * 4;
    const distance = getColorDistance(data, leftIdx, rightIdx);
    total += distance;
    if (distance >= 42) {
      strong++;
      currentStrongRun++;
      longestStrongRun = Math.max(longestStrongRun, currentStrongRun);
    } else {
      currentStrongRun = 0;
    }
    count++;
  }

  return count > 0
    ? {
        mean: total / count,
        strongRatio: strong / count,
        edgeBalance: longestStrongRun / count,
      }
    : { mean: 0, strongRatio: 0, edgeBalance: 0 };
}

function getHorizontalHardSeamStats(
  imageData: ImageData,
  y: number
): HardSeamStats {
  const { width, height, data } = imageData;
  if (y <= 0 || y >= height) {
    return { mean: 0, strongRatio: 0, edgeBalance: 0 };
  }

  const xStart = Math.floor(width * 0.03);
  const xEnd = Math.ceil(width * 0.97);
  const step = Math.max(1, Math.floor(width / 900));
  let total = 0;
  let strong = 0;
  let count = 0;
  let longestStrongRun = 0;
  let currentStrongRun = 0;

  for (let x = xStart; x < xEnd; x += step) {
    const topIdx = ((y - 1) * width + x) * 4;
    const bottomIdx = (y * width + x) * 4;
    const distance = getColorDistance(data, topIdx, bottomIdx);
    total += distance;
    if (distance >= 42) {
      strong++;
      currentStrongRun++;
      longestStrongRun = Math.max(longestStrongRun, currentStrongRun);
    } else {
      currentStrongRun = 0;
    }
    count++;
  }

  return count > 0
    ? {
        mean: total / count,
        strongRatio: strong / count,
        edgeBalance: longestStrongRun / count,
      }
    : { mean: 0, strongRatio: 0, edgeBalance: 0 };
}

function isHardSeam(
  stats: HardSeamStats,
  config?: Pick<HardSeamGridConfig, 'minMean' | 'minStrongRatio'>
): boolean {
  return (
    stats.edgeBalance >= 0.18 &&
    stats.mean >= (config?.minMean ?? 42) &&
    stats.strongRatio >= (config?.minStrongRatio ?? 0.46)
  );
}

function getBestVerticalHardSeamStats(
  imageData: ImageData,
  expectedX: number
): HardSeamMatch {
  const tolerance = Math.max(4, Math.floor(imageData.width * 0.006));
  let best: HardSeamMatch = {
    mean: 0,
    strongRatio: 0,
    edgeBalance: 0,
    position: expectedX,
  };

  for (let x = expectedX - tolerance; x <= expectedX + tolerance; x++) {
    const stats = getVerticalHardSeamStats(imageData, x);
    if (stats.mean * stats.strongRatio > best.mean * best.strongRatio) {
      best = { ...stats, position: x };
    }
  }

  return best;
}

function getBestHorizontalHardSeamStats(
  imageData: ImageData,
  expectedY: number
): HardSeamMatch {
  const tolerance = Math.max(4, Math.floor(imageData.height * 0.006));
  let best: HardSeamMatch = {
    mean: 0,
    strongRatio: 0,
    edgeBalance: 0,
    position: expectedY,
  };

  for (let y = expectedY - tolerance; y <= expectedY + tolerance; y++) {
    const stats = getHorizontalHardSeamStats(imageData, y);
    if (stats.mean * stats.strongRatio > best.mean * best.strongRatio) {
      best = { ...stats, position: y };
    }
  }

  return best;
}

/**
 * 检测无留白拼接图的硬边界。
 *
 * 一些模型会输出没有白色/透明分割线的拼图，图片之间只有突变的像素边界。
 * 这里作为兜底，只在常见宫格位置存在贯穿式强边界时启用。
 */
function detectHardSeamGridFromImage(
  imageData: ImageData,
  width: number,
  height: number
): HardSeamGridConfig | null {
  let bestConfig: HardSeamGridConfig | null = null;

  for (const config of HARD_SEAM_GRID_CONFIGS) {
    if (!isReasonableHardSeamGrid(width, height, config.rows, config.cols)) {
      continue;
    }

    const cellWidth = width / config.cols;
    const cellHeight = height / config.rows;
    const seamStats: HardSeamStats[] = [];
    const colLines: number[] = [];
    const rowLines: number[] = [];
    let valid = true;

    for (let col = 1; col < config.cols; col++) {
      const stats = getBestVerticalHardSeamStats(
        imageData,
        Math.round(col * cellWidth)
      );
      if (!isHardSeam(stats, config)) {
        valid = false;
        break;
      }
      seamStats.push(stats);
      colLines.push(stats.position);
    }

    if (!valid) {
      continue;
    }

    for (let row = 1; row < config.rows; row++) {
      const stats = getBestHorizontalHardSeamStats(
        imageData,
        Math.round(row * cellHeight)
      );
      if (!isHardSeam(stats, config)) {
        valid = false;
        break;
      }
      seamStats.push(stats);
      rowLines.push(stats.position);
    }

    if (!valid || seamStats.length === 0) {
      continue;
    }

    const score =
      seamStats.reduce(
        (sum, stats) => sum + stats.mean * stats.strongRatio * stats.edgeBalance,
        0
      ) / seamStats.length;

    if (!bestConfig || score > (bestConfig.score ?? 0)) {
      bestConfig = { ...config, rowLines, colLines, score };
    }
  }

  return bestConfig;
}

/**
 * 验证分割线是否有足够的宽度（连续多行/列都是白色）
 * @param lines - 检测到的分割线位置
 * @param minWidth - 最小宽度（默认 3 像素）
 * @returns 有效的分割线位置
 */
function validateSplitLineWidth(lines: number[], minWidth = 3): number[] {
  if (lines.length === 0) return [];

  const sorted = [...lines].sort((a, b) => a - b);
  const validated: number[] = [];

  let groupStart = sorted[0];
  let groupEnd = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] - groupEnd <= 1) {
      groupEnd = sorted[i];
    } else {
      const groupWidth = groupEnd - groupStart + 1;
      if (groupWidth >= minWidth) {
        validated.push(Math.floor((groupStart + groupEnd) / 2));
      }
      if (i < sorted.length) {
        groupStart = sorted[i];
        groupEnd = sorted[i];
      }
    }
  }

  return validated;
}

/**
 * 检测图片是否完全透明（没有任何不透明的像素）
 */
function isCompletelyTransparent(imageData: ImageData): boolean {
  const { data } = imageData;

  // 检查是否所有像素都是透明的
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 50) {
      // Alpha > 50 认为是不透明
      return false;
    }
  }

  return true;
}

/**
 * 检测图片是否包含透明度（Alpha 通道）
 * 用于判断是否为合并图片
 */
function hasTransparency(imageData: ImageData): boolean {
  const { data } = imageData;
  let transparentPixelCount = 0;
  const totalPixels = data.length / 4;

  // 采样检测，每隔 10 个像素检测一次以提高性能
  for (let i = 3; i < data.length; i += 40) {
    if (isTransparentPixel(data[i])) {
      transparentPixelCount++;
    }
  }

  // 如果超过 5% 的采样像素是透明的，认为图片有透明度
  const sampledPixels = Math.floor(totalPixels / 10);
  return transparentPixelCount / sampledPixels > 0.05;
}

/**
 * 内部检测函数，返回图片数据和检测结果
 * 注意：调用此函数前应该已经完成去白边处理
 *
 * @param imageUrl - 图片 URL
 * @param forceTransparency - 强制使用透明分割线检测（用于递归拆分时保持一致性）
 */
async function detectGridLinesInternal(
  imageUrl: string,
  forceTransparency?: boolean
): Promise<{
  detection: GridDetectionResult;
  img: HTMLImageElement;
  imageData: ImageData;
  canvas: HTMLCanvasElement;
  hasTransparency: boolean;
}> {
  const img = await loadImage(imageUrl);
  const { naturalWidth: width, naturalHeight: height } = img;

  // 创建 Canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);

  // 检测图片是否有透明度（合并图片特征）
  // 如果 forceTransparency 为 true，则强制使用透明分割线检测
  const hasAlpha = forceTransparency ?? hasTransparency(imageData);

  // console.log('[detectGridLinesInternal] Transparency detection:', {
  //   hasAlpha,
  //   forceTransparency,
  //   width,
  //   height
  // });

  // 检测水平分割线，跳过边缘区域（前后 5%）
  const horizontalLines: number[] = [];
  const marginY = Math.floor(height * 0.05);

  if (hasAlpha) {
    // 合并图片：只检测透明分割线，避免误判白色内容为分割线
    for (let y = marginY; y < height - marginY; y++) {
      if (isHorizontalTransparentLine(imageData, y)) {
        horizontalLines.push(y);
      }
    }
  } else {
    // 普通图片：检测白色分割线
    for (let y = marginY; y < height - marginY; y++) {
      if (isHorizontalSplitLine(imageData, y)) {
        horizontalLines.push(y);
      }
    }
  }

  // 检测垂直分割线
  const verticalLines: number[] = [];
  const marginX = Math.floor(width * 0.05);

  if (hasAlpha) {
    // 合并图片：只检测透明分割线
    for (let x = marginX; x < width - marginX; x++) {
      if (isVerticalTransparentLine(imageData, x)) {
        verticalLines.push(x);
      }
    }
  } else {
    // 普通图片：检测白色分割线
    for (let x = marginX; x < width - marginX; x++) {
      if (isVerticalSplitLine(imageData, x)) {
        verticalLines.push(x);
      }
    }
  }

  // 验证分割线宽度（至少 2 像素宽）并合并相邻分割线
  const validatedHorizontal = validateSplitLineWidth(horizontalLines, 2);
  const validatedVertical = validateSplitLineWidth(verticalLines, 2);
  const mergedHorizontal = mergeSplitLines(
    validatedHorizontal,
    Math.floor(height * 0.02)
  );
  const mergedVertical = mergeSplitLines(
    validatedVertical,
    Math.floor(width * 0.02)
  );

  // 优先使用图片像素数据检测标准宫格
  // 直接验证预期位置是否存在白色分割线，避免"切人头"问题
  const standardGrid = detectStandardGridFromImage(imageData, width, height);

  if (standardGrid) {
    // 计算标准化的分割线位置
    const cellWidth = width / standardGrid.cols;
    const cellHeight = height / standardGrid.rows;
    const standardRowLines: number[] = [];
    const standardColLines: number[] = [];

    for (let i = 1; i < standardGrid.rows; i++) {
      standardRowLines.push(Math.round(i * cellHeight));
    }
    for (let i = 1; i < standardGrid.cols; i++) {
      standardColLines.push(Math.round(i * cellWidth));
    }

    return {
      detection: {
        rows: standardGrid.rows,
        cols: standardGrid.cols,
        rowLines: standardRowLines,
        colLines: standardColLines,
      },
      img,
      imageData,
      canvas,
      hasTransparency: hasAlpha,
    };
  }

  const hardSeamGrid = hasAlpha
    ? null
    : detectHardSeamGridFromImage(imageData, width, height);

  if (hardSeamGrid) {
    return {
      detection: {
        rows: hardSeamGrid.rows,
        cols: hardSeamGrid.cols,
        rowLines: hardSeamGrid.rowLines ?? [],
        colLines: hardSeamGrid.colLines ?? [],
        useDetectedLines: true,
      },
      img,
      imageData,
      canvas,
      hasTransparency: hasAlpha,
    };
  }

  // 不符合宫格规律，使用原始检测结果
  return {
    detection: {
      rows: mergedHorizontal.length + 1,
      cols: mergedVertical.length + 1,
      rowLines: mergedHorizontal,
      colLines: mergedVertical,
    },
    img,
    imageData,
    canvas,
    hasTransparency: hasAlpha,
  };
}

/**
 * 智能检测图片中的网格分割线
 *
 * @param imageUrl - 图片 URL
 * @param forceTransparency - 强制使用透明分割线检测（用于递归拆分时保持一致性）
 */
export async function detectGridLines(
  imageUrl: string,
  forceTransparency?: boolean
): Promise<GridDetectionResult> {
  const { detection } = await detectGridLinesInternal(
    imageUrl,
    forceTransparency
  );
  return detection;
}

/**
 * 快速检测图片是否包含分割线（用于判断是否显示拆图按钮）
 * 支持三种格式：
 * 1. 网格分割线格式（白色分割线）
 * 2. 透明分割线格式（合并图片的透明区域）
 * 3. 灵感图格式（灰色背景 + 白边框图片）
 *
 * @param imageUrl - 图片 URL
 * @returns 是否包含分割线
 */
export async function hasSplitLines(imageUrl: string): Promise<boolean> {
  try {
    // 0. 先去除白边
    const { trimmedImageUrl } = await trimImageWhiteBorders(imageUrl);

    // 1. 检测网格分割线（使用去白边后的图片）
    // 注意：detectGridLinesInternal 内部已经支持透明分割线检测
    const { detection } = await detectGridLinesInternal(trimmedImageUrl);
    if (detection.rows > 1 || detection.cols > 1) {
      // console.log('[hasSplitLines] Detected grid lines:', { rows: detection.rows, cols: detection.cols });
      return true;
    }

    // 2. 检测灵感图格式（灰色背景 + 白边框）
    const isPhotoWall = await detectPhotoWallFormat(trimmedImageUrl);
    // if (isPhotoWall) {
    //   console.log('[hasSplitLines] Detected photo wall format');
    // }
    return isPhotoWall;
  } catch (error) {
    console.warn('[ImageSplitter] Failed to detect split lines:', error);
    return false;
  }
}

/**
 * 快速检测图片是否为灵感图格式
 * 特征：灰色背景占比较大，存在多个白色边框区域
 */
async function detectPhotoWallFormat(imageUrl: string): Promise<boolean> {
  try {
    // 动态导入灵感图检测器
    const { detectPhotoWallRegions } = await import('./photo-wall-splitter');
    const result = await detectPhotoWallRegions(imageUrl, {
      minRegionSize: 3000, // 降低阈值以快速检测
      minRegionRatio: 0.005,
    });

    // 如果检测到 2 个以上的区域，认为是灵感图
    return result.count >= 2;
  } catch (error) {
    console.warn(
      '[ImageSplitter] Failed to detect inspiration board format:',
      error
    );
    return false;
  }
}

/**
 * 检测是否为标准宫格布局（等间距分割）
 * 用于决定分割时使用精确模式还是普通模式
 */
function isUniformGridLayout(
  detection: GridDetectionResult,
  width: number,
  height: number
): boolean {
  const { rowLines, colLines } = detection;

  if (detection.useDetectedLines) {
    return false;
  }

  // 必须同时有行和列的分割线才算标准宫格
  if (rowLines.length === 0 || colLines.length === 0) {
    return false;
  }

  // 检查行分割线是否等间距
  const expectedRowGap = height / (rowLines.length + 1);
  for (let i = 0; i < rowLines.length; i++) {
    const expectedPos = expectedRowGap * (i + 1);
    if (Math.abs(rowLines[i] - expectedPos) > expectedRowGap * 0.15) {
      return false;
    }
  }

  // 检查列分割线是否等间距
  const expectedColGap = width / (colLines.length + 1);
  for (let i = 0; i < colLines.length; i++) {
    const expectedPos = expectedColGap * (i + 1);
    if (Math.abs(colLines[i] - expectedPos) > expectedColGap * 0.15) {
      return false;
    }
  }

  return true;
}

/**
 * 严格去白边：只裁剪边缘每个像素都是浅色或透明的行/列
 * 用于宫格图分割后的子图处理，避免误裁人物内容
 *
 * 算法：从四边向内扫描，只有当整行/整列的每个像素都是浅色或透明时才裁剪
 * 浅色定义：RGB 三通道都 >= 阈值，且颜色接近（避免裁掉彩色内容）
 *
 * @param ctx - Canvas 2D 上下文
 * @param width - 图片宽度
 * @param height - 图片高度
 * @param lightnessThreshold - 亮度阈值（默认 220，RGB >= 此值认为是浅色）
 * @param alphaThreshold - 透明阈值（默认 30，alpha <= 此值认为透明）
 * @returns 裁剪后的边界
 */
function getStrictWhiteBorders(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lightnessThreshold = 220,
  alphaThreshold = 30
): { top: number; right: number; bottom: number; left: number } {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // 检查像素是否为浅色或透明
  // 浅色：RGB 三通道都 >= lightnessThreshold，且颜色差异不大（排除彩色）
  // 透明：alpha <= alphaThreshold
  const isLightOrTransparentPixel = (idx: number): boolean => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];

    // 透明像素
    if (a <= alphaThreshold) {
      return true;
    }

    // 检查是否为浅色（RGB 都要足够高）
    if (
      r < lightnessThreshold ||
      g < lightnessThreshold ||
      b < lightnessThreshold
    ) {
      return false;
    }

    // 检查颜色是否接近（排除鲜艳的彩色，如浅粉、浅蓝等可能是内容）
    // 允许一定的色差（如米黄色 RGB 差值约 30）
    const maxDiff = Math.max(r, g, b) - Math.min(r, g, b);
    return maxDiff <= 40;
  };

  // 检查整行是否每个像素都是浅色或透明
  const isRowAllLightOrTransparent = (y: number): boolean => {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (!isLightOrTransparentPixel(idx)) return false;
    }
    return true;
  };

  // 检查整列是否每个像素都是浅色或透明
  const isColAllLightOrTransparent = (x: number): boolean => {
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      if (!isLightOrTransparentPixel(idx)) return false;
    }
    return true;
  };

  // 从顶部向下扫描
  let top = 0;
  while (top < height && isRowAllLightOrTransparent(top)) {
    top++;
  }

  // 从底部向上扫描
  let bottom = height - 1;
  while (bottom > top && isRowAllLightOrTransparent(bottom)) {
    bottom--;
  }

  // 从左边向右扫描
  let left = 0;
  while (left < width && isColAllLightOrTransparent(left)) {
    left++;
  }

  // 从右边向左扫描
  let right = width - 1;
  while (right > left && isColAllLightOrTransparent(right)) {
    right--;
  }

  return { top, right, bottom, left };
}

/**
 * 使用精确等分方式分割标准宫格图
 * 分割后严格去除100%纯白的边缘行/列
 *
 * @param img - 图片元素
 * @param rows - 行数
 * @param cols - 列数
 * @param forceTransparency - 强制使用透明分割线检测（用于递归拆分时保持一致性）
 */
async function splitUniformGrid(
  img: HTMLImageElement,
  rows: number,
  cols: number,
  forceTransparency?: boolean
): Promise<SplitImageElement[]> {
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  // 精确计算每个格子的尺寸
  const cellWidth = Math.floor(width / cols);
  const cellHeight = Math.floor(height / rows);

  const elements: SplitImageElement[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;

      // 精确计算裁剪区域
      const sx = col * cellWidth;
      const sy = row * cellHeight;

      // 创建 Canvas 用于裁剪
      const canvas = document.createElement('canvas');
      canvas.width = cellWidth;
      canvas.height = cellHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      // 精确裁剪，不做去白边处理
      // 标准宫格的分割线已经在外围去白边时处理过了
      ctx.drawImage(
        img,
        sx,
        sy,
        cellWidth,
        cellHeight,
        0,
        0,
        cellWidth,
        cellHeight
      );

      elements.push({
        imageData: canvas.toDataURL('image/jpeg', 0.92),
        index,
        width: cellWidth,
        height: cellHeight,
        sourceX: sx,
        sourceY: sy,
        hasTransparency: forceTransparency,
      });
    }
  }

  return elements;
}

/**
 * 根据检测到的分割线分割图片
 *
 * @param imageUrl - 图片 URL
 * @param detection - 检测结果
 * @param forceTransparency - 强制使用透明分割线检测（用于递归拆分时保持一致性）
 */
export async function splitImageByLines(
  imageUrl: string,
  detection: GridDetectionResult,
  forceTransparency?: boolean,
  options?: { trimMode?: TrimMode }
): Promise<SplitImageElement[]> {
  const img = await loadImage(imageUrl);
  const { naturalWidth: width, naturalHeight: height } = img;

  // 检测是否为标准宫格布局
  const isUniformGrid = isUniformGridLayout(detection, width, height);

  // 对于标准宫格，使用精确等分方式（类似 gridSplitter.split）
  // 注意：调用前已完成去白边处理
  if (isUniformGrid) {
    return splitUniformGrid(
      img,
      detection.rows,
      detection.cols,
      forceTransparency
    );
  }

  // 非标准布局：使用检测到的分割线位置进行分割
  const rowBounds = [0, ...detection.rowLines, height];
  const colBounds = [0, ...detection.colLines, width];

  const elements: SplitImageElement[] = [];
  let index = 0;

  // 创建完整图片的 Canvas 用于获取像素数据
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = width;
  fullCanvas.height = height;
  const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
  if (!fullCtx) return elements;
  fullCtx.drawImage(img, 0, 0);

  // 检测图片是否有透明度（合并图片特征）
  // 如果 forceTransparency 为 true，则强制使用透明分割线检测
  const fullImageData = fullCtx.getImageData(0, 0, width, height);
  const hasAlpha = forceTransparency ?? hasTransparency(fullImageData);

  // console.log('[splitImageByLines] Image transparency detection:', {
  //   hasAlpha,
  //   forceTransparency
  // });

  // 获取去白边模式，默认为普通模式
  const trimMode: TrimMode = options?.trimMode ?? 'normal';
  const trimParams = getTrimParams(trimMode);

  for (let row = 0; row < rowBounds.length - 1; row++) {
    for (let col = 0; col < colBounds.length - 1; col++) {
      const x1 = colBounds[col];
      const x2 = colBounds[col + 1];
      const y1 = rowBounds[row];
      const y2 = rowBounds[row + 1];

      // 根据图片类型选择 padding
      // 透明图片或严格模式：不使用 padding
      // 普通图片：使用较小的 padding（分割线通常较窄）
      const splitLinePadding =
        detection.useDetectedLines || hasAlpha || trimMode === 'strict' ? 0 : 2;

      const sx = x1 + (col > 0 ? splitLinePadding : 0);
      const sy = y1 + (row > 0 ? splitLinePadding : 0);
      const sw =
        x2 -
        x1 -
        (col > 0 ? splitLinePadding : 0) -
        (col < colBounds.length - 2 ? splitLinePadding : 0);
      const sh =
        y2 -
        y1 -
        (row > 0 ? splitLinePadding : 0) -
        (row < rowBounds.length - 2 ? splitLinePadding : 0);

      if (sw <= 0 || sh <= 0) continue;

      // 获取这个区域的像素数据
      const regionData = fullCtx.getImageData(sx, sy, sw, sh);

      // 检查是否完全透明（对于透明背景图片）
      if (hasAlpha && isCompletelyTransparent(regionData)) {
        continue;
      }

      // 根据配置选择裁剪方式
      let borders: { top: number; right: number; bottom: number; left: number };
      if (hasAlpha) {
        // 透明图片：使用严格模式裁剪透明边框
        borders = trimTransparentBorders(regionData, true);
      } else if (trimParams) {
        // 使用配置的去白边参数
        borders = trimBorders(
          regionData,
          trimParams.borderRatio,
          trimParams.maxTrimRatio
        );
      } else {
        // 不裁剪（trimMode: 'none'）
        borders = { top: 0, right: sw - 1, bottom: sh - 1, left: 0 };
      }

      // 计算最终裁剪区域
      const finalSx = sx + borders.left;
      const finalSy = sy + borders.top;
      const finalSw = borders.right - borders.left + 1;
      const finalSh = borders.bottom - borders.top + 1;

      // 确保有有效内容
      if (finalSw <= 10 || finalSh <= 10) continue;

      // 创建最终裁剪 Canvas
      const canvas = document.createElement('canvas');
      canvas.width = finalSw;
      canvas.height = finalSh;

      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      ctx.drawImage(
        img,
        finalSx,
        finalSy,
        finalSw,
        finalSh,
        0,
        0,
        finalSw,
        finalSh
      );

      // 对于透明背景图片，保存为 PNG 以保留透明度
      const imageFormat = hasAlpha ? 'image/png' : 'image/jpeg';
      const imageQuality = hasAlpha ? undefined : 0.92;

      elements.push({
        imageData: canvas.toDataURL(imageFormat, imageQuality),
        index: index++,
        width: finalSw,
        height: finalSh,
        sourceX: finalSx,
        sourceY: finalSy,
        hasTransparency: hasAlpha, // 传递透明度标记给子元素
      });
    }
  }

  return elements;
}

/**
 * 检测像素是否为白色/浅色（只检测白色，不检测黑色）
 * 专门用于宫格图去白边，避免误裁黑色内容
 */
function isWhitePixel(
  r: number,
  g: number,
  b: number,
  threshold = 235
): boolean {
  return r >= threshold && g >= threshold && b >= threshold;
}

/**
 * 只裁剪白色边框（不裁剪黑色）
 * 专门用于宫格图拆分前的预处理
 *
 * 算法：从边缘向内扫描，检测中间区域（避开圆角）是否为白色
 */
function trimWhiteBordersOnly(
  imageData: ImageData,
  borderRatio = 0.7,
  maxTrimRatio = 0.15
): { top: number; right: number; bottom: number; left: number } {
  const { width, height, data } = imageData;

  // 计算每个方向的最大裁剪像素数
  const maxTrimTop = Math.floor(height * maxTrimRatio);
  const maxTrimBottom = Math.floor(height * maxTrimRatio);
  const maxTrimLeft = Math.floor(width * maxTrimRatio);
  const maxTrimRight = Math.floor(width * maxTrimRatio);

  // 圆角区域大小（检测时跳过边缘的圆角部分）
  const cornerSize = Math.min(width, height) * 0.15;

  // 检测一行是否为白色边框行（只检测中间部分，避开圆角）
  const isRowWhite = (y: number): boolean => {
    let whiteCount = 0;
    const startX = Math.floor(cornerSize);
    const endX = width - Math.floor(cornerSize);
    const checkWidth = endX - startX;
    if (checkWidth <= 0) return false;

    for (let x = startX; x < endX; x++) {
      const idx = (y * width + x) * 4;
      if (isWhitePixel(data[idx], data[idx + 1], data[idx + 2])) {
        whiteCount++;
      }
    }
    return whiteCount / checkWidth > borderRatio;
  };

  // 检测一列是否为白色边框列（只检测中间部分，避开圆角）
  const isColWhite = (x: number): boolean => {
    let whiteCount = 0;
    const startY = Math.floor(cornerSize);
    const endY = height - Math.floor(cornerSize);
    const checkHeight = endY - startY;
    if (checkHeight <= 0) return false;

    for (let y = startY; y < endY; y++) {
      const idx = (y * width + x) * 4;
      if (isWhitePixel(data[idx], data[idx + 1], data[idx + 2])) {
        whiteCount++;
      }
    }
    return whiteCount / checkHeight > borderRatio;
  };

  // 从顶部向下扫描
  let top = 0;
  while (top < maxTrimTop && top < height - 1 && isRowWhite(top)) {
    top++;
  }

  // 从底部向上扫描
  let bottom = height - 1;
  while (
    height - 1 - bottom < maxTrimBottom &&
    bottom > top &&
    isRowWhite(bottom)
  ) {
    bottom--;
  }

  // 从左边向右扫描
  let left = 0;
  while (left < maxTrimLeft && left < width - 1 && isColWhite(left)) {
    left++;
  }

  // 从右边向左扫描
  let right = width - 1;
  while (
    width - 1 - right < maxTrimRight &&
    right > left &&
    isColWhite(right)
  ) {
    right--;
  }

  return { top, right, bottom, left };
}

/**
 * 裁剪透明边框（用于合并图片还原）
 * 检测并去除图片四周的透明区域
 *
 * @param imageData - 图片像素数据
 * @param strict - 严格模式：true = 只裁剪完全透明（alpha=0）的边缘，false = 裁剪半透明（alpha<50）的边缘
 */
function trimTransparentBorders(
  imageData: ImageData,
  strict = true
): { top: number; right: number; bottom: number; left: number } {
  const { width, height, data } = imageData;

  // 严格模式：只有 alpha = 0 才认为是透明
  // 非严格模式：alpha < 50 认为是透明
  const alphaThreshold = strict ? 0 : 50;

  // 检测一行是否完全透明
  const isRowTransparent = (y: number): boolean => {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (alpha > alphaThreshold) {
        return false;
      }
    }
    return true;
  };

  // 检测一列是否完全透明
  const isColTransparent = (x: number): boolean => {
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (alpha > alphaThreshold) {
        return false;
      }
    }
    return true;
  };

  // 从顶部向下扫描
  let top = 0;
  while (top < height && isRowTransparent(top)) {
    top++;
  }

  // 从底部向上扫描
  let bottom = height - 1;
  while (bottom > top && isRowTransparent(bottom)) {
    bottom--;
  }

  // 从左边向右扫描
  let left = 0;
  while (left < width && isColTransparent(left)) {
    left++;
  }

  // 从右边向左扫描
  let right = width - 1;
  while (right > left && isColTransparent(right)) {
    right--;
  }

  return { top, right, bottom, left };
}

/**
 * 去除图片四周白边
 * 作为所有拆图操作的前置步骤
 * 注意：只去除白色边框，不去除黑色内容
 *
 * @param imageUrl - 图片 URL
 * @returns 去除白边后的图片 data URL 和边框信息
 */
async function trimImageWhiteBorders(imageUrl: string): Promise<{
  trimmedImageUrl: string;
  borderInfo: {
    original: { width: number; height: number };
    trimmed: { width: number; height: number };
    borders: { left: number; top: number; right: number; bottom: number };
    hasBorders: boolean;
  };
}> {
  const img = await loadImage(imageUrl);
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  // 创建 Canvas 获取图片数据
  const canvas = document.createElement('canvas');
  canvas.width = originalWidth;
  canvas.height = originalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      trimmedImageUrl: imageUrl,
      borderInfo: {
        original: { width: originalWidth, height: originalHeight },
        trimmed: { width: originalWidth, height: originalHeight },
        borders: { left: 0, top: 0, right: 0, bottom: 0 },
        hasBorders: false,
      },
    };
  }

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, originalWidth, originalHeight);

  // 只检测白色边框（不检测黑色），使用较高阈值
  const borders = trimWhiteBordersOnly(imageData, 0.8, 0.1);
  const trimmedWidth = borders.right - borders.left + 1;
  const trimmedHeight = borders.bottom - borders.top + 1;

  const borderLeft = borders.left;
  const borderTop = borders.top;
  const borderRight = originalWidth - borders.right - 1;
  const borderBottom = originalHeight - borders.bottom - 1;

  // 计算有白边的边数（至少 5 像素才算有白边）
  const MIN_BORDER_WIDTH = 5;
  let borderCount = 0;
  if (borderLeft > MIN_BORDER_WIDTH) borderCount++;
  if (borderTop > MIN_BORDER_WIDTH) borderCount++;
  if (borderRight > MIN_BORDER_WIDTH) borderCount++;
  if (borderBottom > MIN_BORDER_WIDTH) borderCount++;

  // 保护逻辑：至少 2 条边有白边才执行裁剪
  // 避免只有单边误判（如浅色头发被误判为白边）导致内容被切掉
  const hasBorders = borderCount >= 2;

  // console.log('[trimImageWhiteBorders] Border detection:', {
  //   borderLeft, borderTop, borderRight, borderBottom,
  //   borderCount,
  //   hasBorders,
  // });

  if (!hasBorders) {
    // 没有明显白边，返回原图
    return {
      trimmedImageUrl: imageUrl,
      borderInfo: {
        original: { width: originalWidth, height: originalHeight },
        trimmed: { width: originalWidth, height: originalHeight },
        borders: { left: 0, top: 0, right: 0, bottom: 0 },
        hasBorders: false,
      },
    };
  }

  // 创建裁剪后的 Canvas
  const trimmedCanvas = document.createElement('canvas');
  trimmedCanvas.width = trimmedWidth;
  trimmedCanvas.height = trimmedHeight;
  const trimmedCtx = trimmedCanvas.getContext('2d');
  if (!trimmedCtx) {
    return {
      trimmedImageUrl: imageUrl,
      borderInfo: {
        original: { width: originalWidth, height: originalHeight },
        trimmed: { width: originalWidth, height: originalHeight },
        borders: { left: 0, top: 0, right: 0, bottom: 0 },
        hasBorders: false,
      },
    };
  }

  trimmedCtx.drawImage(
    canvas,
    borders.left,
    borders.top,
    trimmedWidth,
    trimmedHeight,
    0,
    0,
    trimmedWidth,
    trimmedHeight
  );

  return {
    trimmedImageUrl: trimmedCanvas.toDataURL('image/jpeg', 0.95),
    borderInfo: {
      original: { width: originalWidth, height: originalHeight },
      trimmed: { width: trimmedWidth, height: trimmedHeight },
      borders: {
        left: borderLeft,
        top: borderTop,
        right: borderRight,
        bottom: borderBottom,
      },
      hasBorders: true,
    },
  };
}

/**
 * 源图片的位置信息
 */
export interface SourceImageRect {
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

/**
 * 递归拆分单个图片元素
 * 如果元素内还能检测到分割线，继续拆分
 */
/** 递归拆分的最小尺寸限制 */
const MIN_SPLIT_SIZE = 100;

export async function recursiveSplitElement(
  element: SplitImageElement,
  depth = 0,
  maxDepth = 2,
  options?: { skipTrim?: boolean }
): Promise<SplitImageElement[]> {
  // 防止无限递归
  if (depth >= maxDepth) {
    return [element];
  }

  // 尺寸太小，不再拆分
  if (element.width < MIN_SPLIT_SIZE || element.height < MIN_SPLIT_SIZE) {
    return [element];
  }

  // 根据 skipTrim 决定是否去白边
  // - 原图（depth=0 且未指定 skipTrim）：需要去白边
  // - 宫格子图（skipTrim=true）：不需要去白边，避免裁掉人物内容
  const skipTrim = options?.skipTrim ?? false;
  let workingImageUrl = element.imageData;
  let workingWidth = element.width;
  let workingHeight = element.height;
  let hasTrimmed = false;
  let trimOffsetX = 0; // 去白边后的左边偏移
  let trimOffsetY = 0; // 去白边后的上边偏移

  if (!skipTrim) {
    // 前置步骤：先去除白边
    const { trimmedImageUrl, borderInfo } = await trimImageWhiteBorders(
      element.imageData
    );
    workingImageUrl = trimmedImageUrl;
    workingWidth = borderInfo.trimmed.width;
    workingHeight = borderInfo.trimmed.height;
    hasTrimmed = borderInfo.hasBorders;
    trimOffsetX = borderInfo.borders.left;
    trimOffsetY = borderInfo.borders.top;

    // 去白边后尺寸太小，不再拆分
    if (workingWidth < MIN_SPLIT_SIZE || workingHeight < MIN_SPLIT_SIZE) {
      if (hasTrimmed) {
        return [
          {
            ...element,
            imageData: workingImageUrl,
            width: workingWidth,
            height: workingHeight,
            // 调整位置：加上去白边的偏移
            sourceX: element.sourceX + trimOffsetX,
            sourceY: element.sourceY + trimOffsetY,
          },
        ];
      }
      return [element];
    }
  }

  // 使用工作图片检测分割线
  // 如果元素有透明度标记，强制使用透明分割线检测
  const detection = await detectGridLines(
    workingImageUrl,
    element.hasTransparency
  );

  // 如果没有检测到分割线，返回当前元素（使用去白边后的图片）
  if (detection.rows <= 1 && detection.cols <= 1) {
    if (hasTrimmed) {
      return [
        {
          ...element,
          imageData: workingImageUrl,
          width: workingWidth,
          height: workingHeight,
          // 调整位置：加上去白边的偏移
          sourceX: element.sourceX + trimOffsetX,
          sourceY: element.sourceY + trimOffsetY,
        },
      ];
    }
    return [element];
  }

  // 检测到标准宫格，直接拆分不再递归
  const isStandardGrid = detection.rows > 1 && detection.cols > 1;
  // 传递透明度标记给 splitImageByLines，使用配置的 trimMode
  const subElements = await splitImageByLines(
    workingImageUrl,
    detection,
    element.hasTransparency,
    { trimMode: isStandardGrid ? 'strict' : 'normal' }
  );

  // 如果拆分结果和原来一样（只有 1 个），返回当前元素
  if (subElements.length <= 1) {
    if (hasTrimmed) {
      return [
        {
          ...element,
          imageData: workingImageUrl,
          width: workingWidth,
          height: workingHeight,
        },
      ];
    }
    return [element];
  }

  // 计算子元素位置时需要累积父元素的位置
  // 子元素的 sourceX/sourceY 是相对于 workingImageUrl（去白边后的图片）的
  // 需要加上：1) 父元素在原图中的位置 2) 去白边的偏移
  const parentOffsetX = element.sourceX + trimOffsetX;
  const parentOffsetY = element.sourceY + trimOffsetY;

  // 将子元素的位置转换为相对于原始图片的绝对位置
  const adjustedSubElements = subElements.map((subEl) => ({
    ...subEl,
    sourceX: subEl.sourceX + parentOffsetX,
    sourceY: subEl.sourceY + parentOffsetY,
  }));

  // 标准宫格：直接返回拆分结果，不再递归
  // 子图不需要再去白边，避免裁掉人物内容
  if (isStandardGrid) {
    return adjustedSubElements;
  }

  // 非标准布局：继续递归处理每个子元素
  // 非标准布局的子元素仍然需要去白边（可能包含嵌套的白边图片）
  const allResults: SplitImageElement[] = [];
  for (const subEl of adjustedSubElements) {
    // 子元素太小，直接添加
    if (subEl.width < MIN_SPLIT_SIZE || subEl.height < MIN_SPLIT_SIZE) {
      allResults.push(subEl);
      continue;
    }
    const recursiveResults = await recursiveSplitElement(
      subEl,
      depth + 1,
      maxDepth,
      options
    );
    allResults.push(...recursiveResults);
  }

  return allResults;
}

/**
 * 获取画布最底部元素下方的插入位置
 * 用于在没有指定 startPoint 和 sourceRect 时计算默认插入位置
 */
function getBottommostInsertionPoint(board: PlaitBoard): {
  x: number;
  y: number;
} {
  if (!board.children || board.children.length === 0) {
    return { x: 100, y: 100 };
  }

  try {
    let bottommostElement: PlaitElement | null = null;
    let maxBottomY = -Infinity;

    for (const element of board.children) {
      try {
        const rect = getRectangleByElements(
          board,
          [element as PlaitElement],
          false
        );
        const bottomY = rect.y + rect.height;

        if (bottomY > maxBottomY) {
          maxBottomY = bottomY;
          bottommostElement = element as PlaitElement;
        }
      } catch {
        // 忽略无法计算矩形的元素
      }
    }

    if (!bottommostElement) {
      return { x: 100, y: 100 };
    }

    const bottommostRect = getRectangleByElements(
      board,
      [bottommostElement],
      false
    );
    // 在最底部元素的左侧开始，下方 50px
    return {
      x: bottommostRect.x,
      y: bottommostRect.y + bottommostRect.height + 50,
    };
  } catch {
    return { x: 100, y: 100 };
  }
}

/**
 * 拆分并插入选项
 */
export interface SplitAndInsertOptions {
  /** 源图片的位置信息（用于计算插入位置和缩放） */
  sourceRect?: SourceImageRect;
  /** 自定义起始插入位置（优先于 sourceRect） */
  startPoint?: Point;
  /** 是否滚动到插入位置（默认 true） */
  scrollToResult?: boolean;
}

/**
 * 智能拆分图片并插入到画板
 * 支持两种格式：
 * 1. 网格分割线格式（白色分割线）- 支持递归拆分
 * 2. 灵感图格式（灰色背景 + 白边框图片）- 支持递归拆分
 *
 * @param board - 画板实例
 * @param imageUrl - 图片 URL
 * @param options - 拆分和插入选项
 */
export async function splitAndInsertImages(
  board: PlaitBoard,
  imageUrl: string,
  options?: SplitAndInsertOptions
): Promise<{ success: boolean; count: number; error?: string }> {
  const endTrack = trackMemory('图片分割');
  const { sourceRect, startPoint, scrollToResult = true } = options || {};
  try {
    let elements: SplitImageElement[] = [];
    // 标记是否为标准宫格（用于决定是否跳过子图去白边）
    let isStandardGrid = false;

    // 策略：无论什么格式，都先去除外围白边
    // 外围白边会干扰网格检测，必须先清理
    // 注意：这里去除的是整张图片的外围白边，不是内部分割线
    const { trimmedImageUrl, borderInfo } = await trimImageWhiteBorders(
      imageUrl
    );
    // 用于计算缩放的图片尺寸
    const workingImageWidth = borderInfo.trimmed.width;
    const workingImageHeight = borderInfo.trimmed.height;

    // console.log('[splitAndInsertImages] Trimmed outer border:', {
    //   original: borderInfo.original,
    //   trimmed: borderInfo.trimmed,
    //   hasBorders: borderInfo.hasBorders,
    // });

    // 使用去除外围白边后的图片检测网格
    // 使用 detectGridLinesInternal 以获取透明度信息
    const { detection, hasTransparency } = await detectGridLinesInternal(
      trimmedImageUrl
    );

    if (detection.rows > 1 || detection.cols > 1) {
      // 判断是否为标准宫格（行列数都大于1，说明是规则宫格）
      isStandardGrid = detection.rows > 1 && detection.cols > 1;

      // 网格分割线格式 - 使用去除外围白边后的图片
      // 传递透明度标记给 splitImageByLines
      // 对于标准宫格使用严格模式，灵感图使用普通模式
      const initialElements = await splitImageByLines(
        trimmedImageUrl,
        detection,
        hasTransparency,
        { trimMode: isStandardGrid ? 'strict' : 'normal' }
      );

      // 对于透明背景的合并图片，禁用递归拆分
      // 因为文字行之间的透明间隙会导致文字被切成碎片
      if (hasTransparency) {
        // console.log('[splitAndInsertImages] Transparent image detected, disabling recursive split');
        elements = initialElements;
      } else if (isStandardGrid) {
        // 标准宫格：直接使用拆分结果，不需要递归
        // 子图不再额外去白边，避免裁掉白色背景人物图的边缘
        elements = initialElements;
      } else {
        // 非标准宫格（可能是灵感图或不规则布局）：递归拆分，但限制总数
        const MAX_TOTAL_ELEMENTS = 25;
        const MIN_ELEMENT_SIZE = 100; // 最小 100x100 像素

        for (const el of initialElements) {
          // 检查是否已达到最大数量
          if (elements.length >= MAX_TOTAL_ELEMENTS) {
            break;
          }

          // 检查元素是否太小，不需要继续拆分
          if (el.width < MIN_ELEMENT_SIZE || el.height < MIN_ELEMENT_SIZE) {
            elements.push(el);
            continue;
          }

          // 递归拆分时禁用去白边（skipTrim: true），因为 splitImageByLines 已经精确切割了
          const recursiveResults = await recursiveSplitElement(el, 0, 2, {
            skipTrim: true,
          });
          // 限制添加的数量
          const remainingSlots = MAX_TOTAL_ELEMENTS - elements.length;
          elements.push(...recursiveResults.slice(0, remainingSlots));
        }
      }
    } else {
      // 尝试灵感图格式（已内置递归拆分）- 使用去除白边后的图片
      const isPhotoWall = await detectPhotoWallFormat(trimmedImageUrl);

      if (isPhotoWall) {
        const { splitPhotoWall } = await import('./photo-wall-splitter');
        const inspirationBoardElements = await splitPhotoWall(trimmedImageUrl);

        // 转换为 SplitImageElement 格式，保留原图位置信息
        elements = inspirationBoardElements.map((el, index) => ({
          imageData: el.imageData,
          index,
          width: el.width,
          height: el.height,
          sourceX: el.sourceX ?? 0,
          sourceY: el.sourceY ?? 0,
        }));
      }
    }

    if (elements.length === 0) {
      return {
        success: false,
        count: 0,
        error: '未检测到可拆分的区域，请确保图片包含分割线或灵感图格式',
      };
    }

    // 2.5 注意：不再对非标准宫格的子图进行额外去白边处理
    // 原因：递归拆分（recursiveSplitElement）已经做了去白边处理，再做一次会切掉内容
    // 标准宫格使用精确等分，也不需要去白边

    // 重新分配 index
    elements = elements.map((el, idx) => ({ ...el, index: idx }));

    // 3. 使用工作图片尺寸计算缩放比例
    // 注意：标准宫格使用原图尺寸，其他格式使用去白边后的尺寸
    // 计算缩放比例（原图显示尺寸 / 工作图片像素尺寸）
    let scale = 1;
    if (sourceRect) {
      scale = Math.min(
        sourceRect.width / workingImageWidth,
        sourceRect.height / workingImageHeight
      );
    }

    // 4. 计算插入位置
    // 优先使用 startPoint，其次使用 sourceRect，最后在画布最底部元素下方
    let baseX: number;
    let baseY: number;

    if (startPoint) {
      // 使用自定义起始位置
      baseX = startPoint[0];
      baseY = startPoint[1];
      // console.log('[splitAndInsertImages] Using startPoint:', { baseX, baseY });
    } else if (sourceRect) {
      // 在源图片下方 20px，保持左对齐
      baseX = sourceRect.x;
      baseY = sourceRect.y + sourceRect.height + 20;
      // console.log('[splitAndInsertImages] Using sourceRect (below original):', { sourceRect, baseX, baseY });
    } else {
      // 查找画布最底部元素，在其下方插入
      const bottomPosition = getBottommostInsertionPoint(board);
      baseX = bottomPosition.x;
      baseY = bottomPosition.y;
      // console.log('[splitAndInsertImages] Using bottommost position:', { baseX, baseY });
    }

    // 5. 根据子图片在原图中的相对位置插入
    // 如果所有子图片都没有有效位置信息（sourceX 和 sourceY 都为 0），则使用网格布局
    const hasValidPositions = elements.some(
      (el) => el.sourceX > 0 || el.sourceY > 0
    );

    if (hasValidPositions && !sourceRect) {
      // 计算所有子图的边界框
      let maxRight = 0;
      let maxBottom = 0;
      for (const el of elements) {
        const right = el.sourceX + el.width;
        const bottom = el.sourceY + el.height;
        if (right > maxRight) maxRight = right;
        if (bottom > maxBottom) maxBottom = bottom;
      }

      // 目标显示尺寸（灵感图的理想宽度）
      const targetWidth = 800;
      const targetHeight = 600;

      // 计算缩放比例，保持宽高比
      if (maxRight > 0 && maxBottom > 0) {
        scale = Math.min(
          targetWidth / maxRight,
          targetHeight / maxBottom,
          1 // 不放大，只缩小
        );
      }
    }

    let firstInsertPoint: Point | undefined;
    let firstElementSize: { width: number; height: number } | undefined;

    // 动态导入 unifiedCacheService
    const { unifiedCacheService } = await import(
      '../services/unified-cache-service'
    );

    // 如果没有有效位置信息，计算网格布局
    const gridLayout: {
      x: number;
      y: number;
      width: number;
      height: number;
    }[] = [];
    if (!hasValidPositions && elements.length > 1) {
      // 计算网格布局：根据图片数量自动确定行列数
      const count = elements.length;
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);

      // 计算每个图片的目标尺寸（取最大尺寸的平均值）
      const avgWidth =
        elements.reduce((sum, el) => sum + el.width, 0) / elements.length;
      const avgHeight =
        elements.reduce((sum, el) => sum + el.height, 0) / elements.length;

      // 缩放到合适的显示尺寸（最大 400px）
      const maxDisplaySize = 400;
      const targetScale = Math.min(
        maxDisplaySize / Math.max(avgWidth, avgHeight),
        1
      );
      const cellWidth = avgWidth * targetScale;
      const cellHeight = avgHeight * targetScale;
      const gap = 20; // 图片间距

      for (let i = 0; i < elements.length; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;

        // 计算单个图片的缩放比例，使其适应 cell 尺寸
        const element = elements[i];
        const elementScale = Math.min(
          cellWidth / element.width,
          cellHeight / element.height,
          1 // 不放大，只缩小
        );

        gridLayout.push({
          x: baseX + col * (cellWidth + gap),
          y: baseY + row * (cellHeight + gap),
          width: element.width * elementScale,
          height: element.height * elementScale,
        });
      }

      // console.log('[splitAndInsertImages] Grid layout:', { cols, rows, cellWidth, cellHeight, gap });
    }

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];

      let insertX: number;
      let insertY: number;
      let scaledWidth: number;
      let scaledHeight: number;

      if (hasValidPositions) {
        // 有位置信息：使用相对位置布局（宫格图等）
        const relativeX = element.sourceX * scale;
        const relativeY = element.sourceY * scale;
        insertX = baseX + relativeX;
        insertY = baseY + relativeY;
        scaledWidth = element.width * scale;
        scaledHeight = element.height * scale;
      } else if (gridLayout.length > 0) {
        // 无位置信息：使用网格布局（灵感图等）
        const layout = gridLayout[i];
        insertX = layout?.x ?? baseX;
        insertY = layout?.y ?? baseY;
        scaledWidth = layout?.width ?? element.width * scale;
        scaledHeight = layout?.height ?? element.height * scale;
      } else {
        // 单个图片，直接在基准位置插入
        insertX = baseX;
        insertY = baseY;
        scaledWidth = element.width * scale;
        scaledHeight = element.height * scale;
      }

      // 记录第一个插入点用于滚动
      if (!firstInsertPoint) {
        firstInsertPoint = [insertX, insertY] as Point;
        firstElementSize = { width: scaledWidth, height: scaledHeight };
      }

      // 将 base64 DataURL 转换为 Blob 并缓存到 __aitu_cache__
      const imageFormat = element.hasTransparency ? 'png' : 'jpg';
      const taskId = `split-image-${Date.now()}-${i}`;
      const stableUrl = `/__aitu_cache__/image/${taskId}.${imageFormat}`;

      // 将 DataURL 转换为 Blob
      const response = await fetch(element.imageData);
      const blob = await response.blob();

      // 仅缓存到 Cache Storage（不存 IndexedDB 元数据，分割图片不需要在素材库显示）
      await unifiedCacheService.cacheToCacheStorageOnly(stableUrl, blob);

      const imageItem = {
        url: stableUrl,
        width: scaledWidth,
        height: scaledHeight,
      };

      DrawTransforms.insertImage(board, imageItem, [insertX, insertY] as Point);
    }

    // 插入完成后滚动到第一个元素的位置
    if (scrollToResult && firstInsertPoint && firstElementSize) {
      const centerPoint: Point = [
        firstInsertPoint[0] + firstElementSize.width / 2,
        firstInsertPoint[1] + firstElementSize.height / 2,
      ];
      requestAnimationFrame(() => {
        scrollToPointIfNeeded(board, centerPoint);
      });
    }

    endTrack();
    return {
      success: true,
      count: elements.length,
    };
  } catch (error: any) {
    endTrack();
    return {
      success: false,
      count: 0,
      error: error.message || '拆分图片失败',
    };
  }
}

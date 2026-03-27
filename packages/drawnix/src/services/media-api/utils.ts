/**
 * Media API 工具函数
 *
 * 通用的 API 请求辅助函数，SW 和主线程共用
 */

import type { ApiConfig } from './types';
import type { ResolvedProviderContext } from '../provider-routing/types';

/**
 * 异步图片模型 ID 列表
 */
const ASYNC_IMAGE_MODELS = [
  'gemini-3-pro-image-preview-async',
  'gemini-3-pro-image-preview-2k-async',
  'gemini-3-pro-image-preview-4k-async',
];

/**
 * 检测是否为异步图片模型
 */
export function isAsyncImageModel(model?: string): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return ASYNC_IMAGE_MODELS.some((m) => lower.includes(m));
}

/**
 * 规范化 API base URL，移除尾部 / 或 /v1
 * 便于统一拼接 /v1/videos 等路径
 */
export function normalizeApiBase(url: string): string {
  let base = url.replace(/\/+$/, '');
  if (base.endsWith('/v1')) {
    base = base.slice(0, -3);
  }
  return base;
}

function inferProviderType(baseUrl: string, explicitProviderType?: string): string {
  if (explicitProviderType) {
    return explicitProviderType;
  }

  const normalized = baseUrl.trim().toLowerCase();
  if (
    normalized.includes('generativelanguage.googleapis.com') ||
    normalized.includes('vertex.googleapis.com')
  ) {
    return 'gemini-compatible';
  }
  if (
    normalized.includes('/openai') ||
    normalized.endsWith('/v1') ||
    normalized.includes('api.openai.com') ||
    normalized.includes('api.tu-zi.com')
  ) {
    return 'openai-compatible';
  }
  return 'custom';
}

function inferAuthType(config: ApiConfig, providerType: string): ResolvedProviderContext['authType'] {
  if (
    config.authType === 'bearer' ||
    config.authType === 'header' ||
    config.authType === 'query' ||
    config.authType === 'custom'
  ) {
    return config.authType;
  }

  return 'bearer';
}

export function buildProviderContextFromApiConfig(
  config: ApiConfig,
  baseUrlOverride?: string
): ResolvedProviderContext {
  if (config.provider) {
    return {
      ...config.provider,
      baseUrl: baseUrlOverride || config.provider.baseUrl,
    };
  }

  const baseUrl = baseUrlOverride || config.baseUrl;
  const providerType = inferProviderType(baseUrl, config.providerType);

  return {
    profileId: 'runtime',
    profileName: 'Runtime',
    providerType,
    baseUrl,
    apiKey: config.apiKey,
    authType: inferAuthType(config, providerType),
    extraHeaders: config.extraHeaders,
  };
}

/**
 * 从 URL 中提取文件扩展名
 */
export function getExtensionFromUrl(url: string): string {
  try {
    const clean = url.split('?')[0];
    const last = clean.split('.').pop();
    if (last && last.length <= 5) {
      return last.toLowerCase();
    }
  } catch {
    // ignore
  }
  return 'jpg';
}

/**
 * 将尺寸字符串转换为宽高比
 * 例如：'1024x1024' -> '1:1', '1920x1080' -> '16:9'
 */
export function sizeToAspectRatio(size?: string): string | undefined {
  if (!size || !size.includes('x')) return undefined;
  const [wStr, hStr] = size.split('x');
  const w = Number(wStr);
  const h = Number(hStr);
  if (!w || !h) return undefined;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

/**
 * 宽高比到像素尺寸的映射表
 */
const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  '1x1': '1024x1024',
  '1x4': '512x2048',
  '4x1': '2048x512',
  '1x8': '256x2048',
  '8x1': '2048x256',
  '16x9': '1792x1024',
  '9x16': '1024x1792',
  '4x3': '1536x1152',
  '3x4': '1152x1536',
  '3x2': '1536x1024',
  '2x3': '1024x1536',
  '4x5': '1024x1280',
  '5x4': '1280x1024',
  '21x9': '1792x768',
};

/**
 * 将宽高比转换为像素尺寸
 * @param aspectRatio 宽高比字符串，如 '1:1', '16:9', '1x1'
 * @returns 像素尺寸字符串，如 '1024x1024'
 */
export function aspectRatioToSize(aspectRatio?: string): string | undefined {
  if (!aspectRatio || aspectRatio === 'auto') {
    return undefined;
  }

  // 支持冒号和 x 两种格式
  const ratioMap: Record<string, string> = {
    '1:1': '1x1',
    '1:4': '1x4',
    '4:1': '4x1',
    '1:8': '1x8',
    '8:1': '8x1',
    '2:3': '2x3',
    '3:2': '3x2',
    '3:4': '3x4',
    '4:3': '4x3',
    '4:5': '4x5',
    '5:4': '5x4',
    '9:16': '9x16',
    '16:9': '16x9',
    '21:9': '21x9',
  };

  const normalized = ratioMap[aspectRatio] || aspectRatio;
  return ASPECT_RATIO_TO_SIZE[normalized] || aspectRatio;
}

/**
 * 从消息数组中提取 prompt 用于日志记录
 */
export function extractPromptFromMessages(
  messages: Array<{ role: string; content: unknown }>
): string {
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        return msg.content.substring(0, 500);
      }
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            return part.text.substring(0, 500);
          }
        }
      }
    }
  }
  return '';
}

/**
 * 解析尺寸字符串
 * @param sizeStr 尺寸字符串，格式为 'WIDTHxHEIGHT'，如 '1280x720'
 * @returns 解析后的宽高对象，如果格式无效返回 null
 */
export function parseSize(sizeStr: string): { width: number; height: number } | null {
  if (!sizeStr) return null;
  const match = sizeStr.match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return {
    width: parseInt(match[1], 10),
    height: parseInt(match[2], 10),
  };
}

/**
 * 解析错误消息
 */
export function parseErrorMessage(error: unknown): string {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.error === 'string') return e.error;
    if (e.error && typeof e.error === 'object') {
      const inner = e.error as Record<string, unknown>;
      if (typeof inner.message === 'string') return inner.message;
    }
  }
  return String(error);
}

/**
 * 等待指定时间，支持取消
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const id = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(id);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    }
  });
}

/**
 * 图片生成支持的宽高比列表（NxM 格式）
 */
const VALID_IMAGE_SIZES = ['auto', '1x1', '1x4', '4x1', '1x8', '8x1', '16x9', '9x16', '3x2', '2x3', '4x3', '3x4', '5x4', '4x5', '21x9'];

/**
 * 将宽高比字符串解析为数值比例
 * 支持格式：'16:9', '16x9', '2.35:1', '1920x1080'（像素尺寸）
 * @returns 宽高比数值（w/h），解析失败返回 null
 */
function parseAspectRatioValue(size: string): number | null {
  if (!size || size === 'auto') return null;

  // 统一分隔符：支持 ':', 'x', '*'
  const normalized = size.trim().toLowerCase();

  // 尝试匹配 '数字:数字' 或 '数字x数字' 格式（支持小数如 2.35:1）
  const match = normalized.match(/^([\d.]+)\s*[:x*]\s*([\d.]+)$/);
  if (!match) return null;

  const w = parseFloat(match[1]);
  const h = parseFloat(match[2]);
  if (!w || !h || isNaN(w) || isNaN(h)) return null;

  return w / h;
}

/**
 * 计算标准 size token 的宽高比数值
 */
function sizeTokenToRatio(sizeToken: string): number | null {
  if (sizeToken === 'auto') return null;
  return parseAspectRatioValue(sizeToken);
}

/**
 * 将任意 size 字符串规范化为最接近的可用图片尺寸
 *
 * 处理逻辑：
 * 1. 如果 size 已在可用列表中（精确匹配），直接返回
 * 2. 将 ':' 转为 'x' 后再次精确匹配
 * 3. 解析为宽高比数值，找到数值最接近的可用 size
 * 4. 都无法处理时返回默认值 'auto'
 *
 * @param size 原始 size 字符串，如 '2.35:1', '16:9', '1920x1080'
 * @param defaultSize 默认尺寸，当无法匹配时返回
 * @returns 最接近的可用图片 size
 */
export function normalizeToClosestImageSize(size?: string, defaultSize: string = 'auto'): string {
  if (!size) return defaultSize;

  const trimmed = size.trim();
  if (!trimmed) return defaultSize;

  // 1. 精确匹配（不区分大小写）
  const lower = trimmed.toLowerCase();
  if (VALID_IMAGE_SIZES.includes(lower)) return lower;

  // 2. ':' → 'x' 后再精确匹配
  const colonToX = lower.replace(':', 'x');
  if (VALID_IMAGE_SIZES.includes(colonToX)) return colonToX;

  // 3. 解析为宽高比数值，找最接近的
  const targetRatio = parseAspectRatioValue(trimmed);
  if (targetRatio === null) return defaultSize;

  let bestMatch = defaultSize;
  let bestDiff = Infinity;

  for (const candidate of VALID_IMAGE_SIZES) {
    if (candidate === 'auto') continue;
    const candidateRatio = sizeTokenToRatio(candidate);
    if (candidateRatio === null) continue;
    const diff = Math.abs(targetRatio - candidateRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestMatch = candidate;
    }
  }

  if (bestMatch !== defaultSize) {
    console.log(`[normalizeToClosestImageSize] "${trimmed}" → "${bestMatch}" (ratio: ${targetRatio.toFixed(3)} → ${sizeTokenToRatio(bestMatch)?.toFixed(3)})`);
  }

  return bestMatch;
}

/**
 * 将任意 size 字符串规范化为最接近的可用视频尺寸
 *
 * 视频尺寸格式是像素值（如 '1280x720'）或分辨率标签（如 '720p'）
 *
 * @param size 原始 size 字符串
 * @param validSizes 当前模型支持的 size 列表
 * @param defaultSize 默认尺寸
 * @returns 最接近的可用视频 size
 */
export function normalizeToClosestVideoSize(
  size?: string,
  validSizes?: string[],
  defaultSize: string = '1280x720'
): string {
  if (!size) return defaultSize;
  if (!validSizes || validSizes.length === 0) return defaultSize;

  const trimmed = size.trim();
  if (!trimmed) return defaultSize;

  // 1. 精确匹配
  if (validSizes.includes(trimmed)) return trimmed;

  // 2. ':' → 'x' 后精确匹配
  const colonToX = trimmed.replace(':', 'x');
  if (validSizes.includes(colonToX)) return colonToX;

  // 3. 解析 size 的宽高比数值，在 validSizes 中找最接近的
  const targetRatio = parseAspectRatioValue(trimmed);
  if (targetRatio === null) return defaultSize;

  let bestMatch = defaultSize;
  let bestDiff = Infinity;

  for (const candidate of validSizes) {
    const candidateRatio = parseAspectRatioValue(candidate);
    if (candidateRatio === null) continue;
    const diff = Math.abs(targetRatio - candidateRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestMatch = candidate;
    }
  }

  if (bestMatch !== defaultSize || bestDiff < Infinity) {
    console.log(`[normalizeToClosestVideoSize] "${trimmed}" → "${bestMatch}" (ratio: ${targetRatio.toFixed(3)})`);
  }

  return bestMatch;
}

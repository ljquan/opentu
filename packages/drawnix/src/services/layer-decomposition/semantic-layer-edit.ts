import type { PlaitBoard, PlaitElement } from '@plait/core';
import { loadImageElementForCanvas } from '../../data/image';
import { cacheRemoteUrl } from '../media-executor/fallback-utils';
import { unifiedCacheService } from '../unified-cache-service';
import { createLayerDecompositionApiClient } from './api';
import { getSemanticLayerMetadata, type SemanticLayerMetadata } from './canvas';
import {
  createConfiguredProviderCandidatePrompt,
  decomposeWithConfiguredImageProvider,
  SEEDREAM_LAYER_MODEL_ID,
} from './provider';
import type { LayerArtifact, LayerDecompositionResponse } from './types';

const LOCAL_IMAGE_CACHE_PREFIX = '/__aitu_cache__/image/';
const MAX_EDIT_MASK_PIXELS = 20_000_000;

export interface SemanticForegroundEditContext {
  foregroundElementId: string;
  foregroundUrl: string;
  backgroundElementId: string;
  backgroundUrl: string;
  originalCompositeUrl?: string;
  semanticLayer: SemanticLayerMetadata;
}

export interface SemanticForegroundReplacementResult {
  url: string;
  layer: LayerArtifact;
  width: number;
  height: number;
}

function isSemanticLayerGroup(element: PlaitElement): boolean {
  return Boolean(
    element.type === 'group' &&
      element.metadata?.semanticLayerGroup?.providerGroupId
  );
}

function normalizeSemanticSearchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\s"'“”‘’`]+/g, '')
    .trim();
}

function findPromptMatchedForeground(
  foregrounds: PlaitElement[],
  editPrompt?: string
): PlaitElement | null {
  const prompt = normalizeSemanticSearchText(editPrompt || '');
  if (!prompt) return null;

  const genericLabels = new Set([
    '背景',
    '主体',
    '对象',
    '图层',
    'background',
    'foreground',
    'object',
    'layer',
  ]);
  const matches = foregrounds.flatMap((element) => {
    const metadata = getSemanticLayerMetadata(element);
    if (!metadata) return [];
    const labels = [metadata.name, metadata.description]
      .map(normalizeSemanticSearchText)
      .filter((label) => label.length > 0 && !genericLabels.has(label));
    const matchedLabel = labels
      .filter((label) => prompt.includes(label))
      .sort((left, right) => right.length - left.length)[0];
    return matchedLabel ? [{ element, score: matchedLabel.length }] : [];
  });
  if (matches.length === 0) return null;
  matches.sort((left, right) => right.score - left.score);
  if (matches.length > 1 && matches[0].score === matches[1].score) {
    return null;
  }
  return matches[0].element;
}

/**
 * A freshly decomposed image selects its group. Proxy that selection only
 * when the group has one unambiguous foreground or the edit prompt names one
 * of the group's foreground subjects.
 */
export function resolveSemanticForegroundTarget(
  board: PlaitBoard,
  selectedElement: PlaitElement,
  editPrompt?: string
): PlaitElement {
  const directMetadata = getSemanticLayerMetadata(selectedElement);
  if (directMetadata?.kind === 'foreground') return selectedElement;
  if (!isSemanticLayerGroup(selectedElement)) return selectedElement;

  const providerGroupId =
    selectedElement.metadata?.semanticLayerGroup?.providerGroupId;
  const foregrounds = board.children.filter((candidate) => {
    const metadata = getSemanticLayerMetadata(candidate);
    return (
      candidate.groupId === selectedElement.id &&
      metadata?.kind === 'foreground' &&
      metadata.providerGroupId === providerGroupId
    );
  });
  if (foregrounds.length === 1) return foregrounds[0];
  return (
    findPromptMatchedForeground(foregrounds, editPrompt) || selectedElement
  );
}

export function getSemanticForegroundEditContext(
  board: PlaitBoard,
  foregroundElement: PlaitElement
): SemanticForegroundEditContext | null {
  const semanticLayer = getSemanticLayerMetadata(foregroundElement);
  const foregroundUrl = foregroundElement.url;
  if (
    semanticLayer?.kind !== 'foreground' ||
    typeof foregroundUrl !== 'string' ||
    !foregroundUrl.trim()
  ) {
    return null;
  }

  const group = board.children.find(
    (candidate) =>
      candidate.type === 'group' &&
      candidate.id === foregroundElement.groupId &&
      candidate.metadata?.semanticLayerGroup?.providerGroupId ===
        semanticLayer.providerGroupId
  );
  if (!group) return null;

  const background = board.children.find((candidate) => {
    const metadata = getSemanticLayerMetadata(candidate);
    return (
      candidate.groupId === group.id &&
      metadata?.kind === 'background' &&
      metadata.providerGroupId === semanticLayer.providerGroupId &&
      typeof candidate.url === 'string' &&
      candidate.url.trim().length > 0
    );
  });
  if (!background?.url) return null;

  return {
    foregroundElementId: foregroundElement.id,
    foregroundUrl: foregroundUrl.trim(),
    backgroundElementId: background.id,
    backgroundUrl: background.url.trim(),
    ...(typeof group.metadata?.semanticLayerGroup?.originalCompositeUrl ===
      'string' && group.metadata.semanticLayerGroup.originalCompositeUrl.trim()
      ? {
          originalCompositeUrl:
            group.metadata.semanticLayerGroup.originalCompositeUrl.trim(),
        }
      : {}),
    semanticLayer,
  };
}

function requireMaskSize(image: HTMLImageElement): {
  width: number;
  height: number;
} {
  const width = Math.floor(image.naturalWidth || image.width);
  const height = Math.floor(image.naturalHeight || image.height);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_EDIT_MASK_PIXELS
  ) {
    throw new Error('语义替换蒙版尺寸无效或超过处理上限');
  }
  return { width, height };
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('语义替换蒙版编码失败')),
      'image/png'
    );
  });
}

function createMaskCacheUrl(context: SemanticForegroundEditContext): string {
  const groupKey = context.semanticLayer.providerGroupId
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  const boxKey = context.semanticLayer.boundingBox.normalized.join('-');
  return `${LOCAL_IMAGE_CACHE_PREFIX}semantic-replace-mask-${
    groupKey || 'group'
  }-${context.semanticLayer.zIndex}-${boxKey}.png`;
}

/** OpenAI-style mask: opaque pixels are preserved, transparent pixels edit. */
export async function createSemanticForegroundEditMask(
  context: SemanticForegroundEditContext
): Promise<string> {
  const maskUrl = createMaskCacheUrl(context);
  const cached =
    await unifiedCacheService.getCachedImageBlobWithThumbnailFallback(maskUrl);
  if (cached?.size) return maskUrl;

  const image = await loadImageElementForCanvas(
    (context.originalCompositeUrl || context.backgroundUrl) as any
  );
  const { width, height } = requireMaskSize(image);
  if (typeof document === 'undefined') {
    throw new Error('当前环境不支持创建语义替换蒙版');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const drawing = canvas.getContext('2d');
    if (!drawing) throw new Error('无法创建语义替换蒙版');
    drawing.fillStyle = '#fff';
    drawing.fillRect(0, 0, width, height);

    const [normalizedX1, normalizedY1, normalizedX2, normalizedY2] =
      context.semanticLayer.boundingBox.normalized;
    const margin = Math.max(
      4,
      Math.min(32, Math.round(Math.min(width, height) * 0.012))
    );
    const left = Math.max(
      0,
      Math.floor((normalizedX1 / 1000) * width) - margin
    );
    const top = Math.max(
      0,
      Math.floor((normalizedY1 / 1000) * height) - margin
    );
    const right = Math.min(
      width,
      Math.ceil((normalizedX2 / 1000) * width) + margin
    );
    const bottom = Math.min(
      height,
      Math.ceil((normalizedY2 / 1000) * height) + margin
    );
    if (right <= left || bottom <= top) {
      throw new Error('旧主体边界无效，无法创建替换蒙版');
    }
    drawing.clearRect(left, top, right - left, bottom - top);

    const blob = await canvasToPngBlob(canvas);
    return await unifiedCacheService.cacheMediaFromBlob(
      maskUrl,
      blob,
      'image',
      {
        metadata: {
          source: 'semantic-foreground-replacement-mask',
          providerGroupId: context.semanticLayer.providerGroupId,
          zIndex: context.semanticLayer.zIndex,
        },
      }
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function buildSemanticReplacementGenerationPrompt(
  editPrompt: string,
  oldSubjectName: string,
  oldSubjectDescription?: string
): string {
  const instruction = editPrompt.trim();
  const oldName = oldSubjectName.trim();
  const oldDescription = oldSubjectDescription?.trim();
  return (
    '基于提供的干净背景，只在透明蒙版区域内完成主体替换。' +
    `${instruction}。` +
    (oldName
      ? `旧主体“${oldName}”${
          oldDescription ? `（${oldDescription}）` : ''
        }已经移除，禁止恢复旧主体、旧主体的尾巴、毛发、肢体、轮廓或任何残留。`
      : '') +
    '只加入新主体，保持蒙版外背景、构图、光照、透视和其他对象不变。'
  );
}

function requireSingleForeground(
  response: LayerDecompositionResponse
): LayerArtifact {
  if (response.resultKind !== 'inference') {
    throw new Error('分层服务未返回真实推理结果，原图层保持不变');
  }
  if (response.decisions?.includes('fallback_full_canvas')) {
    throw new Error('未识别到独立主体，原图层保持不变');
  }
  if (
    response.quality?.passed !== true ||
    response.quality.ssim === undefined ||
    response.quality.ssim < 0.999 ||
    response.quality.channelErrorRate === undefined ||
    response.quality.channelErrorRate > 0.001 + Number.EPSILON * 8
  ) {
    throw new Error('主体抠图质量未达标，原图层保持不变');
  }
  if (
    !Number.isSafeInteger(response.width) ||
    !Number.isSafeInteger(response.height) ||
    Number(response.width) <= 0 ||
    Number(response.height) <= 0
  ) {
    throw new Error('主体抠图缺少有效画布尺寸，原图层保持不变');
  }
  if (response.layers.length !== 1 || response.layers[0].zIndex !== 1) {
    throw new Error('主体抠图未返回唯一前景层，原图层保持不变');
  }

  const layer = response.layers[0];
  const [x1, y1, x2, y2] = layer.boundingBox.absolute;
  if (
    ![x1, y1, x2, y2].every(Number.isSafeInteger) ||
    x1 < 0 ||
    y1 < 0 ||
    x2 <= x1 ||
    y2 <= y1 ||
    x2 > response.width! ||
    y2 > response.height!
  ) {
    throw new Error('主体抠图边界无效，原图层保持不变');
  }
  return layer;
}

function resolveArtifactUrl(url: string): string {
  return url.startsWith('/') && typeof window !== 'undefined'
    ? new URL(url, window.location.origin).toString()
    : url;
}

async function assertCachedTransparentPng(url: string): Promise<void> {
  const blob =
    await unifiedCacheService.getCachedImageBlobWithThumbnailFallback(url);
  if (!blob || blob.size < 26) {
    throw new Error('透明前景未能写入本地缓存，原图层保持不变');
  }
  const header = await readBlobPrefix(blob, 26);
  const isPng =
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a;
  const colorType = header[25];
  if (!isPng || (colorType !== 4 && colorType !== 6)) {
    throw new Error('主体抠图不是带 Alpha 通道的 PNG，原图层保持不变');
  }
}

async function readBlobPrefix(blob: Blob, length: number): Promise<Uint8Array> {
  const slice = blob.slice(0, length);
  if (typeof slice.arrayBuffer === 'function') {
    return new Uint8Array(await slice.arrayBuffer());
  }
  if (typeof FileReader !== 'undefined') {
    return new Uint8Array(
      await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () =>
          reject(reader.error || new Error('读取 PNG 头失败'));
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) resolve(reader.result);
          else reject(new Error('读取 PNG 头失败'));
        };
        reader.readAsArrayBuffer(slice);
      })
    );
  }
  throw new Error('当前环境不支持读取 PNG 数据');
}

export async function prepareSemanticForegroundReplacement(
  generatedImageUrl: string,
  taskId: string,
  semanticLayer: SemanticLayerMetadata,
  options: {
    editPrompt?: string;
  } = {},
  signal?: AbortSignal
): Promise<SemanticForegroundReplacementResult> {
  signal?.throwIfAborted();
  const request = {
    image: generatedImageUrl,
    mode: 'auto' as const,
    maxLayers: 1,
    prompt:
      '只将图片中的主要前景主体分离为一个透明 PNG 图层；不要分离背景、阴影、反射或其它背景元素。保持主体原始外观、细节、比例和位置。',
  };
  let response: LayerDecompositionResponse | null = null;
  // Reuse the local high-fidelity detector/SAM2/matting pipeline first. It
  // keeps the generated subject's soft alpha edges and avoids importing any
  // generated background into the replacement layer.
  try {
    const prompt = await createConfiguredProviderCandidatePrompt(
      generatedImageUrl,
      signal,
      {
        editInstruction: options.editPrompt,
        excludedTargetName: semanticLayer.name,
        excludedTargetDescription: semanticLayer.description,
        maxCandidates: 1,
      }
    );
    response = await createLayerDecompositionApiClient().decompose(
      {
        ...request,
        ...(prompt ? { prompt } : {}),
      },
      { signal }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
  }
  try {
    if (!response) {
      response = await decomposeWithConfiguredImageProvider(request, {
        signal,
        modelId: SEEDREAM_LAYER_MODEL_ID,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
  }
  if (!response) {
    const prompt = await createConfiguredProviderCandidatePrompt(
      generatedImageUrl,
      signal,
      {
        editInstruction: options.editPrompt,
        excludedTargetName: semanticLayer.name,
        excludedTargetDescription: semanticLayer.description,
        maxCandidates: 1,
      }
    );
    response = await createLayerDecompositionApiClient().decompose(
      {
        ...request,
        ...(prompt ? { prompt } : {}),
      },
      { signal }
    );
  }
  const foreground = requireSingleForeground(response);
  const cachedUrl = await cacheRemoteUrl(
    resolveArtifactUrl(foreground.url),
    `semantic-layer-edit-${taskId}`,
    'image',
    'png',
    1,
    {
      forceRemoteCache: true,
      returnLocalCacheUrl: true,
      cacheKey: `semantic-layer-edit-${taskId}`,
      signal,
      extraMetadata: {
        providerGroupId: response.groupId,
        zIndex: foreground.zIndex,
        name: foreground.name,
        source: 'semantic-layer-edit',
      },
    }
  );
  signal?.throwIfAborted();
  if (!cachedUrl.startsWith(LOCAL_IMAGE_CACHE_PREFIX)) {
    throw new Error('透明前景未能固化到本地缓存，原图层保持不变');
  }
  await assertCachedTransparentPng(cachedUrl);
  const image = await loadImageElementForCanvas(cachedUrl as any);
  const [x1, y1, x2, y2] = foreground.boundingBox.absolute;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width !== x2 - x1 || height !== y2 - y1) {
    throw new Error('透明前景尺寸与语义边界不一致，原图层保持不变');
  }
  return {
    url: cachedUrl,
    layer: { ...foreground, url: cachedUrl },
    width: response.width!,
    height: response.height!,
  };
}

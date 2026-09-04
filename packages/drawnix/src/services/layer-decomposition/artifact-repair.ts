import type { ModelRef } from '../../utils/settings-manager';
import { loadImageElementForCanvas } from '../../data/image';
import { generateImage } from '../media-generation/image-generation-service';
import { unifiedCacheService } from '../unified-cache-service';
import { inspectGeneratedImageArtifacts } from './provider';
import type { LayerDecompositionResponse } from './types';

const MAX_REPAIR_PIXELS = 20_000_000;
const MAX_REPAIR_BOXES = 3;
const REPAIR_MARGIN_RATIO = 0.006;
let rasterOperationTail: Promise<void> = Promise.resolve();

async function runRasterOperation<T>(work: () => Promise<T>): Promise<T> {
  const previous = rasterOperationTail;
  let release!: () => void;
  rasterOperationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

export interface GeneratedImagePostprocessOptions {
  generatedImageUrl: string;
  taskId: string;
  originalImageUrl?: string;
  maskImageUrl?: string;
  model?: string;
  modelRef?: ModelRef | null;
  size?: string;
  resolution?: '1k' | '2k' | '4k';
  quality?: 'auto' | 'low' | 'medium' | 'high' | '1k' | '2k' | '4k';
  prompt?: string;
  targetName?: string;
  targetDescription?: string;
  excludedTargetName?: string;
  excludedTargetDescription?: string;
  signal?: AbortSignal;
}

interface RasterImage {
  image: HTMLImageElement;
  width: number;
  height: number;
}

function getRasterSize(image: HTMLImageElement): {
  width: number;
  height: number;
} {
  const width = Math.floor(image.naturalWidth || image.width);
  const height = Math.floor(image.naturalHeight || image.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new Error('图片尺寸无效');
  }
  if (width <= 0 || height <= 0 || width * height > MAX_REPAIR_PIXELS) {
    throw new Error('图片尺寸超过瑕疵修复上限');
  }
  return { width, height };
}

async function loadRaster(url: string): Promise<RasterImage> {
  const image = await loadImageElementForCanvas(url as any);
  const size = getRasterSize(image);
  return { image, ...size };
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('当前环境不支持图片瑕疵修复');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('瑕疵修复图片编码失败')),
      'image/png'
    );
  });
}

async function cacheCanvas(
  canvas: HTMLCanvasElement,
  taskId: string,
  suffix: string
): Promise<string> {
  try {
    const blob = await canvasToBlob(canvas);
    const url = `/__aitu_cache__/image/${suffix}-${taskId}.png`;
    return await unifiedCacheService.cacheMediaFromBlob(url, blob, 'image', {
      metadata: {
        source: 'generated-image-artifact-repair',
        taskId,
      },
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function drawScaled(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number
): void {
  context.drawImage(image, 0, 0, width, height);
}

function releaseRaster(raster: RasterImage): void {
  try {
    raster.image.src = '';
  } catch {
    // The decoded pixels become collectible when the local reference expires.
  }
}

function resolveArtifactUrl(url: string): string {
  return url.startsWith('/') && typeof window !== 'undefined'
    ? new URL(url, window.location.origin).toString()
    : url;
}

async function buildLayerRemovalMask(
  sourceImageUrl: string,
  response: LayerDecompositionResponse,
  taskId: string
): Promise<string> {
  return runRasterOperation(async () => {
    const source = await loadRaster(sourceImageUrl);
    const canvas = createCanvas(source.width, source.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建分层背景蒙版');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, source.width, source.height);
    releaseRaster(source);

    const responseWidth = response.width || canvas.width;
    const responseHeight = response.height || canvas.height;
    const scaleX = canvas.width / responseWidth;
    const scaleY = canvas.height / responseHeight;
    context.globalCompositeOperation = 'destination-out';
    for (const layer of response.layers) {
      const [x1, y1, x2, y2] = layer.boundingBox.absolute;
      const left = Math.max(0, Math.floor(x1 * scaleX));
      const top = Math.max(0, Math.floor(y1 * scaleY));
      const right = Math.min(canvas.width, Math.ceil(x2 * scaleX));
      const bottom = Math.min(canvas.height, Math.ceil(y2 * scaleY));
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) continue;

      const layerRaster = await loadRaster(resolveArtifactUrl(layer.url));
      try {
        // A two-pixel expansion protects the boundary from inpainting halos.
        const expansion = Math.max(
          1,
          Math.min(3, Math.round(Math.min(width, height) * 0.01))
        );
        for (const [offsetX, offsetY] of [
          [0, 0],
          [-expansion, 0],
          [expansion, 0],
          [0, -expansion],
          [0, expansion],
        ]) {
          context.drawImage(
            layerRaster.image,
            left + offsetX,
            top + offsetY,
            width,
            height
          );
        }
      } finally {
        releaseRaster(layerRaster);
      }
    }
    context.globalCompositeOperation = 'source-over';
    return cacheCanvas(canvas, taskId, 'semantic-layer-background-mask');
  });
}

/**
 * Rebuilds the hidden background with the currently selected image model.
 * OpenCV remains the local fallback for API compatibility, but this pass is
 * required before a local decomposition is committed because OpenCV cannot
 * reconstruct large, structured regions such as windows or floorboards.
 */
export async function repairLayerDecompositionBackground(
  sourceImageUrl: string,
  response: LayerDecompositionResponse,
  signal?: AbortSignal
): Promise<LayerDecompositionResponse> {
  signal?.throwIfAborted();
  if (response.layers.length === 0) return response;

  const taskId =
    response.groupId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) ||
    `layer-${Date.now().toString(36)}`;
  const removalMask = await buildLayerRemovalMask(
    sourceImageUrl,
    response,
    taskId
  );
  signal?.throwIfAborted();
  const generated = await generateImage(
    '只修复透明蒙版区域：删除该区域内所有前景主体，并补全它们原本遮挡的真实背景。' +
      '保持蒙版外像素、构图、透视、光照、景深和材质完全不变。' +
      '禁止添加新的动物、人物、植物、文字、窗户、栏杆或装饰，禁止留下主体轮廓、重复纹理和放射状涂抹。',
    {
      generationMode: 'image_edit',
      referenceImages: [sourceImageUrl],
      maskImage: removalMask,
      inputFidelity: 'high',
      outputFormat: 'png',
      count: 1,
      resultVisibility: 'internal',
      autoInsertToCanvas: false,
      signal,
    }
  );
  if (!generated.url) {
    throw new Error('当前图片模型未返回可用的干净背景');
  }
  const backgroundUrl = await compositeWithPreservedMask(
    generated.url,
    sourceImageUrl,
    removalMask,
    taskId,
    'semantic-layer-clean-background'
  );
  return {
    ...response,
    background: {
      ...response.background,
      url: backgroundUrl,
      description: '当前图片模型重建的干净背景',
    },
    decisions: [
      ...(response.decisions || []),
      'background_repaired_with_active_image_model',
    ],
  };
}

/**
 * Combines a generated raster with a preserved raster using an OpenAI-style
 * mask: opaque mask pixels are preserved, transparent pixels are editable.
 */
async function compositeWithPreservedMask(
  generatedUrl: string,
  preservedUrl: string,
  maskUrl: string,
  taskId: string,
  suffix: string
): Promise<string> {
  return runRasterOperation(async () => {
    const generated = await loadRaster(generatedUrl);
    const width = generated.width;
    const height = generated.height;
    const output = createCanvas(width, height);
    const outputContext = output.getContext('2d');
    if (!outputContext) throw new Error('无法创建瑕疵修复画布');

    // Decode one source at a time and release it after drawing so concurrent
    // 4K edits do not retain three decoded rasters plus the output canvas.
    drawScaled(outputContext, generated.image, width, height);
    releaseRaster(generated);

    const mask = await loadRaster(maskUrl);
    outputContext.globalCompositeOperation = 'destination-out';
    drawScaled(outputContext, mask.image, width, height);
    releaseRaster(mask);

    const preserved = await loadRaster(preservedUrl);
    outputContext.globalCompositeOperation = 'destination-over';
    drawScaled(outputContext, preserved.image, width, height);
    releaseRaster(preserved);
    outputContext.globalCompositeOperation = 'source-over';
    return cacheCanvas(output, taskId, suffix);
  });
}

async function buildRepairMask(
  generatedUrl: string,
  boxes: Array<[number, number, number, number]>,
  taskId: string
): Promise<string> {
  return runRasterOperation(async () => {
    const generated = await loadRaster(generatedUrl);
    const canvas = createCanvas(generated.width, generated.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建瑕疵蒙版');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, generated.width, generated.height);
    context.globalCompositeOperation = 'destination-out';
    const margin = Math.max(
      4,
      Math.min(
        24,
        Math.round(
          Math.min(generated.width, generated.height) * REPAIR_MARGIN_RATIO
        )
      )
    );
    for (const [x1, y1, x2, y2] of boxes.slice(0, MAX_REPAIR_BOXES)) {
      const left = Math.max(
        0,
        Math.round((x1 / 1000) * generated.width) - margin
      );
      const top = Math.max(
        0,
        Math.round((y1 / 1000) * generated.height) - margin
      );
      const right = Math.min(
        generated.width,
        Math.round((x2 / 1000) * generated.width) + margin
      );
      const bottom = Math.min(
        generated.height,
        Math.round((y2 / 1000) * generated.height) + margin
      );
      if (right > left && bottom > top) {
        context.clearRect(left, top, right - left, bottom - top);
      }
    }
    return cacheCanvas(canvas, taskId, 'generated-image-repair-mask');
  });
}

function getRepairPrompt(options: GeneratedImagePostprocessOptions): string {
  const target = options.targetName?.trim();
  const description = options.targetDescription?.trim();
  const excludedTarget = options.excludedTargetName?.trim();
  const excludedDescription = options.excludedTargetDescription?.trim();
  const editIntent = options.prompt?.trim().slice(0, 500);
  return (
    '只修复图片中检测到的局部生成伪影，禁止改变未选区域、主体身份、姿态、构图、光照和背景。' +
    '删除重复/多余器官、断裂或粘连轮廓及明显穿帮结构，保持真实毛发和自然阴影。' +
    '严格只在提供的透明蒙版区域内编辑；如果无法确定，宁可保留原状。' +
    (target
      ? `目标主体：${target}${description ? `（${description}）` : ''}。`
      : '') +
    (excludedTarget
      ? `原主体“${excludedTarget}”${
          excludedDescription ? `（${excludedDescription}）` : ''
        }已被替换，必须删除其尾巴、毛发、肢体、轮廓及其他残留，禁止恢复原主体。`
      : '') +
    (editIntent ? `必须保留原编辑意图：${editIntent}。` : '')
  );
}

/**
 * Protects user-selected image edits, then performs at most one bounded
 * vision-guided repair pass. Normal edits keep the best available image on
 * inspection failure; semantic replacement rejects unverified results.
 */
export async function postprocessGeneratedImage(
  options: GeneratedImagePostprocessOptions
): Promise<string> {
  options.signal?.throwIfAborted();
  let output = options.generatedImageUrl;
  const requiresVerifiedReplacement = Boolean(
    options.excludedTargetName?.trim()
  );

  if (options.originalImageUrl && options.maskImageUrl) {
    try {
      output = await compositeWithPreservedMask(
        output,
        options.originalImageUrl,
        options.maskImageUrl,
        options.taskId,
        'generated-image-mask-protected'
      );
    } catch (error) {
      console.warn(
        '[ArtifactRepair] Failed to protect unmasked pixels:',
        error
      );
      if (requiresVerifiedReplacement) {
        throw new Error('替换区域保护失败，已取消本次替换');
      }
    }
  }

  const inspection = await inspectGeneratedImageArtifacts(
    output,
    options.signal,
    {
      targetName: options.targetName,
      targetDescription: options.targetDescription,
      originalImageSource: options.originalImageUrl,
      editInstruction: options.prompt,
      excludedTargetName: options.excludedTargetName,
      excludedTargetDescription: options.excludedTargetDescription,
    }
  );
  if (requiresVerifiedReplacement && !inspection) {
    throw new Error('旧主体残留检查不可用，已取消本次替换');
  }
  if (requiresVerifiedReplacement && inspection?.needsRepair) {
    if (inspection.boxes.length === 0) {
      throw new Error('检测到旧主体残留但缺少修复区域，已取消本次替换');
    }
  }
  if (!inspection?.needsRepair || inspection.boxes.length === 0) {
    return output;
  }

  try {
    const repairMask = await buildRepairMask(
      output,
      inspection.boxes,
      options.taskId
    );
    const generated = await generateImage(getRepairPrompt(options), {
      model: options.model,
      modelRef: options.modelRef,
      size: options.size,
      resolution: options.resolution,
      quality: options.quality,
      generationMode: 'image_edit',
      referenceImages: [output],
      maskImage: repairMask,
      inputFidelity: 'high',
      outputFormat: 'png',
      count: 1,
      resultVisibility: 'internal',
      autoInsertToCanvas: false,
      signal: options.signal,
    });
    if (generated.url) {
      output = await compositeWithPreservedMask(
        generated.url,
        output,
        repairMask,
        options.taskId,
        'generated-image-repaired'
      );
    }
  } catch (error) {
    console.warn('[ArtifactRepair] Local repair pass skipped:', error);
    if (requiresVerifiedReplacement) {
      throw new Error('旧主体残留修复失败，已取消本次替换');
    }
  }

  if (options.originalImageUrl && options.maskImageUrl) {
    try {
      output = await compositeWithPreservedMask(
        output,
        options.originalImageUrl,
        options.maskImageUrl,
        options.taskId,
        'generated-image-mask-final'
      );
    } catch (error) {
      console.warn('[ArtifactRepair] Failed to reapply source mask:', error);
      if (requiresVerifiedReplacement) {
        throw new Error('替换区域保护失败，已取消本次替换');
      }
    }
  }

  if (requiresVerifiedReplacement) {
    const finalInspection = await inspectGeneratedImageArtifacts(
      output,
      options.signal,
      {
        originalImageSource: options.originalImageUrl,
        editInstruction: options.prompt,
        excludedTargetName: options.excludedTargetName,
        excludedTargetDescription: options.excludedTargetDescription,
      }
    );
    if (!finalInspection) {
      throw new Error('修复结果复检不可用，已取消本次替换');
    }
    if (finalInspection.needsRepair) {
      throw new Error('修复后仍检测到旧主体残留，已取消本次替换');
    }
  }
  return output;
}

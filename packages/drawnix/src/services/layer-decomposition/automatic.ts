import type { PlaitBoard } from '@plait/core';
import {
  createLayerDecompositionApiClient,
  LayerDecompositionCorrectionRequiredError,
} from './api';
import { insertLayerDecomposition } from './canvas';
import {
  decomposeWithConfiguredImageProvider,
  LayerDecompositionProviderUnsupportedError,
  SEEDREAM_LAYER_MODEL_ID,
} from './provider';
import type {
  LayerDecompositionProgress,
  LayerDecompositionResponse,
} from './types';

export type AutomaticLayerDecompositionOutcome =
  | { kind: 'applied'; layerCount: number }
  | { kind: 'test' };

export interface AutomaticLayerDecompositionOptions {
  onProgress?: (progress: LayerDecompositionProgress) => void;
}

const localLayerDecompositionApi = createLayerDecompositionApiClient({
  requestTimeoutMs: 45_000,
});

export interface AutomaticLayerDecompositionLaunch {
  started: boolean;
  promise: Promise<AutomaticLayerDecompositionOutcome>;
}

const activeTasks = new WeakMap<
  PlaitBoard,
  Map<
    string,
    {
      imageUrl: string;
      promise: Promise<AutomaticLayerDecompositionOutcome>;
    }
  >
>();

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error);
}

function sourceIsUnchanged(
  board: PlaitBoard,
  sourceElementId: string,
  imageUrl: string
): boolean {
  return board.children.some(
    (element) =>
      element.id === sourceElementId &&
      element.type === 'image' &&
      element.url === imageUrl
  );
}

function requirePassedQuality(
  response: LayerDecompositionResponse
): LayerDecompositionResponse {
  if (
    response.decisions?.includes('fallback_full_canvas') ||
    response.layers.length === 0
  ) {
    throw new LayerDecompositionCorrectionRequiredError('no-foreground');
  }
  const quality = response.quality;
  if (
    quality?.passed !== true ||
    quality.ssim === undefined ||
    quality.ssim < 0.999 ||
    quality.channelErrorRate === undefined ||
    quality.channelErrorRate > 0.001 + Number.EPSILON * 8
  ) {
    throw new LayerDecompositionCorrectionRequiredError('quality-gate');
  }
  return response;
}

async function runAutomaticLayerDecomposition(
  board: PlaitBoard,
  sourceElementId: string,
  imageUrl: string,
  options: AutomaticLayerDecompositionOptions
): Promise<AutomaticLayerDecompositionOutcome> {
  if (!sourceIsUnchanged(board, sourceElementId, imageUrl)) {
    throw new Error('源图片已变化，请重新选择图片');
  }

  const request = { image: imageUrl, mode: 'auto' as const, maxLayers: 16 };
  let response: LayerDecompositionResponse;
  let localFailure: unknown;

  // The local detector + SAM2 + matting pipeline is the primary path. It
  // preserves source RGB and soft alpha edges, which is important for fur,
  // hair, whiskers, reflections, and other fine details. Seedream is a
  // recovery path for unavailable or quality-gated local inference.
  try {
    response = await localLayerDecompositionApi.decompose(request, {
      timeoutMs: 10 * 60_000,
      onProgress: options.onProgress,
    });
    if (response.resultKind === 'test') return { kind: 'test' };
    requirePassedQuality(response);
    if (!sourceIsUnchanged(board, sourceElementId, imageUrl)) {
      throw new Error('源图片已变化，请重新选择图片');
    }
    await insertLayerDecomposition(board, sourceElementId, response, {
      boardGuard: () => sourceIsUnchanged(board, sourceElementId, imageUrl),
    });
    return { kind: 'applied', layerCount: response.layers.length + 1 };
  } catch (error) {
    localFailure = error;
  }

  try {
    const providerResponse = await decomposeWithConfiguredImageProvider(request, {
      // Seedream is a recovery path only. Ordinary image generation routing
      // remains untouched, and the local high-fidelity pipeline gets priority.
      modelId: SEEDREAM_LAYER_MODEL_ID,
      onProgress: options.onProgress,
    });
    if (!providerResponse) {
      throw new LayerDecompositionProviderUnsupportedError(
        '未找到可调用的 Seedream 5.0 Pro 图片 Provider，请先在图片模型中配置该模型'
      );
    }
    response = providerResponse;
  } catch (error) {
    if (
      isAbortError(error) ||
      error instanceof LayerDecompositionCorrectionRequiredError
    ) {
      throw error;
    }
    const localMessage = localFailure ? `；本地分层：${errorMessage(localFailure)}` : '';
    throw new Error(`Seedream 5.0 Pro 兜底分层失败：${errorMessage(error)}${localMessage}`);
  }
  if (response.resultKind === 'test') return { kind: 'test' };
  if (!sourceIsUnchanged(board, sourceElementId, imageUrl)) {
    throw new Error('源图片已变化，请重新选择图片');
  }
  requirePassedQuality(response);

  await insertLayerDecomposition(board, sourceElementId, response, {
    boardGuard: () => sourceIsUnchanged(board, sourceElementId, imageUrl),
  });
  return { kind: 'applied', layerCount: response.layers.length + 1 };
}

export function startAutomaticLayerDecomposition(
  board: PlaitBoard,
  sourceElementId: string,
  imageUrl: string,
  options: AutomaticLayerDecompositionOptions = {}
): AutomaticLayerDecompositionLaunch {
  let boardTasks = activeTasks.get(board);
  if (!boardTasks) {
    boardTasks = new Map();
    activeTasks.set(board, boardTasks);
  }

  const existing = boardTasks.get(sourceElementId);
  if (existing && existing.imageUrl === imageUrl) {
    return { started: false, promise: existing.promise };
  }

  const trackedPromise = runAutomaticLayerDecomposition(
    board,
    sourceElementId,
    imageUrl,
    options
  ).finally(() => {
    if (boardTasks?.get(sourceElementId)?.promise === trackedPromise) {
      boardTasks.delete(sourceElementId);
      if (boardTasks.size === 0) activeTasks.delete(board);
    }
  });
  boardTasks.set(sourceElementId, { imageUrl, promise: trackedPromise });
  return { started: true, promise: trackedPromise };
}

import type { CanvasBoardBinding } from '../canvas-operations/canvas-board-ref';
import { getCanvasBoardBinding } from '../canvas-operations/canvas-board-ref';
import {
  decomposeWithConfiguredImageProvider,
  SEEDREAM_55_LAYER_MODEL_ID,
} from './provider';
import { insertLayerDecomposition } from './canvas';
import type { LayerDecompositionProgress } from './types';
import type { LayerRecoveryHandle } from './recovery';

const active = new WeakMap<CanvasBoardBinding['board'], Set<string>>();

/** Explicit native path: never falls back to the local pipeline or another paid model. */
export async function decomposeSeedream55(
  binding: CanvasBoardBinding,
  source: { id: string; url: string },
  options: {
    maxLayers: number;
    textRecognition: boolean;
    signal: AbortSignal;
    onProgress?: (progress: LayerDecompositionProgress) => void;
    recovery?: LayerRecoveryHandle;
    onRecoveryAvailable?: (handle: LayerRecoveryHandle) => void;
  }
) {
  const { board, boardId } = binding;
  const current = () => {
    const now = getCanvasBoardBinding();
    return (
      !options.signal.aborted &&
      now?.board === board &&
      now.boardId === boardId &&
      board.children.some(
        (element) => element.id === source.id && element.url === source.url
      )
    );
  };
  const assertCurrent = () => {
    if (!current()) throw new Error('画布或源图片已变化，已取消分层');
  };
  assertCurrent();
  if (active.get(board)?.has(source.id))
    throw new Error('这张图片正在分层，请等待已有任务');
  const tasks = active.get(board) || new Set<string>();
  active.set(board, tasks);
  tasks.add(source.id);
  try {
    const response = options.recovery
      ? await options.recovery.recover(options)
      : await decomposeWithConfiguredImageProvider(
          {
            image: source.url,
            maxLayers: options.maxLayers,
            textRecognition: options.textRecognition,
          },
          {
            modelId: SEEDREAM_55_LAYER_MODEL_ID,
            signal: options.signal,
            onProgress: options.onProgress,
            onRecoveryAvailable: options.onRecoveryAvailable,
          }
        );
    assertCurrent();
    if (!response) throw new Error('当前供应商未配置 Seedream 5.5 分层');
    if (response.resultKind === 'test')
      throw new Error('测试结果不能写入真实画布');
    if (response.layers.length > options.maxLayers)
      throw new Error('返回图层数量超过本次请求上限');
    await insertLayerDecomposition(board, source.id, response, {
      signal: options.signal,
      boardGuard: current,
    });
    return {
      layerCount: response.layers.length + 1,
      textLayerCount: response.layers.filter((layer) => layer.textRecognition)
        .length,
    };
  } finally {
    tasks.delete(source.id);
    if (!tasks.size) active.delete(board);
  }
}

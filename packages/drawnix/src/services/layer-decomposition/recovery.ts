import type { AdapterContext } from '../model-adapters/types';
import { sendAdapterRequest } from '../model-adapters/context';
import { readProviderResponseJson } from '../provider-routing/provider-transport';
import type {
  LayerDecompositionProgress,
  LayerDecompositionResponse,
} from './types';

export interface LayerRecoveryOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LayerDecompositionProgress) => void;
}

/** Kept in memory for this attempt; captures its provider, never current settings. */
export interface LayerRecoveryHandle {
  requestId: string;
  recover: (
    options: LayerRecoveryOptions
  ) => Promise<LayerDecompositionResponse>;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Read an existing result only. No source-image reads, POSTs or provider switching. */
export async function recoverLayerPayload(
  context: AdapterContext,
  requestId: string,
  options: LayerRecoveryOptions & {
    timeoutMs?: number;
    intervalMs?: number;
  } = {}
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    options.onProgress?.({
      taskId: requestId,
      status: 'running',
      progress: 50,
      phase: 'recovering',
    });
    let response: Response;
    let payload: Record<string, unknown>;
    try {
      response = await sendAdapterRequest(context, {
        path: '/images/generations/result',
        baseUrlStrategy: 'ensure-v1',
        method: 'GET',
        query: { request_id: requestId },
        signal: options.signal,
        timeoutMs: Math.min(15_000, deadline - Date.now()),
      });
      payload = response.ok
        ? await readProviderResponseJson<Record<string, unknown>>(response)
        : await readProviderResponseJson<Record<string, unknown>>(
            response
          ).catch(() => ({}));
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof SyntaxError)
        throw new Error('结果查询返回了无效 JSON');
      await wait(
        Math.max(
          0,
          Math.min(options.intervalMs ?? 5_000, deadline - Date.now())
        ),
        options.signal
      );
      continue;
    }
    options.signal?.throwIfAborted();
    if (!response.ok) {
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`获取已有分层结果失败（HTTP ${response.status}）`);
      }
    } else {
      if (!payload || payload.request_id !== requestId)
        throw new Error('结果查询的请求 ID 不匹配');
      if (payload.status === 'failed')
        throw new Error('上游分层任务失败，请核对该请求的调用记录');
      if (payload.status === 'succeeded') {
        const items = payload.data;
        if (
          !Array.isArray(items) ||
          items.length < 2 ||
          items.some(
            (item) =>
              !item ||
              typeof item.z_index !== 'number' ||
              (item.z_index !== 0 && !item.bounding_box)
          )
        ) {
          throw new Error(
            '已有结果仅含图片链接或缺少分层元数据，无法恢复图层位置和 OCR；需要服务端保存完整分层结果'
          );
        }
        return { ...payload, id: `seedream55-${requestId}` };
      }
      if (payload.status !== 'processing_or_not_found')
        throw new Error('无法识别分层结果状态');
    }
    await wait(
      Math.max(0, Math.min(options.intervalMs ?? 5_000, deadline - Date.now())),
      options.signal
    );
  }
  throw new Error('等待已有分层结果超时，可再次获取已有结果；未重新提交生图');
}

/**
 * 图片生成 API
 *
 * 统一的图片生成接口，SW 和主线程共用
 */

import type {
  ImageApiConfig,
  ImageGenerationParams,
  ImageGenerationResult,
  AsyncImageOptions,
  AsyncTaskSubmitResponse,
} from './types';
import { getFileExtension, normalizeImageDataUrl } from '@aitu/utils';
import {
  isAsyncImageModel,
  normalizeApiBase,
  getExtensionFromUrl,
  sizeToAspectRatio,
  aspectRatioToSize,
  parseErrorMessage,
  sleep,
  buildProviderContextFromApiConfig,
} from './utils';
import {
  canAttachProviderRequestIdHeader,
  providerTransport,
} from '../provider-routing/provider-transport';
import { IMAGE_GENERATION_TIMEOUT_MS } from '../../constants/TASK_CONSTANTS';
import { emitImageRequestIdDebugLog } from './request-id-debug';

// 重新导出工具函数，方便外部使用
export { isAsyncImageModel, aspectRatioToSize };

/** /log/get-request 找回接口的短超时，避免兜底本身长时间挂起 */
const RECOVER_REQUEST_TIMEOUT_MS = 15_000;
const RECOVER_RETRYABLE_STATUS = new Set(['processing', 'processing_or_not_found']);
const RECOVER_MAX_ATTEMPTS = 3;
const RECOVER_RETRY_DELAY_MS = 1200;

function getDefaultImagePollingMaxAttempts(interval: number): number {
  return Math.ceil(IMAGE_GENERATION_TIMEOUT_MS / Math.max(interval, 1));
}

function generateRequestId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      /Request timeout|请求超时/.test(error.message))
  );
}

export function extractRequestId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const uuidMatch = trimmed.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
  );
  if (uuidMatch) {
    return uuidMatch[0];
  }

  const reqMatch = trimmed.match(/\breq-[a-z0-9-]{8,}\b/i);
  if (reqMatch) {
    return reqMatch[0];
  }

  return trimmed;
}

function getRecoverStatus(
  data: Record<string, unknown>
): string | undefined {
  return typeof data.status === 'string' ? data.status : undefined;
}

function isRecoverStatusRetryable(status: string | undefined): boolean {
  return !!status && RECOVER_RETRYABLE_STATUS.has(status);
}

/**
 * 通过 X-Request-Id 找回已经生成成功的图片。
 * 用于生图接口超时但服务端实际已扣费/生成成功的兜底场景。
 *
 * 接口：`GET /log/get-request?id={requestId}`
 * 响应结构与 `POST /images/generations` 一致（`{ data: [{ url }] }`），可复用 parseImageResponse。
 */
export async function recoverImageByRequestId(
  requestId: string,
  config: ImageApiConfig,
  signal?: AbortSignal
): Promise<ImageGenerationResult> {
  const normalizedRequestId =
    typeof requestId === 'string' ? extractRequestId(requestId) : '';

  if (!normalizedRequestId) {
    throw new Error('recoverImageByRequestId: 缺少 requestId');
  }

  const fetchFn = config.fetchImpl || fetch;
  for (let attempt = 1; attempt <= RECOVER_MAX_ATTEMPTS; attempt += 1) {
    const response = await providerTransport.send(
      buildProviderContextFromApiConfig(config),
      {
        path: '/log/get-request',
        method: 'GET',
        query: { id: normalizedRequestId },
        // /log/get-request 是根路径级 API，不带 /v1 前缀
        baseUrlStrategy: 'trim-v1',
        signal,
        timeoutMs: RECOVER_REQUEST_TIMEOUT_MS,
        fetcher: fetchFn,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `找回接口调用失败: ${response.status} - ${errorText.substring(0, 200)}`
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const status = getRecoverStatus(data);

    if (!status || status === 'succeeded' || status === 'success') {
      return parseImageResponse(data);
    }

    if (isRecoverStatusRetryable(status) && attempt < RECOVER_MAX_ATTEMPTS) {
      console.info(
        `[X-Request-Id][recover] ${normalizedRequestId} ${status} retry ${attempt}`
      );
      await sleep(RECOVER_RETRY_DELAY_MS);
      continue;
    }

    throw new Error(`找回接口返回状态非成功：${status}`);
  }

  throw new Error('找回接口重试结束但未返回成功结果');
}

function normalizeImageResultUrl(
  item: Record<string, unknown>
): string | undefined {
  if (typeof item.url === 'string' && item.url) {
    // url 字段可能是原始 base64（如 /9j/4AAQ...），需要转为 data URL
    return normalizeImageDataUrl(item.url);
  }

  const b64 = typeof item.b64_json === 'string' ? item.b64_json : '';
  if (!b64) {
    return undefined;
  }

  return normalizeImageDataUrl(b64);
}

/**
 * 构建图片生成请求体
 */
export function buildImageRequestBody(
  params: ImageGenerationParams
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    model: params.model,
  };

  if (params.n && params.n > 1) {
    body.n = params.n;
  }

  if (params.size) {
    body.size = aspectRatioToSize(params.size) || params.size;
  } else if (params.aspectRatio) {
    body.size = aspectRatioToSize(params.aspectRatio);
  }

  if (params.quality) {
    body.quality = params.quality;
  }

  // 添加参考图片（已经转换为 base64 或 URL）
  if (params.referenceImages && params.referenceImages.length > 0) {
    body.image = params.referenceImages;
  }

  return body;
}

/**
 * 解析同步图片生成响应
 */
export function parseImageResponse(
  data: Record<string, unknown>
): ImageGenerationResult {
  // 支持多种响应格式
  if (data.data && Array.isArray(data.data)) {
    const urls = data.data
      .map((item: Record<string, unknown>) => normalizeImageResultUrl(item))
      .filter(Boolean) as string[];

    if (urls.length === 0) {
      // 检查是否包含违禁内容错误
      const firstItem = data.data[0] as Record<string, unknown> | undefined;
      if (firstItem?.revised_prompt) {
        const revisedPrompt = String(firstItem.revised_prompt);
        if (revisedPrompt.includes('PROHIBITED_CONTENT')) {
          throw new Error('内容被拒绝：包含违禁内容');
        }
        if (revisedPrompt.includes('NO_IMAGE')) {
          throw new Error(
            '该模型为多模态模型，未生成图片，可更换提示词明确生成图片试试'
          );
        }
      }
      throw new Error('No image URL in response');
    }

    const format = getFileExtension(urls[0]) || 'png';
    return {
      url: urls[0],
      urls: urls.length > 1 ? urls : undefined,
      format: format === 'bin' ? 'png' : format,
    };
  }

  if (data.url && typeof data.url === 'string') {
    const normalizedUrl = normalizeImageDataUrl(data.url);
    const format = getFileExtension(normalizedUrl);
    return {
      url: normalizedUrl,
      format: format === 'bin' ? 'png' : format,
    };
  }

  throw new Error('Invalid image generation response');
}

/**
 * 同步图片生成
 *
 * @param params 图片生成参数
 * @param config API 配置
 * @param signal 取消信号
 * @returns 图片生成结果
 */
export async function generateImageSync(
  params: ImageGenerationParams,
  config: ImageApiConfig,
  signal?: AbortSignal
): Promise<ImageGenerationResult> {
  const fetchFn = config.fetchImpl || fetch;
  const model =
    params.model || config.defaultModel || 'gemini-3-pro-image-preview-vip';

  const requestBody = buildImageRequestBody({
    ...params,
    model,
  });

  const providerContext = buildProviderContextFromApiConfig(config);
  const requestId = canAttachProviderRequestIdHeader(providerContext, {
    path: '/images/generations',
  })
    ? generateRequestId()
    : undefined;
  if (requestId) {
    emitImageRequestIdDebugLog(requestId, {
      model,
      endpoint: '/images/generations',
      source: 'generateImageSync',
    });
  }

  try {
    const response = await providerTransport.send(providerContext, {
      path: '/images/generations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
      timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
      fetcher: fetchFn,
      requestId,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Image generation failed: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    return parseImageResponse(data);
  } catch (error) {
    // 超时兜底：尝试通过 /log/get-request 找回已经生成成功的结果
    if (isTimeoutError(error) && requestId) {
      console.warn(
        `[ImageAPI] 生图请求超时，尝试通过 X-Request-Id 找回结果: ${requestId}`
      );
      try {
        const recovered = await recoverImageByRequestId(
          requestId,
          config,
          signal
        );
        console.info(
          `[ImageAPI] ✅ 通过 X-Request-Id 找回结果成功: ${requestId}`
        );
        return recovered;
      } catch (recoverError) {
        console.error(
          `[ImageAPI] ❌ 通过 X-Request-Id 找回结果失败: ${requestId}`,
          recoverError
        );
        // 找回失败，抛出原始超时错误
        throw error;
      }
    }
    throw error;
  }
}

/**
 * 异步图片生成：提交任务并轮询结果
 * 用于需要长时间处理的异步图片模型
 *
 * @param params 图片生成参数
 * @param config API 配置
 * @param options 异步选项（进度回调、取消信号等）
 * @returns 图片生成结果
 */
export async function generateImageAsync(
  params: ImageGenerationParams,
  config: ImageApiConfig,
  options: AsyncImageOptions = {}
): Promise<ImageGenerationResult> {
  const {
    onProgress,
    onSubmitted,
    signal,
    interval = 5000,
    maxAttempts,
  } = options;
  const maxPollingAttempts =
    maxAttempts ?? getDefaultImagePollingMaxAttempts(interval);
  const fetchFn = config.fetchImpl || fetch;
  const baseUrl = normalizeApiBase(config.baseUrl);
  const providerContext = buildProviderContextFromApiConfig(config, baseUrl);
  const model =
    params.model || config.defaultModel || 'gemini-3-pro-image-preview-async';
  // 计算宽高比
  const aspectRatio =
    params.aspectRatio || sizeToAspectRatio(params.size) || '1:1';
  // 构建 FormData
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', params.prompt);
  formData.append('size', aspectRatio);

  // 处理参考图片：需要转换为 Blob
  if (params.referenceImages && params.referenceImages.length > 0) {
    for (let i = 0; i < params.referenceImages.length; i++) {
      const refImage = params.referenceImages[i];
      try {
        // 尝试 fetch 图片（支持 base64 和 URL）
        const response = await fetchFn(refImage, { signal });
        if (response.ok) {
          const blob = await response.blob();
          formData.append('input_reference', blob, `reference-${i}.png`);
        }
      } catch (e) {
        console.warn(`[ImageAPI] Failed to fetch reference image ${i}:`, e);
      }
    }
  }
  if (params.maskImage) {
    try {
      const response = await fetchFn(params.maskImage, { signal });
      if (response.ok) {
        formData.append('mask', await response.blob(), 'mask.png');
      }
    } catch (e) {
      console.warn('[ImageAPI] Failed to fetch mask image:', e);
    }
  }

  onProgress?.(5);
  // 提交异步任务
  const submitResponse = await providerTransport.send(providerContext, {
    path: '/v1/videos',
    method: 'POST',
    body: formData,
    requestId: params.requestId,
    signal,
    timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
    fetcher: fetchFn,
  });
  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error(
      `[ImageAPI] ❌ 提交失败: ${submitResponse.status} - ${errorText.substring(
        0,
        200
      )}`
    );
    throw new Error(
      `Async image submit failed: ${submitResponse.status} - ${errorText}`
    );
  }

  const submitData: AsyncTaskSubmitResponse = await submitResponse.json();
  if (submitData.status === 'failed') {
    const msg = parseErrorMessage(submitData.error) || '图片生成失败';
    console.error(`[ImageAPI] ❌ 任务失败: ${msg}`);
    throw new Error(msg);
  }

  const taskRemoteId = submitData.id;
  if (!taskRemoteId) {
    console.error('[ImageAPI] ❌ No task ID returned from API');
    throw new Error('No task ID returned from API');
  }

  // 通知调用方保存 remoteId（用于页面刷新后恢复轮询）
  await onSubmitted?.(taskRemoteId);
  onProgress?.(10);
  // 轮询等待结果
  let progress = submitData.progress ?? 0;

  for (let attempt = 0; attempt < maxPollingAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error('Async image generation cancelled');
    }

    await sleep(interval, signal);

    const queryResponse = await providerTransport.send(providerContext, {
      path: `/v1/videos/${taskRemoteId}`,
      method: 'GET',
      signal,
      timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
      fetcher: fetchFn,
    });

    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      console.warn(
        `[ImageAPI] ⚠️ 轮询失败: attempt=${attempt + 1}, status=${
          queryResponse.status
        }`
      );
      throw new Error(
        `Async image query failed: ${queryResponse.status} - ${errorText}`
      );
    }

    const statusData = await queryResponse.json();
    progress = statusData.progress ?? progress;
    onProgress?.(10 + progress * 0.9); // 10% 提交 + 90% 轮询

    if (statusData.status === 'completed') {
      const url = statusData.video_url || statusData.url;
      if (!url) {
        console.error('[ImageAPI] ❌ API 未返回有效的图片 URL');
        throw new Error('API 未返回有效的图片 URL');
      }
      return {
        url,
        format: getExtensionFromUrl(url),
      };
    }

    if (statusData.status === 'failed') {
      const msg = parseErrorMessage(statusData.error) || '图片生成失败';
      console.error(`[ImageAPI] ❌ 异步图片生成失败: ${msg}`);
      throw new Error(msg);
    }
  }

  console.error('[ImageAPI] ❌ 异步图片生成超时');
  throw new Error('异步图片生成超时');
}

/**
 * 恢复异步图片轮询
 * 用于页面刷新后继续轮询已提交的任务
 *
 * @param remoteId 远程任务 ID
 * @param config API 配置
 * @param options 轮询选项
 * @returns 图片生成结果
 */
export async function resumeAsyncImagePolling(
  remoteId: string,
  config: ImageApiConfig,
  options: AsyncImageOptions = {}
): Promise<ImageGenerationResult> {
  const { onProgress, signal, interval = 5000, maxAttempts } = options;
  const maxPollingAttempts =
    maxAttempts ?? getDefaultImagePollingMaxAttempts(interval);
  const fetchFn = config.fetchImpl || fetch;
  const baseUrl = normalizeApiBase(config.baseUrl);
  const providerContext = buildProviderContextFromApiConfig(config, baseUrl);

  for (let attempt = 0; attempt < maxPollingAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error('Async image generation cancelled');
    }

    const queryResponse = await providerTransport.send(providerContext, {
      path: `/v1/videos/${remoteId}`,
      method: 'GET',
      signal,
      timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
      fetcher: fetchFn,
    });

    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      throw new Error(
        `Async image query failed: ${queryResponse.status} - ${errorText}`
      );
    }

    const statusData = await queryResponse.json();
    const progress = statusData.progress ?? 0;
    onProgress?.(10 + progress * 0.9);

    if (statusData.status === 'completed') {
      const url = statusData.video_url || statusData.url;
      if (!url) {
        throw new Error('API 未返回有效的图片 URL');
      }
      return {
        url,
        format: getExtensionFromUrl(url),
      };
    }

    if (statusData.status === 'failed') {
      throw new Error(parseErrorMessage(statusData.error) || '图片生成失败');
    }

    await sleep(interval, signal);
  }

  throw new Error('异步图片生成超时');
}

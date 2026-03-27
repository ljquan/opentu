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
import { providerTransport } from '../provider-routing/provider-transport';

// 重新导出工具函数，方便外部使用
export { isAsyncImageModel, aspectRatioToSize };

function normalizeImageResultUrl(item: Record<string, unknown>): string | undefined {
  if (typeof item.url === 'string' && item.url) {
    return item.url;
  }

  const b64 = typeof item.b64_json === 'string' ? item.b64_json : '';
  if (!b64) {
    return undefined;
  }

  if (b64.startsWith('data:')) {
    return b64;
  }

  const mimeType =
    typeof item.mime_type === 'string' && item.mime_type
      ? item.mime_type
      : 'image/png';
  return `data:${mimeType};base64,${b64}`;
}

/**
 * 构建图片生成请求体
 */
export function buildImageRequestBody(params: ImageGenerationParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    model: params.model,
    response_format: 'url',
  };

  if (params.n && params.n > 1) {
    body.n = params.n;
  }

  if (params.size) {
    body.size = params.size;
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
export function parseImageResponse(data: Record<string, unknown>): ImageGenerationResult {
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
          throw new Error('该模型为多模态模型，未生成图片，可更换提示词明确生成图片试试');
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
  const model = params.model || config.defaultModel || 'gemini-3-pro-image-preview-vip';

  const requestBody = buildImageRequestBody({
    ...params,
    model,
  });

  const response = await providerTransport.send(
    buildProviderContextFromApiConfig(config),
    {
      path: '/images/generations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
      fetcher: fetchFn,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Image generation failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return parseImageResponse(data);
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
  const { onProgress, onSubmitted, signal, interval = 5000, maxAttempts = 1080 } = options;
  const fetchFn = config.fetchImpl || fetch;
  const baseUrl = normalizeApiBase(config.baseUrl);
  const providerContext = buildProviderContextFromApiConfig(config, baseUrl);
  const model = params.model || config.defaultModel || 'gemini-3-pro-image-preview-async';

  console.log(
    `[ImageAPI] 🚀 开始异步图片生成: model=${model}, baseUrl=${baseUrl}`
  );

  // 计算宽高比
  const aspectRatio = params.aspectRatio || sizeToAspectRatio(params.size) || '1:1';
  console.log(`[ImageAPI] 配置: aspectRatio=${aspectRatio}`);

  // 构建 FormData
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', params.prompt);
  formData.append('size', aspectRatio);

  // 处理参考图片：需要转换为 Blob
  if (params.referenceImages && params.referenceImages.length > 0) {
    console.log(`[ImageAPI] 处理 ${params.referenceImages.length} 张参考图片`);
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

  onProgress?.(5);

  console.log(`[ImageAPI] 📤 提交异步图片任务到: ${baseUrl}/v1/videos`);

  // 提交异步任务
  const submitResponse = await providerTransport.send(providerContext, {
    path: '/v1/videos',
    method: 'POST',
    body: formData,
    signal,
    fetcher: fetchFn,
  });

  console.log(`[ImageAPI] 📥 提交响应状态: ${submitResponse.status}`);

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error(`[ImageAPI] ❌ 提交失败: ${submitResponse.status} - ${errorText.substring(0, 200)}`);
    throw new Error(`Async image submit failed: ${submitResponse.status} - ${errorText}`);
  }

  const submitData: AsyncTaskSubmitResponse = await submitResponse.json();
  console.log(
    `[ImageAPI] 📋 提交结果: id=${submitData.id}, status=${submitData.status}, progress=${submitData.progress}`
  );

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
  onSubmitted?.(taskRemoteId);
  onProgress?.(10);

  console.log(`[ImageAPI] 🔄 开始轮询: remoteId=${taskRemoteId}`);

  // 轮询等待结果
  let progress = submitData.progress ?? 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error('Async image generation cancelled');
    }

    await sleep(interval, signal);

    const queryResponse = await providerTransport.send(providerContext, {
      path: `/v1/videos/${taskRemoteId}`,
      method: 'GET',
      signal,
      fetcher: fetchFn,
    });

    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      console.warn(`[ImageAPI] ⚠️ 轮询失败: attempt=${attempt + 1}, status=${queryResponse.status}`);
      throw new Error(`Async image query failed: ${queryResponse.status} - ${errorText}`);
    }

    const statusData = await queryResponse.json();
    progress = statusData.progress ?? progress;
    onProgress?.(10 + progress * 0.9); // 10% 提交 + 90% 轮询

    // 每 10 次轮询打印一次日志，避免刷屏
    if (attempt % 10 === 0) {
      console.log(
        `[ImageAPI] 🔄 轮询中: attempt=${attempt + 1}, status=${statusData.status}, progress=${progress}`
      );
    }

    if (statusData.status === 'completed') {
      const url = statusData.video_url || statusData.url;
      if (!url) {
        console.error('[ImageAPI] ❌ API 未返回有效的图片 URL');
        throw new Error('API 未返回有效的图片 URL');
      }
      console.log(`[ImageAPI] ✅ 异步图片生成完成: url=${url.substring(0, 80)}...`);
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
  const { onProgress, signal, interval = 5000, maxAttempts = 1080 } = options;
  const fetchFn = config.fetchImpl || fetch;
  const baseUrl = normalizeApiBase(config.baseUrl);
  const providerContext = buildProviderContextFromApiConfig(config, baseUrl);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error('Async image generation cancelled');
    }

    const queryResponse = await providerTransport.send(providerContext, {
      path: `/v1/videos/${remoteId}`,
      method: 'GET',
      signal,
      fetcher: fetchFn,
    });

    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      throw new Error(`Async image query failed: ${queryResponse.status} - ${errorText}`);
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

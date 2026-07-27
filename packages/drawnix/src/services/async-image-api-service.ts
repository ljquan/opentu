/**
 * Async Image API Service
 *
 * Handles async image generation for nano-banana-pro models (异步香蕉格式)。
 * 提交任务后通过轮询查询结果，返回图片下载链接。
 */

import {
  resolveInvocationRoute,
  type ModelRef,
} from '../utils/settings-manager';
import { normalizeImageDataUrl } from '@aitu/utils';
import {
  providerTransport,
  resolveInvocationPlanFromRoute,
  type ProviderAuthStrategy,
  type ResolvedProviderContext,
} from './provider-routing';
import { IMAGE_GENERATION_TIMEOUT_MS } from '../constants/TASK_CONSTANTS';

function getFileExtension(url: string): string | null {
  const pathname = url.split('?')[0] || '';
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() || null;
}

export interface AsyncImageGenerationParams {
  model: string;
  modelRef?: ModelRef | null;
  prompt: string;
  size?: string; // 接口的尺寸/比例字段（枚举 1:1、4:5 等）
  referenceImages?: string[];
  maskImage?: string;
}

export interface AsyncImageSubmitResponse {
  id: string;
  object: string;
  model: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  created_at: number;
  error?: string | { code: string; message: string };
}

export interface AsyncImageQueryResponse {
  id: string;
  object: string;
  model: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress?: number;
  created_at: number;
  video_url?: string; // 实际为图片地址，沿用接口字段
  url?: string;
  error?: string | { code: string; message: string };
}

interface PollingOptions {
  interval?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  requestId?: string;
  onProgress?: (progress: number, status: string) => void;
  onSubmitted?: (taskId: string) => void;
  routeModel?: string | ModelRef | null;
}

function getDefaultImagePollingMaxAttempts(interval: number): number {
  return Math.ceil(IMAGE_GENERATION_TIMEOUT_MS / Math.max(interval, 1));
}

function inferAuthType(
  route: ReturnType<typeof resolveInvocationRoute>
): ProviderAuthStrategy {
  return 'bearer';
}

function resolveProviderContext(
  routeModel?: string | ModelRef | null
): ResolvedProviderContext {
  const plan = resolveInvocationPlanFromRoute('image', routeModel);
  if (plan) {
    return plan.provider;
  }

  const route = resolveInvocationRoute('image', routeModel);
  return {
    profileId: route.profileId || 'runtime',
    profileName: route.profileName || 'Runtime',
    providerType: route.providerType || 'custom',
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
    authType: inferAuthType(route),
  };
}

function isLocalResolvableImage(value: string): boolean {
  return (
    value.startsWith('/__aitu_cache__/') || value.startsWith('/asset-library/')
  );
}

async function normalizeImageFormValue(value: string): Promise<string> {
  if (!isLocalResolvableImage(value)) {
    return value;
  }

  const { unifiedCacheService } = await import('./unified-cache-service');
  const imageData = await unifiedCacheService.getImageForAI(value);
  return imageData.value;
}

async function appendReferenceImage(
  formData: FormData,
  field: 'input_reference' | 'mask',
  value: string,
  index: number
): Promise<void> {
  const normalized = normalizeImageDataUrl(
    await normalizeImageFormValue(value)
  );
  try {
    const match = normalized.match(/^data:([^;,]+)?;base64,(.*)$/);
    if (match) {
      const mimeType = match[1] || 'image/png';
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      formData.append(
        field,
        new Blob([bytes], { type: mimeType }),
        field === 'mask' ? 'mask.png' : `reference-${index + 1}.png`
      );
      return;
    }
  } catch {
    // Fall back to raw value below; provider gateway can still resolve URLs.
  }

  formData.append(field, normalized);
}

class AsyncImageAPIService {
  private async submit(
    params: AsyncImageGenerationParams,
    signal?: AbortSignal,
    requestId?: string
  ): Promise<AsyncImageSubmitResponse> {
    const providerContext = resolveProviderContext(
      params.modelRef || params.model
    );

    if (!providerContext.apiKey) {
      throw new Error('API Key 未配置');
    }

    const formData = new FormData();
    formData.append('model', params.model);
    formData.append('prompt', params.prompt);
    if (params.size) {
      formData.append('size', params.size);
    }
    if (params.referenceImages?.length) {
      for (const [index, referenceImage] of params.referenceImages.entries()) {
        await appendReferenceImage(
          formData,
          'input_reference',
          referenceImage,
          index
        );
      }
    }
    if (params.maskImage) {
      await appendReferenceImage(formData, 'mask', params.maskImage, 0);
    }

    const response = await providerTransport.send(providerContext, {
      path: '/videos',
      method: 'POST',
      requestId,
      body: formData,
      signal,
      timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(
        `图片任务提交失败: ${response.status} - ${errorText}`
      );
      (error as any).apiErrorBody = errorText;
      (error as any).httpStatus = response.status;
      throw error;
    }

    return response.json();
  }

  private async query(
    id: string,
    routeModel?: string | ModelRef | null,
    signal?: AbortSignal
  ): Promise<AsyncImageQueryResponse> {
    const providerContext = resolveProviderContext(routeModel);

    if (!providerContext.apiKey) {
      throw new Error('API Key 未配置');
    }

    const response = await providerTransport.send(providerContext, {
      path: `/videos/${id}`,
      method: 'GET',
      signal,
      timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(
        `图片任务查询失败: ${response.status} - ${errorText}`
      );
      (error as any).apiErrorBody = errorText;
      (error as any).httpStatus = response.status;
      throw error;
    }

    return response.json();
  }

  async generateWithPolling(
    params: AsyncImageGenerationParams,
    options: PollingOptions = {}
  ): Promise<AsyncImageQueryResponse> {
    const {
      interval = 5000,
      maxAttempts,
      signal,
      requestId,
      onProgress,
      onSubmitted,
    } = options;
    const maxPollingAttempts =
      maxAttempts ?? getDefaultImagePollingMaxAttempts(interval);

    const submitResp = await this.submit(params, signal, requestId);

    if (onSubmitted) {
      onSubmitted(submitResp.id);
    }

    if (onProgress) {
      onProgress(submitResp.progress ?? 0, submitResp.status);
    }

    if (submitResp.status === 'failed') {
      const message =
        typeof submitResp.error === 'string'
          ? submitResp.error
          : (submitResp.error as any)?.message || '图片生成失败';
      throw new Error(message);
    }

    return this.pollUntilComplete(submitResp.id, {
      interval,
      maxAttempts: maxPollingAttempts,
      signal,
      onProgress,
      routeModel: params.modelRef || params.model,
    });
  }

  async resumePolling(
    id: string,
    options: PollingOptions = {}
  ): Promise<AsyncImageQueryResponse> {
    const { onProgress } = options;

    const immediate = await this.query(id, options.routeModel, options.signal);
    const immediateProgress =
      immediate.progress ??
      (immediate.status === 'failed'
        ? 100
        : immediate.status === 'completed'
        ? 100
        : 0);

    if (onProgress) {
      onProgress(immediateProgress, immediate.status);
    }

    if (immediate.status === 'completed') {
      return immediate;
    }

    if (immediate.status === 'failed') {
      const message =
        typeof immediate.error === 'string'
          ? immediate.error
          : (immediate.error as any)?.message || '图片生成失败';
      throw new Error(message);
    }

    return this.pollUntilComplete(id, options);
  }

  private async pollUntilComplete(
    id: string,
    options: PollingOptions = {}
  ): Promise<AsyncImageQueryResponse> {
    const {
      interval = 5000,
      maxAttempts,
      signal,
      onProgress,
      routeModel,
    } = options;
    const maxPollingAttempts =
      maxAttempts ?? getDefaultImagePollingMaxAttempts(interval);

    let attempts = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 10;

    while (attempts < maxPollingAttempts) {
      if (signal?.aborted) {
        throw new Error('Async image generation cancelled');
      }

      await this.sleep(interval, signal);
      attempts += 1;

      try {
        const status = await this.query(id, routeModel, signal);
        const progress =
          status.progress ??
          (status.status === 'failed'
            ? 100
            : status.status === 'completed'
            ? 100
            : 0);

        if (onProgress) {
          onProgress(progress, status.status);
        }

        if (status.status === 'completed') {
          return status;
        }

        if (status.status === 'failed') {
          const message =
            typeof status.error === 'string'
              ? status.error
              : (status.error as any)?.message || '图片生成失败';
          const err = new Error(message);
          (err as any).isTaskFailed = true;
          throw err;
        }

        consecutiveErrors = 0; // reset on success
      } catch (error: any) {
        if (error?.isTaskFailed) {
          throw error;
        }
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw error;
        }
      }
    }

    throw new Error('图片生成超时');
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Async image generation cancelled'));
        return;
      }

      let timeoutId: ReturnType<typeof setTimeout>;
      const onAbort = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('Async image generation cancelled'));
      };

      timeoutId = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * 辅助：从结果中提取最终图片 URL 和格式
   */
  extractUrlAndFormat(result: AsyncImageQueryResponse): {
    url: string;
    format: string;
  } {
    const url = result.video_url || result.url;
    if (!url) {
      throw new Error('API 未返回有效的图片 URL');
    }
    const format = getFileExtension(url) || 'jpg';
    return { url, format };
  }
}

export const asyncImageAPIService = new AsyncImageAPIService();

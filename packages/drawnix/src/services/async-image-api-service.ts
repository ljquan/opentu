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
import {
  providerTransport,
  resolveInvocationPlanFromRoute,
  type ProviderAuthStrategy,
  type ResolvedProviderContext,
} from './provider-routing';

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
  // TODO: 支持参考图/多图提交，如有需求可补充 input_reference
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
  onProgress?: (progress: number, status: string) => void;
  onSubmitted?: (taskId: string) => void;
  routeModel?: string | ModelRef | null;
}

function inferAuthType(route: ReturnType<typeof resolveInvocationRoute>): ProviderAuthStrategy {
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

class AsyncImageAPIService {
  private async submit(
    params: AsyncImageGenerationParams
  ): Promise<AsyncImageSubmitResponse> {
    const providerContext = resolveProviderContext(params.modelRef || params.model);

    if (!providerContext.apiKey) {
      throw new Error('API Key 未配置');
    }

    const formData = new FormData();
    formData.append('model', params.model);
    formData.append('prompt', params.prompt);
    if (params.size) {
      formData.append('size', params.size);
    }

    const response = await providerTransport.send(providerContext, {
      path: '/videos',
      method: 'POST',
      body: formData,
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
    routeModel?: string | ModelRef | null
  ): Promise<AsyncImageQueryResponse> {
    const providerContext = resolveProviderContext(routeModel);

    if (!providerContext.apiKey) {
      throw new Error('API Key 未配置');
    }

    const response = await providerTransport.send(providerContext, {
      path: `/videos/${id}`,
      method: 'GET',
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
      maxAttempts = 1080,
      onProgress,
      onSubmitted,
    } = options;

    const submitResp = await this.submit(params);

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
      maxAttempts,
      onProgress,
      routeModel: params.modelRef || params.model,
    });
  }

  async resumePolling(
    id: string,
    options: PollingOptions = {}
  ): Promise<AsyncImageQueryResponse> {
    const { onProgress } = options;

    const immediate = await this.query(id, options.routeModel);
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

    if (immediate.status === 'completed' || immediate.status === 'failed') {
      return immediate;
    }

    return this.pollUntilComplete(id, options);
  }

  private async pollUntilComplete(
    id: string,
    options: PollingOptions = {}
  ): Promise<AsyncImageQueryResponse> {
    const {
      interval = 5000,
      maxAttempts = 1080,
      onProgress,
      routeModel,
    } = options;

    let attempts = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 10;

    while (attempts < maxAttempts) {
      await this.sleep(interval);
      attempts += 1;

      try {
        const status = await this.query(id, routeModel);
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
          throw new Error(message);
        }

        consecutiveErrors = 0; // reset on success
      } catch (error) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw error;
        }
      }
    }

    throw new Error('图片生成超时');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

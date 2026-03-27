/**
 * Video API Service
 *
 * Handles video generation API calls with async polling support.
 * Uses tu-zi API for video generation.
 */

import {
  providerTransport,
  resolveInvocationPlanFromRoute,
  type ProviderModelBinding,
  type ProviderAuthStrategy,
  type ResolvedProviderContext,
} from './provider-routing';
import {
  resolveInvocationRoute,
  type ModelRef,
} from '../utils/settings-manager';
import type { VideoModel, UploadedVideoImage } from '../types/video.types';
import { unifiedCacheService } from './unified-cache-service';
import {
  startLLMApiLog,
  completeLLMApiLog,
  failLLMApiLog,
  updateLLMApiLogMetadata,
} from './media-executor/llm-api-logger';
import {
  downloadVideoContentToLocalUrl,
  extractInlineVideoUrl,
  resolveVideoSubmission,
  shouldDownloadVideoContent,
} from './video-binding-utils';
import { prepareVideoReferenceImageBlob } from './video-reference-image-utils';

// Re-export VideoModel for backward compatibility
export type { VideoModel };

// Video generation request params
export interface VideoGenerationParams {
  model: VideoModel;
  modelRef?: ModelRef | null;
  prompt: string;
  seconds?: string;
  size?: string;
  params?: Record<string, unknown>;
  // Multiple images support for different models
  inputReferences?: UploadedVideoImage[];
  // Legacy single image support (for backward compatibility)
  inputReference?: string;
}

// Video generation response (submit)
export interface VideoSubmitResponse {
  id: string;
  object: string;
  model: string;
  status:
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'succeeded'
    | 'error';
  progress: number;
  created_at: number;
  seconds: string;
  size?: string;
  error?: string | { code: string; message: string };
}

// Video query response
export interface VideoQueryResponse {
  id: string;
  size: string;
  model: string;
  object: string;
  status:
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'succeeded'
    | 'error';
  seconds: string;
  progress?: number; // Optional - API may not return progress when status is 'queued'
  video_url?: string;
  url?: string;
  created_at: number;
  error?: string | { code: string; message: string };
}

// Polling options
interface PollingOptions {
  interval?: number; // Polling interval in ms (default: 5000)
  maxAttempts?: number; // Max polling attempts (default: 1080 = 90min at 5s interval)
  onProgress?: (progress: number, status: string) => void;
  onSubmitted?: (videoId: string) => void; // Callback when video is submitted (for saving remoteId)
  routeModel?: string | ModelRef | null;
}

function inferAuthType(
  route: ReturnType<typeof resolveInvocationRoute>
): ProviderAuthStrategy {
  return 'bearer';
}

function resolveProviderContext(
  routeModel?: string | ModelRef | null
): ResolvedProviderContext {
  const plan = resolveInvocationPlanFromRoute('video', routeModel);
  if (plan) {
    return plan.provider;
  }

  const route = resolveInvocationRoute('video', routeModel);
  return {
    profileId: route.profileId || 'runtime',
    profileName: route.profileName || 'Runtime',
    providerType: route.providerType || 'custom',
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
    authType: inferAuthType(route),
  };
}

function resolveVideoPlanContext(routeModel?: string | ModelRef | null): {
  providerContext: ResolvedProviderContext;
  binding: ProviderModelBinding | null;
} {
  const plan = resolveInvocationPlanFromRoute('video', routeModel);
  return {
    providerContext: plan?.provider || resolveProviderContext(routeModel),
    binding: plan?.binding || null,
  };
}

/**
 * Video API Service
 * Manages video generation with async polling
 */
class VideoAPIService {
  /**
   * Submit video generation task
   */
  async submitVideoGeneration(
    params: VideoGenerationParams
  ): Promise<VideoSubmitResponse> {
    const { providerContext, binding } = resolveVideoPlanContext(
      params.modelRef || params.model
    );
    const startTime = Date.now();

    if (!providerContext.apiKey) {
      throw new Error('API Key 未配置，请先配置 API Key');
    }

    // 开始记录 LLM API 调用（降级模式直接调用）
    const referenceCount =
      params.inputReferences?.length || (params.inputReference ? 1 : 0);
    const logId = startLLMApiLog({
      endpoint: '/v1/videos',
      model: params.model,
      taskType: 'video',
      prompt: params.prompt,
      hasReferenceImages: referenceCount > 0,
      referenceImageCount: referenceCount,
    });

    const submission = resolveVideoSubmission(
      params.model,
      params.seconds,
      binding,
      params.params as Record<string, string> | undefined
    );

    const formData = new FormData();
    formData.append('model', submission.model);
    formData.append('prompt', params.prompt);

    if (submission.duration) {
      formData.append(submission.durationField, submission.duration);
    }

    if (params.size) {
      formData.append('size', params.size);
    }

    // Handle multiple images - all models use input_reference
    // For veo3.1, multiple images can be passed with same field name (first frame, last frame)
    // console.log('[VideoAPI] Processing inputReferences:', params.inputReferences);
    if (params.inputReferences && params.inputReferences.length > 0) {
      // Sort by slot to ensure correct order (slot 0 = first frame, slot 1 = last frame)
      const sortedImages = [...params.inputReferences].sort(
        (a, b) => a.slot - b.slot
      );

      for (const imageRef of sortedImages) {
        // console.log('[VideoAPI] Processing image:', { slot: imageRef.slot, url: imageRef.url?.substring(0, 50), name: imageRef.name });

        if (!imageRef.url) {
          // console.log('[VideoAPI] Skipping image - no URL');
          continue;
        }

        const fieldName = 'input_reference';
        // console.log('[VideoAPI] Using field name:', fieldName, 'for model:', params.model, 'slot:', imageRef.slot);

        // 处理图片：虚拟路径和远程 URL 都需要转换为 base64/blob
        // 使用 getImageForAI 统一处理，它会自动处理虚拟路径和远程 URL
        const imageData = await unifiedCacheService.getImageForAI(imageRef.url);
        const processedUrl = imageData.value;
        // console.log(`[VideoAPI] Image processed: ${imageData.type === 'base64' ? 'converted to base64' : 'using URL'}`);

        // Convert to blob and append
        if (processedUrl.startsWith('data:')) {
          // console.log('[VideoAPI] Converting data URL to blob...');
          const response = await fetch(processedUrl);
          const blob = await prepareVideoReferenceImageBlob(
            await response.blob(),
            params.size
          );
          // console.log('[VideoAPI] Appending blob:', { fieldName, blobSize: blob.size, fileName: imageRef.name || 'image.png' });
          formData.append(fieldName, blob, imageRef.name || 'image.png');
        } else if (processedUrl.startsWith('http')) {
          // console.log('[VideoAPI] Fetching remote URL...');
          const response = await fetch(processedUrl);
          const blob = await prepareVideoReferenceImageBlob(
            await response.blob(),
            params.size
          );
          // console.log('[VideoAPI] Appending blob:', { fieldName, blobSize: blob.size, fileName: imageRef.name || 'image.png' });
          formData.append(fieldName, blob, imageRef.name || 'image.png');
        } else {
          console.warn(
            '[VideoAPI] Unknown URL format after processing, skipping:',
            processedUrl?.substring(0, 50)
          );
        }
      }
    }
    // Legacy single image support
    else if (params.inputReference) {
      // 处理图片：虚拟路径和远程 URL 都需要转换为 base64/blob
      // 使用 getImageForAI 统一处理，它会自动处理虚拟路径和远程 URL
      const imageData = await unifiedCacheService.getImageForAI(
        params.inputReference
      );
      const processedUrl = imageData.value;
      // console.log(`[VideoAPI] Legacy image processed: ${imageData.type === 'base64' ? 'converted to base64' : 'using URL'}`);

      if (processedUrl.startsWith('data:')) {
        const response = await fetch(processedUrl);
        const blob = await prepareVideoReferenceImageBlob(
          await response.blob(),
          params.size
        );
        formData.append('input_reference', blob, 'reference.png');
      } else if (processedUrl.startsWith('http')) {
        const response = await fetch(processedUrl);
        const blob = await prepareVideoReferenceImageBlob(
          await response.blob(),
          params.size
        );
        formData.append('input_reference', blob, 'reference.png');
      } else {
        console.warn(
          '[VideoAPI] Unknown URL format after processing, skipping:',
          processedUrl?.substring(0, 50)
        );
      }
    }

    // Log FormData summary before sending
    // console.log('[VideoAPI] FormData summary:');
    const formDataEntries: Record<string, string> = {};
    formData.forEach((value, key) => {
      if (value instanceof Blob) {
        formDataEntries[
          key
        ] = `[Blob: ${value.size} bytes, type: ${value.type}]`;
      } else {
        formDataEntries[key] = String(value);
      }
    });
    // console.log('[VideoAPI] FormData entries:', formDataEntries);
    // console.log('[VideoAPI] Sending request to:', `${this.baseUrl}/v1/videos`);

    const response = await providerTransport.send(providerContext, {
      path: '/videos',
      baseUrlStrategy: binding?.baseUrlStrategy,
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[VideoAPI] Submit failed:', response.status, errorText);
      const duration = Date.now() - startTime;
      failLLMApiLog(logId, {
        httpStatus: response.status,
        duration,
        errorMessage: errorText.substring(0, 500),
      });
      const error = new Error(
        `视频生成提交失败: ${response.status} - ${errorText}`
      );
      (error as any).apiErrorBody = errorText;
      (error as any).httpStatus = response.status;
      throw error;
    }

    const result = await response.json();
    const duration = Date.now() - startTime;

    // 记录视频提交成功（此时视频尚未生成完成，只是提交成功）
    // 使用 updateLLMApiLogMetadata 更新 remoteId，保持 pending 状态
    updateLLMApiLogMetadata(logId, {
      remoteId: result.id,
      httpStatus: response.status,
    });

    // 如果提交时已经失败（如内容政策违规）
    if (result.status === 'failed') {
      const errorMessage =
        typeof result.error === 'string'
          ? result.error
          : result.error?.message || 'Video generation failed';
      failLLMApiLog(logId, {
        httpStatus: response.status,
        duration,
        errorMessage,
      });
    } else {
      // 提交成功，但视频还在生成中，记录为成功（API 调用成功）
      completeLLMApiLog(logId, {
        httpStatus: response.status,
        duration,
        resultType: 'video',
        remoteId: result.id,
      });
    }

    // console.log('[VideoAPI] Submit response:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Query video generation status (with network retry)
   */
  async queryVideoStatus(
    videoId: string,
    routeModel?: string | ModelRef | null
  ): Promise<VideoQueryResponse> {
    const { providerContext, binding } = resolveVideoPlanContext(routeModel);

    if (!providerContext.apiKey) {
      throw new Error('API Key 未配置');
    }

    const response = await providerTransport.send(providerContext, {
      path: `/videos/${videoId}`,
      baseUrlStrategy: binding?.baseUrlStrategy,
      method: 'GET',
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[VideoAPI] Query failed:', response.status, errorText);
      const error = new Error(
        `视频状态查询失败: ${response.status} - ${errorText}`
      );
      (error as any).apiErrorBody = errorText;
      (error as any).httpStatus = response.status;
      throw error;
    }

    const result = await response.json();
    // console.log('[VideoAPI] Query response:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Generate video with polling
   * Submits task and polls until completion
   */
  async generateVideoWithPolling(
    params: VideoGenerationParams,
    options: PollingOptions = {}
  ): Promise<VideoQueryResponse> {
    const {
      interval = 5000,
      maxAttempts = 1080,
      onProgress,
      onSubmitted,
    } = options;

    // Submit video generation task
    // console.log('[VideoAPI] Submitting video generation task...');
    const submitResponse = await this.submitVideoGeneration(params);
    // console.log('[VideoAPI] Task submitted:', submitResponse.id, 'Status:', submitResponse.status);

    // Notify that video has been submitted (for saving remoteId)
    if (onSubmitted) {
      onSubmitted(submitResponse.id);
    }

    // Report initial progress
    if (onProgress) {
      onProgress(0, submitResponse.status);
    }

    // Check if submission already failed (e.g., content policy violation)
    if (submitResponse.status === 'failed') {
      let errorMessage = '视频生成失败';
      if (submitResponse.error) {
        if (typeof submitResponse.error === 'string') {
          errorMessage = submitResponse.error;
        } else if (typeof submitResponse.error === 'object') {
          errorMessage =
            (submitResponse.error as any).message ||
            JSON.stringify(submitResponse.error);
        }
      }
      throw new Error(errorMessage);
    }

    // Continue with polling
    return this.pollUntilComplete(submitResponse.id, {
      interval,
      maxAttempts,
      onProgress,
      routeModel: params.modelRef || params.model,
    });
  }

  /**
   * Resume polling for an existing video task
   * Used to recover from page refresh
   */
  async resumePolling(
    videoId: string,
    options: PollingOptions = {}
  ): Promise<VideoQueryResponse> {
    // console.log('[VideoAPI] Resuming polling for video:', videoId);

    const { onProgress } = options;

    // For resumed tasks, check status immediately first (video may already be completed)
    // console.log('[VideoAPI] Checking status immediately for resumed task...');
    const immediateStatus = await this.queryVideoStatus(
      videoId,
      options.routeModel
    );
    const immediateProgress =
      immediateStatus.progress ??
      (immediateStatus.status === 'failed'
        ? 100
        : immediateStatus.status === 'completed'
        ? 100
        : 0);
    // console.log(`[VideoAPI] Immediate check: Status=${immediateStatus.status}, Progress=${immediateProgress}%`);

    // Report progress
    if (onProgress) {
      onProgress(immediateProgress, immediateStatus.status);
    }

    // If already completed, return immediately
    if (
      immediateStatus.status === 'completed' ||
      immediateStatus.status === 'succeeded'
    ) {
      return this.resolveCompletedVideoStatus(
        videoId,
        immediateStatus,
        options.routeModel
      );
    }

    // If already failed, throw error immediately
    if (immediateStatus.status === 'failed') {
      let errorMessage = '视频生成失败';
      if (immediateStatus.error) {
        if (typeof immediateStatus.error === 'string') {
          errorMessage = immediateStatus.error;
        } else if (typeof immediateStatus.error === 'object') {
          errorMessage =
            (immediateStatus.error as any).message ||
            JSON.stringify(immediateStatus.error);
        }
      }
      throw new Error(errorMessage);
    }

    // Continue polling if still in progress
    return this.pollUntilComplete(videoId, options);
  }

  /**
   * Poll for video completion
   * @private
   */
  private async pollUntilComplete(
    videoId: string,
    options: PollingOptions = {}
  ): Promise<VideoQueryResponse> {
    const { interval = 5000, maxAttempts = 1080, onProgress } = options;

    let attempts = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 10; // 连续错误超过此数才放弃

    // Poll for completion
    while (attempts < maxAttempts) {
      await this.sleep(interval);
      attempts++;

      // Flag to track if this is a business failure (should not retry)
      let isBusinessFailure = false;

      try {
        const status = await this.queryVideoStatus(videoId, options.routeModel);

        // 请求成功，重置连续错误计数
        consecutiveErrors = 0;

        // Determine progress based on status and API response
        // - If API returns progress, use it
        // - If status is 'failed', show 100% to indicate task has ended
        // - Otherwise default to 0 (e.g., when status is 'queued')
        const progress =
          status.progress ?? (status.status === 'failed' ? 100 : 0);
        // console.log(`[VideoAPI] Poll ${attempts}: Status=${status.status}, Progress=${progress}%`);

        // Report progress
        if (onProgress) {
          onProgress(progress, status.status);
        }

        if (status.status === 'completed' || status.status === 'succeeded') {
          return this.resolveCompletedVideoStatus(
            videoId,
            status,
            options.routeModel
          );
        }

        if (status.status === 'failed') {
          // Handle error - extract message if error is an object
          let errorMessage = '视频生成失败';
          if (status.error) {
            if (typeof status.error === 'string') {
              errorMessage = status.error;
            } else if (typeof status.error === 'object') {
              // Error is an object, extract message
              errorMessage =
                (status.error as any).message || JSON.stringify(status.error);
            }
          }
          // Mark as business failure so it won't be retried
          isBusinessFailure = true;
          throw new Error(errorMessage);
        }
      } catch (err: any) {
        // 业务失败（API 返回 status: failed）不应重试，直接抛出
        if (isBusinessFailure) {
          throw err;
        }

        // 轮询接口临时错误（网络错误），增加间隔继续重试
        consecutiveErrors++;
        console.warn(
          `[VideoAPI] Status query failed, attempt ${consecutiveErrors}/${maxConsecutiveErrors}:`,
          err?.message || err
        );

        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw err;
        }

        // 根据连续错误次数增加等待时间（指数退避，最大 60 秒）
        const backoffInterval = Math.min(
          interval * Math.pow(1.5, consecutiveErrors),
          60000
        );
        await this.sleep(backoffInterval - interval); // 减去已等待的 interval
      }
    }

    throw new Error('视频生成超时，请稍后重试');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async resolveCompletedVideoStatus(
    videoId: string,
    status: VideoQueryResponse,
    routeModel?: string | ModelRef | null
  ): Promise<VideoQueryResponse> {
    const { providerContext, binding } = resolveVideoPlanContext(
      routeModel || status.model
    );
    const inlineUrl = extractInlineVideoUrl(status as Record<string, any>);

    if (
      !shouldDownloadVideoContent(
        status.model,
        binding,
        status as Record<string, any>
      )
    ) {
      return inlineUrl ? { ...status, url: inlineUrl } : status;
    }

    const localUrl = await downloadVideoContentToLocalUrl({
      videoId,
      provider: providerContext,
      binding,
      modelId: status.model,
      cacheKey: videoId,
    });

    return {
      ...status,
      url: localUrl,
      video_url: localUrl,
    };
  }
}

// Export singleton instance
export const videoAPIService = new VideoAPIService();

/**
 * Media Executor (Main Thread)
 *
 * 主线程媒体执行器，直接调用 API 并将结果写入 IndexedDB。
 * 所有 LLM API 请求在主线程直接发起（不经过 Service Worker）。
 */

import type {
  IMediaExecutor,
  ImageGenerationParams,
  VideoGenerationParams,
  AIAnalyzeParams,
  AIAnalyzeResult,
  ExecutionOptions,
  GeminiConfig,
  VideoAPIConfig,
} from './types';
import { Task, TaskStatus } from '../../types/task.types';
import { taskStorageWriter } from './task-storage-writer';
import { taskStorageReader } from '../task-storage-reader';
import {
  resolveInvocationRoute,
  type ModelRef,
} from '../../utils/settings-manager';
import {
  providerTransport,
  resolveInvocationPlanFromRoute,
  type ProviderAuthStrategy,
  type ResolvedProviderContext,
} from '../provider-routing';
import {
  startLLMApiLog,
  completeLLMApiLog,
  failLLMApiLog,
  updateLLMApiLogMetadata,
  LLMReferenceImage,
} from './llm-api-logger';
import { callApiWithRetry } from '../../utils/gemini-api/apiCalls';
import type { GeminiMessage as UnifiedGeminiMessage } from '../../utils/gemini-api/types';
import {
  isAuthError,
  dispatchApiAuthError,
} from '../../utils/api-auth-error-event';
import { extractTextContent, parseToolCalls } from '../agent/tool-parser';
import { unifiedCacheService } from '../unified-cache-service';
import { submitVideoGeneration } from '../media-api';
import {
  extractPromptFromMessages,
  buildImageRequestBody,
  parseImageResponse,
  pollVideoStatus,
  isAsyncImageModel,
  generateAsyncImage,
  ensureBase64ForAI,
  cacheRemoteUrl,
  cacheRemoteUrls,
} from './fallback-utils';
import { resolveAdapterForInvocation } from '../model-adapters';
import {
  executeImageViaAdapter,
  executeVideoViaAdapter,
} from './fallback-adapter-routes';

function inferAuthTypeFromRoute(
  route: ReturnType<typeof resolveInvocationRoute>
): ProviderAuthStrategy {
  return 'bearer';
}

function buildProviderContext(config: {
  apiKey: string;
  baseUrl: string;
  authType?: ProviderAuthStrategy;
  providerType?: string;
  extraHeaders?: Record<string, string>;
  provider?: ResolvedProviderContext | null;
}): ResolvedProviderContext {
  return (
    config.provider || {
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: config.providerType || 'custom',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      authType: config.authType || 'bearer',
      extraHeaders: config.extraHeaders,
    }
  );
}

/** 从 uploadedImages 提取 URL 列表，与 SW ImageHandler 逻辑一致 */
function extractUrlsFromUploadedImages(
  uploadedImages: unknown
): string[] | undefined {
  if (!uploadedImages || !Array.isArray(uploadedImages)) return undefined;
  const urls = (uploadedImages as Array<{ url?: string }>)
    .filter(
      (img) => img && typeof img === 'object' && typeof img.url === 'string'
    )
    .map((img) => img.url as string);
  return urls.length > 0 ? urls : undefined;
}

/**
 * 主线程媒体执行器
 *
 * 在主线程直接执行媒体生成任务，所有 API 请求使用原生 fetch。
 * 页面刷新会中断任务执行，通过 beforeunload 提示用户保护。
 */
export class FallbackMediaExecutor implements IMediaExecutor {
  readonly name = 'FallbackMediaExecutor';

  /**
   * 正在轮询的任务 ID 集合
   * 用于防止同一个任务被重复轮询（例如 resumePendingTasks 被多次调用时）
   */
  private pollingTasks = new Set<string>();

  /**
   * 降级执行器始终可用（只要浏览器支持 fetch）
   */
  async isAvailable(): Promise<boolean> {
    return typeof fetch === 'function';
  }

  /**
   * 生成图片
   * 参考图逻辑与 SW ImageHandler 对齐：支持 referenceImages 与 uploadedImages
   */
  async generateImage(
    params: ImageGenerationParams,
    options?: ExecutionOptions
  ): Promise<void> {
    const {
      taskId,
      prompt,
      model,
      modelRef,
      size,
      quality,
      count = 1,
    } = params;
    const referenceImages =
      (params.referenceImages && params.referenceImages.length > 0
        ? params.referenceImages
        : undefined) || extractUrlsFromUploadedImages(params.uploadedImages);

    const config = this.getConfig({ imageModel: modelRef || model });

    // 更新任务状态为 processing
    await taskStorageWriter.updateStatus(taskId, 'processing');
    options?.onProgress?.({ progress: 0, phase: 'submitting' });

    const startTime = Date.now();
    const modelName = model || config.imageConfig.modelName;

    // 专用 adapter 路由（mj-imagine 等非 gemini 模型）
    const imageAdapter = resolveAdapterForInvocation(
      'image',
      modelName,
      modelRef || null
    );
    if (imageAdapter && imageAdapter.kind === 'image') {
      return executeImageViaAdapter(
        taskId,
        imageAdapter,
        {
          prompt,
          model: modelName,
          modelRef: modelRef || null,
          size,
          quality,
          count,
          referenceImages,
          params: params.params,
        },
        options,
        startTime
      );
    }

    // 异步图片模型：使用 /v1/videos 接口（与 SW 模式一致）
    if (isAsyncImageModel(modelName)) {
      return this.generateAsyncImageTask(
        taskId,
        { prompt, model: modelName, size, referenceImages },
        config,
        options,
        startTime
      );
    }

    // 开始记录 LLM API 调用
    const logId = startLLMApiLog({
      endpoint: '/images/generations',
      model: modelName,
      taskType: 'image',
      prompt,
      hasReferenceImages: !!referenceImages && referenceImages.length > 0,
      referenceImageCount: referenceImages?.length,
      referenceImages: referenceImages?.map(
        (url) => ({ url, size: 0, width: 0, height: 0 } as LLMReferenceImage)
      ),
      taskId,
    });

    try {
      // 处理参考图片：统一转为 base64（API 要求），并行处理提升性能
      let processedImages: string[] | undefined;
      if (referenceImages && referenceImages.length > 0) {
        const t0 = performance.now();
        processedImages = await Promise.all(
          referenceImages.map(async (imgUrl) => {
            const imageData = await unifiedCacheService.getImageForAI(imgUrl);
            return ensureBase64ForAI(imageData, options?.signal);
          })
        );
        console.debug(
          '[FallbackMediaExecutor] generateImage: base64 conversion took',
          Math.round(performance.now() - t0),
          'ms for',
          referenceImages.length,
          'images, taskId:',
          taskId
        );
      }

      // 构建请求体
      const requestBody = buildImageRequestBody({
        prompt,
        model: modelName,
        size,
        referenceImages: processedImages,
        quality,
        n: Math.min(Math.max(1, count), 10),
      });

      options?.onProgress?.({ progress: 10, phase: 'submitting' });

      // 直接调用 API
      const response = await providerTransport.send(
        buildProviderContext(config.imageConfig),
        {
          path: '/images/generations',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: options?.signal,
        }
      );

      if (!response.ok) {
        const duration = Date.now() - startTime;
        const errorBody = await response
          .text()
          .catch(
            () => `HTTP ${response.status} ${response.statusText || 'Error'}`
          );
        failLLMApiLog(logId, {
          httpStatus: response.status,
          duration,
          errorMessage: errorBody.substring(0, 500),
        });
        throw new Error(
          `Image generation failed: ${response.status} - ${errorBody.substring(
            0,
            200
          )}`
        );
      }

      options?.onProgress?.({ progress: 80, phase: 'downloading' });

      const data = await response.json();
      const result = parseImageResponse(data);
      const duration = Date.now() - startTime;

      console.debug(
        '[FallbackMediaExecutor] generateImage: success, duration:',
        duration,
        'ms, taskId:',
        taskId
      );

      // 记录成功
      completeLLMApiLog(logId, {
        httpStatus: response.status,
        duration,
        resultType: 'image',
        resultCount: 1,
        resultUrl: result.url,
      });

      options?.onProgress?.({ progress: 100 });

      // 缓存远程 URL 到本地，避免签名 URL 的 Referer 校验问题
      const allImgUrls = result.urls?.length ? result.urls : [result.url];
      const cachedImgUrls = await cacheRemoteUrls(
        allImgUrls,
        taskId,
        'image',
        'png'
      );

      // 完成任务
      await taskStorageWriter.completeTask(taskId, {
        url: cachedImgUrls[0],
        urls: cachedImgUrls.length > 1 ? cachedImgUrls : undefined,
        format: 'png',
        size: 0,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMessage = error.message || 'Image generation failed';
      console.error(
        '[FallbackMediaExecutor] generateImage failed:',
        errorMessage,
        'taskId:',
        taskId,
        'duration:',
        duration,
        'ms'
      );

      // 检测认证错误，触发设置弹窗
      if (isAuthError(errorMessage)) {
        dispatchApiAuthError({ message: errorMessage, source: 'image' });
      }

      // 如果日志还未更新为失败，更新它
      failLLMApiLog(logId, {
        duration,
        errorMessage,
      });
      await taskStorageWriter.failTask(taskId, {
        code: 'IMAGE_GENERATION_ERROR',
        message: errorMessage,
      });
      throw error;
    }
  }

  /**
   * 生成异步图片（使用 /v1/videos 接口）
   * 与 SW 模式保持一致的实现
   */
  private async generateAsyncImageTask(
    taskId: string,
    params: {
      prompt: string;
      model: string;
      size?: string;
      referenceImages?: string[];
    },
    config: { imageConfig: GeminiConfig; videoConfig: VideoAPIConfig },
    options?: ExecutionOptions,
    startTime?: number
  ): Promise<void> {
    const logStartTime = startTime || Date.now();

    // 开始记录 LLM API 调用
    const logId = startLLMApiLog({
      endpoint: '/v1/videos (async image)',
      model: params.model,
      taskType: 'image',
      prompt: params.prompt,
      hasReferenceImages:
        params.referenceImages && params.referenceImages.length > 0,
      referenceImageCount: params.referenceImages?.length,
      referenceImages: params.referenceImages?.map(
        (url) => ({ url, size: 0, width: 0, height: 0 } as LLMReferenceImage)
      ),
      taskId,
    });

    try {
      // 处理参考图片：统一转为 base64（与同步路径一致），并行处理
      let processedImages: string[] | undefined;
      if (params.referenceImages && params.referenceImages.length > 0) {
        const t0 = performance.now();
        processedImages = await Promise.all(
          params.referenceImages.map(async (imgUrl) => {
            const imageData = await unifiedCacheService.getImageForAI(imgUrl);
            return ensureBase64ForAI(imageData, options?.signal);
          })
        );
        console.debug(
          '[FallbackMediaExecutor] generateAsyncImage: base64 conversion took',
          Math.round(performance.now() - t0),
          'ms for',
          params.referenceImages.length,
          'images, taskId:',
          taskId
        );
      }

      // 调用异步图片生成
      const result = await generateAsyncImage(
        {
          prompt: params.prompt,
          model: params.model,
          size: params.size,
          referenceImages: processedImages,
        },
        config.imageConfig,
        {
          onProgress: (progress) => {
            options?.onProgress?.({
              progress,
              phase: progress < 10 ? 'submitting' : 'polling',
            });
          },
          onSubmitted: async (remoteId) => {
            // 保存 remoteId，用于页面刷新后恢复轮询
            await taskStorageWriter.updateRemoteId(taskId, remoteId);
          },
          signal: options?.signal,
        }
      );

      const duration = Date.now() - logStartTime;

      // 记录成功
      completeLLMApiLog(logId, {
        httpStatus: 200,
        duration,
        resultType: 'image',
        resultCount: 1,
        resultUrl: result.url,
      });

      options?.onProgress?.({ progress: 100 });

      // 缓存远程 URL 到本地
      const cachedAsyncUrl = await cacheRemoteUrl(
        result.url,
        taskId,
        'image',
        result.format
      );

      // 完成任务
      await taskStorageWriter.completeTask(taskId, {
        url: cachedAsyncUrl,
        format: result.format,
        size: 0,
      });
    } catch (error: any) {
      const duration = Date.now() - logStartTime;
      const errorMessage = error.message || 'Async image generation failed';

      // 检测认证错误，触发设置弹窗
      if (isAuthError(errorMessage)) {
        dispatchApiAuthError({ message: errorMessage, source: 'async-image' });
      }

      failLLMApiLog(logId, {
        duration,
        errorMessage,
      });
      await taskStorageWriter.failTask(taskId, {
        code: 'ASYNC_IMAGE_GENERATION_ERROR',
        message: errorMessage,
      });
      throw error;
    }
  }

  /**
   * 生成视频
   * 使用共享 submitVideoGeneration，支持参考图且参考图体积控制在 1MB 内
   */
  async generateVideo(
    params: VideoGenerationParams,
    options?: ExecutionOptions
  ): Promise<void> {
    const {
      taskId,
      prompt,
      model = 'veo3',
      modelRef,
      duration,
      size = '1280x720',
    } = params;
    const config = this.getConfig({ videoModel: modelRef || model });
    const startTime = Date.now();
    const durationEncodedInModel = (m?: string | null) =>
      Boolean(m && m.startsWith('sora-2-'));
    const shouldSkipSeconds = durationEncodedInModel(model);
    const secondsToSend = shouldSkipSeconds ? undefined : duration ?? '8';

    await taskStorageWriter.updateStatus(taskId, 'processing');
    options?.onProgress?.({ progress: 0, phase: 'submitting' });

    // 专用 adapter 路由（kling 等非 gemini 模型）
    const videoAdapter = resolveAdapterForInvocation(
      'video',
      model,
      modelRef || null
    );
    if (videoAdapter && videoAdapter.kind === 'video') {
      return executeVideoViaAdapter(
        taskId,
        videoAdapter,
        {
          prompt,
          model,
          modelRef: modelRef || null,
          size,
          duration,
          referenceImages: params.referenceImages,
          inputReference: params.inputReference,
          params: params.params,
        },
        options,
        startTime
      );
    }

    // 收集参考图原始 URL（用于日志记录）
    const logRefUrls =
      (params.referenceImages && params.referenceImages.length > 0
        ? params.referenceImages
        : undefined) ||
      (params.inputReference ? [params.inputReference] : undefined);

    const logId = startLLMApiLog({
      endpoint: '/v1/videos',
      model,
      taskType: 'video',
      prompt,
      taskId,
      hasReferenceImages: !!logRefUrls && logRefUrls.length > 0,
      referenceImageCount: logRefUrls?.length,
      referenceImages: logRefUrls?.map(
        (url) => ({ url, size: 0, width: 0, height: 0 } as LLMReferenceImage)
      ),
    });

    try {
      // 参考图：虚拟路径先转为 data URL（1MB 内），再交给 submitVideoGeneration 走 FormData+压缩
      const refUrls =
        (params.referenceImages && params.referenceImages.length > 0
          ? params.referenceImages
          : undefined) ||
        (params.inputReference ? [params.inputReference] : undefined);
      let referenceImages: string[] | undefined;
      if (refUrls && refUrls.length > 0) {
        const t0 = performance.now();
        const isVirtual = (u: string) =>
          u.startsWith('/__aitu_cache__/') || u.startsWith('/asset-library/');
        referenceImages = await Promise.all(
          refUrls.map(async (url) => {
            if (isVirtual(url)) {
              const imageData = await unifiedCacheService.getImageForAI(url);
              return ensureBase64ForAI(imageData, options?.signal);
            }
            return url;
          })
        );
        console.debug(
          '[FallbackMediaExecutor] generateVideo: ref image processing took',
          Math.round(performance.now() - t0),
          'ms for',
          refUrls.length,
          'images, taskId:',
          taskId
        );
      }

      const videoApiConfig = {
        ...config.videoConfig,
        defaultModel: 'veo3' as const,
      };
      const videoId = await submitVideoGeneration(
        {
          prompt,
          model,
          size,
          duration: secondsToSend,
          referenceImages,
          params: params.params,
        },
        videoApiConfig,
        options?.signal
      );

      if (!videoId) {
        const elapsedTime = Date.now() - startTime;
        failLLMApiLog(logId, {
          httpStatus: 200,
          duration: elapsedTime,
          errorMessage: 'No video ID returned from API',
        });
        throw new Error('No video ID returned from API');
      }

      updateLLMApiLogMetadata(logId, {
        remoteId: videoId,
        httpStatus: 200,
      });

      // 保存 remoteId，用于页面刷新后恢复轮询
      await taskStorageWriter.updateRemoteId(taskId, videoId);

      options?.onProgress?.({ progress: 10, phase: 'polling' });

      // 轮询等待视频完成
      if (!this.pollingTasks.has(taskId)) {
        this.pollingTasks.add(taskId);
        try {
          const result = await pollVideoStatus(
            videoId,
            config.videoConfig,
            (progress) => {
              // progress 是 0-1 范围（来自 pollVideoStatus 的 progress/100）
              // 映射到 10-90 范围：10 + (0~1) * 80 = 10~90
              options?.onProgress?.({
                progress: 10 + progress * 80,
                phase: 'polling',
              });
            },
            options?.signal
          );

          const elapsedTime = Date.now() - startTime;

          // 记录成功
          completeLLMApiLog(logId, {
            httpStatus: 200,
            duration: elapsedTime,
            resultType: 'video',
            resultCount: 1,
            resultUrl: result.url,
            remoteId: videoId,
          });

          options?.onProgress?.({ progress: 100 });

          // 缓存远程 URL 到本地
          const cachedVidUrl = await cacheRemoteUrl(
            result.url,
            taskId,
            'video',
            'mp4'
          );

          // 完成任务
          await taskStorageWriter.completeTask(taskId, {
            url: cachedVidUrl,
            format: 'mp4',
            size: 0,
            duration: duration ? parseInt(duration, 10) : undefined,
          });
        } finally {
          this.pollingTasks.delete(taskId);
        }
      } else {
        console.log(
          `[FallbackMediaExecutor] Task ${taskId} is already being polled, skipping duplicate request.`
        );
      }
    } catch (error: any) {
      const elapsedTime = Date.now() - startTime;
      const errorMessage = error.message || 'Video generation failed';

      // 检测认证错误，触发设置弹窗
      if (isAuthError(errorMessage)) {
        dispatchApiAuthError({ message: errorMessage, source: 'video' });
      }

      failLLMApiLog(logId, {
        duration: elapsedTime,
        errorMessage,
      });
      await taskStorageWriter.failTask(taskId, {
        code: error.code || 'VIDEO_GENERATION_ERROR',
        message: errorMessage,
      });
      throw error;
    }
  }

  /**
   * AI 分析
   */
  async aiAnalyze(
    params: AIAnalyzeParams,
    options?: ExecutionOptions
  ): Promise<AIAnalyzeResult> {
    const {
      taskId,
      prompt,
      messages,
      images,
      referenceImages,
      model,
      textModel,
      modelRef,
      systemPrompt,
    } = params;
    const config = this.getConfig({
      textModel: modelRef || textModel || model,
    });
    const startTime = Date.now();
    // 优先使用用户选择的模型
    const modelName = textModel || model || config.textConfig.modelName;
    // 合并图片参数
    const allImages = referenceImages || images || [];

    // 注意：AI 分析任务不写入 tasks 表，chat 类型不应该出现在用户任务列表
    options?.onProgress?.({ progress: 0, phase: 'submitting' });

    // 构建消息数组
    let chatMessages: Array<{ role: string; content: unknown }>;

    if (messages && messages.length > 0) {
      // 使用预构建的消息（与 SW 端一致）
      chatMessages = messages;
    } else if (prompt) {
      // 使用 prompt 构建消息
      const contents: Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }> = [{ type: 'text', text: prompt }];

      // 添加图片
      if (allImages.length > 0) {
        for (const imageUrl of allImages) {
          contents.push({
            type: 'image_url',
            image_url: { url: imageUrl },
          });
        }
      }

      chatMessages = [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: contents },
      ];
    } else {
      throw new Error('缺少必填参数：需要 messages 或 prompt');
    }

    // 提取 prompt 用于日志记录
    const logPrompt = extractPromptFromMessages(chatMessages);

    // 开始记录 LLM API 调用
    const logId = startLLMApiLog({
      endpoint: '/chat/completions',
      model: modelName,
      taskType: 'chat',
      prompt: logPrompt,
      hasReferenceImages: allImages.length > 0,
      referenceImageCount: allImages.length,
      taskId,
    });

    try {
      options?.onProgress?.({ progress: 30, phase: 'submitting' });

      const unifiedMessages: UnifiedGeminiMessage[] = chatMessages.map(
        (message) => ({
          role: message.role as 'system' | 'user' | 'assistant',
          content:
            typeof message.content === 'string'
              ? [{ type: 'text', text: message.content }]
              : (message.content as UnifiedGeminiMessage['content']),
        })
      );

      const data = await callApiWithRetry(config.textConfig, unifiedMessages);

      options?.onProgress?.({ progress: 80 });

      const fullResponse = data.choices?.[0]?.message?.content || '';
      const elapsedTime = Date.now() - startTime;

      // 记录成功
      completeLLMApiLog(logId, {
        httpStatus: 200,
        duration: elapsedTime,
        resultType: 'text',
        resultCount: 1,
        resultText: fullResponse.substring(0, 500),
        responseBody: JSON.stringify(data), // 记录完整的 JSON 响应体
      });

      // 解析 tool calls（AI 规划的后续任务）
      const toolCalls = parseToolCalls(fullResponse);
      const textContent = extractTextContent(fullResponse);

      // 转换为 addSteps 格式
      const addSteps = toolCalls.map((tc, index) => {
        // 替换图片占位符
        const processedArgs = { ...tc.arguments };
        if (images && images.length > 0 && processedArgs.referenceImages) {
          const refs = processedArgs.referenceImages as string[];
          processedArgs.referenceImages = refs.map((placeholder) => {
            const match = placeholder.match(/\[图片(\d+)\]/);
            if (match) {
              const idx = parseInt(match[1], 10) - 1;
              return images[idx] || placeholder;
            }
            return placeholder;
          });
        }

        return {
          id: `ai-step-${Date.now()}-${index}`,
          mcp: tc.name,
          args: processedArgs,
          description: textContent || `执行 ${tc.name}`,
          status: 'pending' as const,
        };
      });

      options?.onProgress?.({ progress: 100 });

      return {
        content: textContent,
        addSteps: addSteps.length > 0 ? addSteps : undefined,
      };
    } catch (error: any) {
      const elapsedTime = Date.now() - startTime;
      const errorMessage = error.message || 'AI analyze failed';

      // 检测认证错误，触发设置弹窗
      if (isAuthError(errorMessage)) {
        dispatchApiAuthError({ message: errorMessage, source: 'ai-analyze' });
      }

      failLLMApiLog(logId, {
        duration: elapsedTime,
        errorMessage,
      });
      throw error;
    }
  }

  /**
   * 恢复未完成的任务（例如页面刷新导致中断的任务）
   * 仅恢复有 remoteId 且状态为 processing 的任务
   *
   * @param onTaskUpdate - 任务状态更新回调
   * @param tasksFromMemory - 可选，从内存中传入的任务列表（避免 IndexedDB 读取竞态）
   */
  async resumePendingTasks(
    onTaskUpdate?: (
      taskId: string,
      status: TaskStatus,
      updates?: Partial<Task>
    ) => void,
    tasksFromMemory?: Task[]
  ): Promise<void> {
    try {
      // 优先使用内存中的任务列表，避免 useTaskStorage 的 fire-and-forget persistTask
      // 尚未写入 IndexedDB 导致读取到旧状态的竞态问题
      let pendingTasks: Task[];
      if (tasksFromMemory) {
        pendingTasks = tasksFromMemory.filter(
          (t) => t.status === TaskStatus.PROCESSING
        );
        console.warn(
          `[FallbackMediaExecutor] resumePendingTasks: found ${pendingTasks.length} processing tasks from memory`
        );
      } else {
        pendingTasks = await taskStorageReader.getAllTasks({
          status: TaskStatus.PROCESSING,
        });
        console.warn(
          `[FallbackMediaExecutor] resumePendingTasks: found ${pendingTasks.length} processing tasks from IndexedDB (fallback)`
        );
      }

      // 筛选出有 remoteId 的视频任务
      const videoTasks = pendingTasks.filter(
        (t) =>
          t.type === 'video' && t.remoteId && t.status === TaskStatus.PROCESSING
      );

      // 日志：列出所有处理中的任务及其筛选结果
      for (const t of pendingTasks) {
        const isVideo = t.type === 'video';
        const hasRemoteId = !!t.remoteId;
        const willResume = isVideo && hasRemoteId;
        console.warn(
          `[FallbackMediaExecutor]   task=${t.id} type=${t.type} remoteId=${
            t.remoteId || 'none'
          } → ${willResume ? 'RESUME' : 'SKIP'}${
            !isVideo ? ' (not video)' : ''
          }${!hasRemoteId ? ' (no remoteId)' : ''}`
        );
      }

      if (videoTasks.length === 0) {
        console.warn('[FallbackMediaExecutor] No video tasks to resume');
        return;
      }

      console.log(
        `[FallbackMediaExecutor] Resuming ${videoTasks.length} pending video tasks...`
      );

      // 并行恢复
      await Promise.all(
        videoTasks.map((task) => this.resumeVideoTask(task, onTaskUpdate))
      );
    } catch (error) {
      console.error(
        '[FallbackMediaExecutor] Failed to resume pending tasks:',
        error
      );
    }
  }

  /**
   * 恢复单个视频任务的轮询
   */
  private async resumeVideoTask(
    task: Task,
    onTaskUpdate?: (
      taskId: string,
      status: TaskStatus,
      updates?: Partial<Task>
    ) => void
  ): Promise<void> {
    // 如果任务已经在轮询中，直接跳过
    if (this.pollingTasks.has(task.id)) {
      console.log(
        `[FallbackMediaExecutor] Task ${task.id} is already being polled, skipping resume.`
      );
      return;
    }

    const config = this.getConfig();
    const videoId = task.remoteId!;

    // 标记为正在轮询
    this.pollingTasks.add(task.id);

    try {
      console.log(
        `[FallbackMediaExecutor] Resuming video task: ${
          task.id
        } (remoteId: ${videoId}, model: ${task.params?.model || 'unknown'})`
      );

      // 重新开始轮询
      const result = await pollVideoStatus(
        videoId,
        config.videoConfig,
        (progress) => {
          // 这里的 progress 是 0-1
          // 视频生成中，polling 阶段通常对应 10%-90%
          const mappedProgress = 10 + progress * 80;

          if (onTaskUpdate) {
            onTaskUpdate(task.id, TaskStatus.PROCESSING, {
              progress: mappedProgress,
            });
          } else {
            // taskStorageWriter.updateStatus 会写入 storage
            taskStorageWriter
              .updateStatus(task.id, TaskStatus.PROCESSING)
              .catch(() => undefined);
            taskStorageWriter
              .updateProgress(task.id, mappedProgress)
              .catch(() => undefined);
          }
        }
      );

      // 缓存远程 URL
      const cachedVidUrl = await cacheRemoteUrl(
        result.url,
        task.id,
        'video',
        'mp4'
      );

      const duration = task.params.duration as string | undefined;

      const completionResult = {
        url: cachedVidUrl,
        format: 'mp4',
        size: 0,
        duration: duration ? parseInt(duration, 10) : undefined,
      };

      // 始终先写入 IndexedDB，确保持久化
      await taskStorageWriter.completeTask(task.id, completionResult);

      // 再通知内存状态同步
      if (onTaskUpdate) {
        onTaskUpdate(task.id, TaskStatus.COMPLETED, {
          result: completionResult,
          progress: 100,
          completedAt: Date.now(),
        });
      }

      console.log(
        `[FallbackMediaExecutor] Resumed video task completed: ${task.id}`
      );
    } catch (error: any) {
      console.error(
        `[FallbackMediaExecutor] Failed to resume task ${task.id}:`,
        error
      );

      const errorInfo = {
        code: error.code || 'RESUME_FAILED',
        message: error.message || 'Failed to resume task',
      };

      // 始终先写入 IndexedDB，确保持久化
      await taskStorageWriter
        .failTask(task.id, errorInfo)
        .catch(() => undefined);

      // 再通知内存状态同步
      if (onTaskUpdate) {
        console.debug(
          `[FallbackMediaExecutor] Calling onTaskUpdate for failed task ${task.id}`
        );
        onTaskUpdate(task.id, TaskStatus.FAILED, { error: errorInfo });
      } else {
        console.warn(
          `[FallbackMediaExecutor] No onTaskUpdate callback for failed task ${task.id}, UI won't update`
        );
      }
    } finally {
      // 无论成功还是失败，都移除标记
      this.pollingTasks.delete(task.id);
    }
  }

  /**
   * 规范化 baseUrl，移除尾部 / 或 /v1，便于拼接 /v1/videos
   */
  private normalizeApiBase(url: string): string {
    let base = url.replace(/\/+$/, '');
    if (base.endsWith('/v1')) {
      base = base.slice(0, -3);
    }
    return base;
  }

  /**
   * 获取 API 配置
   */
  private getConfig(models?: {
    imageModel?: string | ModelRef | null;
    textModel?: string | ModelRef | null;
    videoModel?: string | ModelRef | null;
  }): {
    imageConfig: GeminiConfig;
    textConfig: GeminiConfig;
    videoConfig: VideoAPIConfig;
  } {
    const imageRoute = resolveInvocationRoute('image', models?.imageModel);
    const textRoute = resolveInvocationRoute('text', models?.textModel);
    const videoRoute = resolveInvocationRoute('video', models?.videoModel);
    const imagePlan = resolveInvocationPlanFromRoute('image', models?.imageModel);
    const textPlan = resolveInvocationPlanFromRoute('text', models?.textModel);
    const videoPlan = resolveInvocationPlanFromRoute('video', models?.videoModel);
    return {
      imageConfig: {
        apiKey: imageRoute.apiKey,
        baseUrl: imageRoute.baseUrl || 'https://api.tu-zi.com/v1',
        modelName: imageRoute.modelId,
        authType: imagePlan?.provider.authType || inferAuthTypeFromRoute(imageRoute),
        providerType:
          imagePlan?.provider.providerType || imageRoute.providerType || 'custom',
        extraHeaders: imagePlan?.provider.extraHeaders,
        protocol: imagePlan?.binding.protocol || null,
        binding: imagePlan?.binding || null,
        provider: imagePlan?.provider || null,
      },
      textConfig: {
        apiKey: textRoute.apiKey,
        baseUrl: textRoute.baseUrl || 'https://api.tu-zi.com/v1',
        modelName: textRoute.modelId,
        authType: textPlan?.provider.authType || inferAuthTypeFromRoute(textRoute),
        providerType:
          textPlan?.provider.providerType || textRoute.providerType || 'custom',
        extraHeaders: textPlan?.provider.extraHeaders,
        protocol: textPlan?.binding.protocol || null,
        binding: textPlan?.binding || null,
        provider: textPlan?.provider || null,
      },
      videoConfig: {
        apiKey: videoRoute.apiKey,
        // 规范化 baseUrl，移除尾部 / 或 /v1，便于拼接 /v1/videos
        baseUrl: this.normalizeApiBase(
          videoRoute.baseUrl || 'https://api.tu-zi.com'
        ),
        authType: videoPlan?.provider.authType || inferAuthTypeFromRoute(videoRoute),
        providerType:
          videoPlan?.provider.providerType || videoRoute.providerType || 'custom',
        extraHeaders: videoPlan?.provider.extraHeaders,
        binding: videoPlan?.binding || null,
        provider: videoPlan?.provider || null,
      },
    };
  }
}

/**
 * 降级执行器单例
 */
export const fallbackMediaExecutor = new FallbackMediaExecutor();

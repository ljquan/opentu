/**
 * Umami Analytics Utility
 *
 * Provides type-safe event tracking for Umami analytics.
 * Tracks model calls and API usage.
 *
 * SECURITY: All event data is sanitized before being sent to Umami
 * to prevent accidental leakage of API keys and other sensitive information.
 */

import { sanitizeObject } from '@aitu/utils';

declare const __APP_VERSION__: string;

export interface AnalyticsReleaseContext {
  version: string;
  appVersion: string;
  app_version: string;
  deployment_env: 'local' | 'preview' | 'staging' | 'production';
  release_channel: 'local' | 'preview' | 'staging' | 'production';
  host: string;
  hostname: string;
  route_name: string;
}

declare global {
  interface Window {
    umami?: {
      track: (
        eventName: string,
        properties?: Record<string, any>
      ) => void | Promise<void>;
    };
  }
}

/** Event categories for analytics */
enum AnalyticsCategory {
  AI_GENERATION = 'ai_generation',
  PPT = 'ppt',
  PROMPT = 'prompt',
  SYSTEM = 'system',
  UI_INTERACTION = 'ui_interaction',
}

export interface UIInteractionEventParams {
  area: string;
  action: string;
  control?: string;
  value?: string | number | boolean | null;
  source?: string;
  metadata?: Record<string, any>;
}

export interface ProviderEndpointAnalytics {
  origin: string;
  host: string;
  protocol: string;
}

export function getProviderEndpointAnalytics(
  baseUrl?: string | null
): ProviderEndpointAnalytics | null {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return {
      origin: parsed.origin,
      host: parsed.host,
      protocol: parsed.protocol.replace(':', ''),
    };
  } catch {
    return null;
  }
}

/** Event names for AI generation */
enum AIGenerationEvent {
  IMAGE_GENERATION_START = 'image_generation_start',
  IMAGE_GENERATION_SUCCESS = 'image_generation_success',
  IMAGE_GENERATION_FAILED = 'image_generation_failed',
  VIDEO_GENERATION_START = 'video_generation_start',
  VIDEO_GENERATION_SUCCESS = 'video_generation_success',
  VIDEO_GENERATION_FAILED = 'video_generation_failed',
  AUDIO_GENERATION_START = 'audio_generation_start',
  AUDIO_GENERATION_SUCCESS = 'audio_generation_success',
  AUDIO_GENERATION_FAILED = 'audio_generation_failed',
  CHAT_GENERATION_START = 'chat_generation_start',
  CHAT_GENERATION_SUCCESS = 'chat_generation_success',
  CHAT_GENERATION_FAILED = 'chat_generation_failed',
  TASK_CANCELLED = 'task_cancelled',
}

/** Event names for API calls */
enum APICallEvent {
  API_CALL_START = 'api_call_start',
  API_CALL_SUCCESS = 'api_call_success',
  API_CALL_FAILED = 'api_call_failed',
  API_CALL_RETRY = 'api_call_retry',
}

type AnalyticsEventData = Record<string, any>;

export type PromptAnalyticsType =
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'agent'
  | 'ppt-common'
  | 'ppt-slide';

export interface PromptAnalyticsSummary {
  has_prompt: boolean;
  prompt_length: number;
  prompt_length_bucket: string;
  prompt_line_count: number;
}

function getTextLengthBucket(length: number): string {
  if (length <= 0) return '0';
  if (length <= 50) return '1-50';
  if (length <= 200) return '51-200';
  if (length <= 500) return '201-500';
  if (length <= 1000) return '501-1000';
  if (length <= 2000) return '1001-2000';
  return '2000+';
}

export function getPromptAnalyticsSummary(
  prompt?: string | null
): PromptAnalyticsSummary {
  const trimmed = String(prompt || '').trim();
  return {
    has_prompt: trimmed.length > 0,
    prompt_length: trimmed.length,
    prompt_length_bucket: getTextLengthBucket(trimmed.length),
    prompt_line_count: trimmed ? trimmed.split(/\r?\n/).length : 0,
  };
}

function inferDeploymentEnv(
  hostname: string
): 'local' | 'preview' | 'staging' | 'production' {
  const normalized = hostname.toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized.endsWith('.local')
  ) {
    return 'local';
  }
  if (
    normalized.includes('preview') ||
    normalized.includes('vercel') ||
    normalized.includes('netlify')
  ) {
    return 'preview';
  }
  if (
    normalized.includes('staging') ||
    normalized.includes('test') ||
    normalized.includes('dev')
  ) {
    return 'staging';
  }
  return 'production';
}

function getAppVersion(): string {
  if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
    return __APP_VERSION__;
  }

  if (typeof document !== 'undefined') {
    return (
      document
        .querySelector('meta[name="app-version"]')
        ?.getAttribute('content') || '0.0.0'
    );
  }

  return '0.0.0';
}

export function getAnalyticsReleaseContext(): AnalyticsReleaseContext {
  const appVersion = getAppVersion();
  if (typeof window === 'undefined') {
    return {
      version: appVersion,
      appVersion,
      app_version: appVersion,
      deployment_env: 'local',
      release_channel: 'local',
      host: '',
      hostname: '',
      route_name: '/',
    };
  }

  const { hostname, pathname } = window.location;
  const deploymentEnv = inferDeploymentEnv(hostname);
  return {
    version: appVersion,
    appVersion,
    app_version: appVersion,
    host: window.location.host || hostname,
    hostname,
    route_name: pathname || '/',
    deployment_env: deploymentEnv,
    release_channel: deploymentEnv,
  };
}

function getCommonEventProperties(): AnalyticsEventData {
  return getAnalyticsReleaseContext();
}

function buildAICompatProperties(params: {
  taskId: string;
  taskType: 'image' | 'video' | 'audio' | 'chat';
  model: string;
  duration: number;
  status: 'success' | 'failed';
  error?: string;
}): AnalyticsEventData {
  return {
    $ai_model: params.model,
    $ai_latency: params.duration,
    $ai_is_error: params.status === 'failed',
    task_id: params.taskId,
    task_type: params.taskType,
    status: params.status,
    model: params.model,
    duration_ms: params.duration,
    ...(params.error ? { error: params.error } : {}),
  };
}

/** Analytics utility class */
class UmamiAnalytics {
  /**
   * Track a custom event (旁路：脱敏与上报在空闲时执行，不阻塞主流程)
   * SECURITY: Event data is sanitized before being sent to Umami
   */
  async track(
    eventName: string,
    eventData?: Record<string, any>
  ): Promise<void> {
    if (typeof window === 'undefined' || !window.umami) {
      return;
    }

    await new Promise<void>((resolve) => {
      const doTrack = (): void => {
        resolve();
      };

      if (
        typeof (
          globalThis as unknown as Window & {
            requestIdleCallback?: (
              cb: () => void,
              opts?: { timeout: number }
            ) => number;
          }
        ).requestIdleCallback === 'function'
      ) {
        (
          globalThis as unknown as Window & {
            requestIdleCallback: (
              cb: () => void,
              opts?: { timeout: number }
            ) => number;
          }
        ).requestIdleCallback(doTrack, { timeout: 2000 });
      } else {
        setTimeout(doTrack, 0);
      }
    });

    try {
      const payload = {
        ...getCommonEventProperties(),
        ...(eventData || {}),
      };
      const sanitizedData =
        Object.keys(payload).length > 0
          ? (sanitizeObject(payload) as Record<string, any>)
          : undefined;
      await window.umami.track(eventName, sanitizedData);
    } catch (error) {
      void error;
    }
  }

  /** Track low-frequency UI interactions without adding one-off event names. */
  trackUIInteraction(params: UIInteractionEventParams): void {
    const { metadata, ...coreParams } = params;
    void this.track('ui_interaction', {
      category: AnalyticsCategory.UI_INTERACTION,
      ...coreParams,
      metadata: metadata || undefined,
      timestamp: Date.now(),
    });
  }

  /** Track PPT feature usage without sending raw prompt or slide text. */
  trackPPTAction(params: {
    action: string;
    source?: string;
    status?: 'start' | 'success' | 'failed' | 'cancelled';
    pageCount?: number;
    frameCount?: number;
    selectedCount?: number;
    successCount?: number;
    failedCount?: number;
    durationMs?: number;
    serialMode?: boolean;
    model?: string;
    prompt?: string | null;
    error?: string;
    metadata?: Record<string, any>;
  }): void {
    const { prompt, metadata, ...coreParams } = params;
    void this.track('ppt_action', {
      category: AnalyticsCategory.PPT,
      ...coreParams,
      ...(prompt !== undefined ? getPromptAnalyticsSummary(prompt) : {}),
      metadata: metadata || undefined,
      timestamp: Date.now(),
    });
  }

  /** Track prompt library and optimization usage without sending raw prompt text. */
  trackPromptAction(params: {
    action: string;
    surface: string;
    promptType?: PromptAnalyticsType;
    mode?: string;
    source?: string;
    status?: 'start' | 'success' | 'failed' | 'cancelled';
    model?: string;
    prompt?: string | null;
    requirements?: string | null;
    durationMs?: number;
    itemCount?: number;
    metadata?: Record<string, any>;
  }): void {
    const { prompt, requirements, metadata, ...coreParams } = params;
    const promptSummary =
      prompt !== undefined ? getPromptAnalyticsSummary(prompt) : undefined;
    const requirementsSummary =
      requirements !== undefined
        ? getPromptAnalyticsSummary(requirements)
        : undefined;
    void this.track('prompt_action', {
      category: AnalyticsCategory.PROMPT,
      ...coreParams,
      ...(promptSummary || {}),
      ...(requirementsSummary
        ? {
            has_requirements: requirementsSummary.has_prompt,
            requirements_length: requirementsSummary.prompt_length,
            requirements_length_bucket:
              requirementsSummary.prompt_length_bucket,
            requirements_line_count: requirementsSummary.prompt_line_count,
          }
        : {}),
      metadata: metadata || undefined,
      timestamp: Date.now(),
    });
  }

  /** Check if analytics is enabled */
  isAnalyticsEnabled(): boolean {
    return typeof window !== 'undefined' && !!window.umami;
  }

  /** Track AI generation event */
  private trackAIGeneration(
    event: AIGenerationEvent,
    data: Record<string, any>
  ): void {
    void this.track(event, {
      category: AnalyticsCategory.AI_GENERATION,
      ...data,
      timestamp: Date.now(),
    });
  }

  /** Track model call start */
  trackModelCall(params: {
    taskId: string;
    taskType: 'image' | 'video' | 'audio' | 'chat';
    model: string;
    promptLength: number;
    hasUploadedImage: boolean;
    startTime: number;
    // Enhanced parameters for detailed analytics
    aspectRatio?: string; // 图片/视频比例 (e.g., "16:9", "1:1")
    duration?: number; // 视频时长（秒）
    resolution?: string; // 分辨率 (e.g., "1080p", "720p")
    batchCount?: number; // 批量生成数量
    hasReferenceImage?: boolean; // 是否有参考图
  }): void {
    const eventMap = {
      image: AIGenerationEvent.IMAGE_GENERATION_START,
      video: AIGenerationEvent.VIDEO_GENERATION_START,
      audio: AIGenerationEvent.AUDIO_GENERATION_START,
      chat: AIGenerationEvent.CHAT_GENERATION_START,
    };
    this.trackAIGeneration(eventMap[params.taskType], params);
  }

  /** Track successful model call */
  trackModelSuccess(params: {
    taskId: string;
    taskType: 'image' | 'video' | 'audio' | 'chat';
    model: string;
    duration: number;
    resultSize?: number;
  }): void {
    const eventMap = {
      image: AIGenerationEvent.IMAGE_GENERATION_SUCCESS,
      video: AIGenerationEvent.VIDEO_GENERATION_SUCCESS,
      audio: AIGenerationEvent.AUDIO_GENERATION_SUCCESS,
      chat: AIGenerationEvent.CHAT_GENERATION_SUCCESS,
    };
    this.trackAIGeneration(eventMap[params.taskType], params);
    void this.track(
      '$ai_generation',
      buildAICompatProperties({
        taskId: params.taskId,
        taskType: params.taskType,
        model: params.model,
        duration: params.duration,
        status: 'success',
      })
    );
  }

  /** Track failed model call */
  trackModelFailure(params: {
    taskId: string;
    taskType: 'image' | 'video' | 'audio' | 'chat';
    model: string;
    duration: number;
    error: string;
  }): void {
    const eventMap = {
      image: AIGenerationEvent.IMAGE_GENERATION_FAILED,
      video: AIGenerationEvent.VIDEO_GENERATION_FAILED,
      audio: AIGenerationEvent.AUDIO_GENERATION_FAILED,
      chat: AIGenerationEvent.CHAT_GENERATION_FAILED,
    };
    this.trackAIGeneration(eventMap[params.taskType], params);
    void this.track(
      '$ai_generation',
      buildAICompatProperties({
        taskId: params.taskId,
        taskType: params.taskType,
        model: params.model,
        duration: params.duration,
        status: 'failed',
        error: params.error,
      })
    );
  }

  /** Track task cancellation */
  trackTaskCancellation(params: {
    taskId: string;
    taskType: 'image' | 'video' | 'audio' | 'chat';
    duration: number;
  }): void {
    this.trackAIGeneration(AIGenerationEvent.TASK_CANCELLED, params);
  }

  /** Track API call start */
  trackAPICallStart(
    params: {
      endpoint: string;
      model: string;
      messageCount: number;
      stream: boolean;
    } & Record<string, unknown>
  ): void {
    void this.track(APICallEvent.API_CALL_START, {
      category: AnalyticsCategory.SYSTEM,
      ...params,
      timestamp: Date.now(),
    });
  }

  /** Track API call success */
  trackAPICallSuccess(
    params: {
      endpoint: string;
      model: string;
      duration: number;
      responseLength?: number;
      stream: boolean;
    } & Record<string, unknown>
  ): void {
    void this.track(APICallEvent.API_CALL_SUCCESS, {
      category: AnalyticsCategory.SYSTEM,
      ...params,
      timestamp: Date.now(),
    });
  }

  /** Track API call failure */
  trackAPICallFailure(
    params: {
      endpoint: string;
      model: string;
      duration: number;
      error: string;
      httpStatus?: number;
      stream: boolean;
    } & Record<string, unknown>
  ): void {
    void this.track(APICallEvent.API_CALL_FAILED, {
      category: AnalyticsCategory.SYSTEM,
      ...params,
      timestamp: Date.now(),
    });
  }

  /** Track API call retry */
  trackAPICallRetry(params: {
    endpoint: string;
    model: string;
    attempt: number;
    reason: string;
  }): void {
    void this.track(APICallEvent.API_CALL_RETRY, {
      category: AnalyticsCategory.SYSTEM,
      ...params,
      timestamp: Date.now(),
    });
  }
}

// Export singleton instance
export const analytics = new UmamiAnalytics();

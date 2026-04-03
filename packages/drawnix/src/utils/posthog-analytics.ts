/**
 * PostHog Analytics Utility
 *
 * Provides type-safe event tracking for PostHog analytics.
 * Tracks model calls and API usage.
 * 
 * SECURITY: All event data is sanitized before being sent to PostHog
 * to prevent accidental leakage of API keys and other sensitive information.
 */

import { sanitizeObject } from '@aitu/utils';

declare global {
  interface Window {
    posthog?: {
      capture: (eventName: string, properties?: Record<string, any>) => void;
    };
  }
}

/** Event categories for analytics */
enum AnalyticsCategory {
  AI_GENERATION = 'ai_generation',
  SYSTEM = 'system',
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

/** Analytics utility class */
class PostHogAnalytics {
  /**
   * Track a custom event (旁路：脱敏与上报在空闲时执行，不阻塞主流程)
   * SECURITY: Event data is sanitized before being sent to PostHog
   */
  track(eventName: string, eventData?: Record<string, any>): void {
    if (!window.posthog) {
      return;
    }
    const doTrack = (): void => {
      try {
        const sanitizedData = eventData
          ? (sanitizeObject(eventData) as Record<string, any>)
          : undefined;
        window.posthog!.capture(eventName, sanitizedData);
      } catch (error) {
        console.debug('[Analytics] track failed', error);
      }
    };
    if (typeof (globalThis as unknown as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback === 'function') {
      (globalThis as unknown as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(doTrack, { timeout: 2000 });
    } else {
      setTimeout(doTrack, 0);
    }
  }

  /** Check if analytics is enabled */
  isAnalyticsEnabled(): boolean {
    return typeof window !== 'undefined' && !!window.posthog;
  }

  /** Track AI generation event */
  private trackAIGeneration(
    event: AIGenerationEvent,
    data: Record<string, any>
  ): void {
    this.track(event, {
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
    aspectRatio?: string;       // 图片/视频比例 (e.g., "16:9", "1:1")
    duration?: number;          // 视频时长（秒）
    resolution?: string;        // 分辨率 (e.g., "1080p", "720p")
    batchCount?: number;        // 批量生成数量
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
  trackAPICallStart(params: {
    endpoint: string;
    model: string;
    messageCount: number;
    stream: boolean;
  }): void {
    this.track(APICallEvent.API_CALL_START, {
      category: AnalyticsCategory.SYSTEM,
      ...params,
      timestamp: Date.now(),
    });
  }

  /** Track API call success */
  trackAPICallSuccess(params: {
    endpoint: string;
    model: string;
    duration: number;
    responseLength?: number;
    stream: boolean;
  }): void {
    this.track(APICallEvent.API_CALL_SUCCESS, {
      category: AnalyticsCategory.SYSTEM,
      ...params,
      timestamp: Date.now(),
    });
  }

  /** Track API call failure */
  trackAPICallFailure(params: {
    endpoint: string;
    model: string;
    duration: number;
    error: string;
    httpStatus?: number;
    stream: boolean;
  }): void {
    this.track(APICallEvent.API_CALL_FAILED, {
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
    this.track(APICallEvent.API_CALL_RETRY, {
      category: AnalyticsCategory.SYSTEM,
      ...params,
      timestamp: Date.now(),
    });
  }
}

// Export singleton instance
export const analytics = new PostHogAnalytics();

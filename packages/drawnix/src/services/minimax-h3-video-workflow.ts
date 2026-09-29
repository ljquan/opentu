import type { ResolvedProviderContext } from './provider-routing/types';
import {
  buildMiniMaxH3VideoRequest,
  normalizeMiniMaxH3VideoResponse,
} from './video-binding-utils';
import { providerTransport } from './provider-routing/provider-transport';
import { unifiedCacheService } from './unified-cache-service';
import {
  isPublicHttpMediaUrl,
  isVirtualMediaUrl,
} from '../utils/virtual-media-url';

export const MINIMAX_H3_CONTEXT_IR_MODEL = 'MiniMax-H3';
export const MINIMAX_H3_CONTEXT_IR_PATH = '/v2/h3_context_ir';
export const MINIMAX_H3_REGENERATION_PATH = '/v2/video_regeneration';
export const MINIMAX_H3_PROMPT_ENHANCEMENT_PARAM_ID = 'prompt_enhancement';
export const MINIMAX_H3_TASK_TYPE_PARAM_ID = 'minimax_h3_task_type';
export const MINIMAX_H3_SOURCE_TASK_ID_PARAM_ID = 'source_task_id';
export const MINIMAX_H3_SOURCE_RESOLUTION_PARAM_ID = 'source_resolution';

const DEFAULT_POLL_INTERVAL = 5000;
const DEFAULT_MAX_POLL_ATTEMPTS = 1080;
const MINIMAX_H3_POLL_PATH = '/v2/query/video_generation/{taskId}';
const MINIMAX_H3_MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;
export const MINIMAX_H3_MAX_LOCAL_VIDEO_BYTES = 47 * 1024 * 1024;
const MINIMAX_H3_VIDEO_DATA_URL_PATTERN =
  /^data:video\/(?:mp4|quicktime);base64,/i;
const MINIMAX_H3_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime']);

export interface MiniMaxH3SubmissionInput {
  prompt: string;
  promptLanguage?: 'zh' | 'en';
  duration?: string | number | null;
  size?: string | null;
  ratio?: unknown;
  referenceImages?: string[];
  referenceVideos?: string[];
  params?: Record<string, unknown> | null;
}

export interface PreparedMiniMaxH3Submission {
  path: string;
  body: Record<string, unknown>;
  prompt: string;
  taskType: 'generation' | 'regeneration';
}

export interface PrepareMiniMaxH3SubmissionOptions {
  provider: ResolvedProviderContext;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  pollInterval?: number;
  maxPollAttempts?: number;
}

async function materializeMiniMaxH3ReferenceVideos(
  referenceVideos?: string[],
  provider?: ResolvedProviderContext
): Promise<string[]> {
  const pending: Array<string | Blob> = [];
  let localVideoBytes = 0;

  for (const rawReference of referenceVideos || []) {
    const reference = rawReference.trim();
    if (!reference) continue;

    if (MINIMAX_H3_VIDEO_DATA_URL_PATTERN.test(reference)) {
      pending.push(reference);
      continue;
    }
    if (isPublicHttpMediaUrl(reference)) {
      // Canvas-generated videos are usually stored as provider HTTP URLs.
      // Normalize readable URLs to the same inline representation used by
      // uploaded videos; this avoids provider/channel-specific URL fetching
      // failures while preserving a URL fallback for CORS-protected sources.
      try {
        const providerOrigin = provider?.baseUrl
          ? new URL(provider.baseUrl).origin
          : '';
        const referenceOrigin = new URL(reference).origin;
        const response =
          provider && providerOrigin === referenceOrigin
            ? await providerTransport.send(provider, {
                path: reference,
                method: 'GET',
                headers: { Accept: 'video/*,application/octet-stream' },
              })
            : await fetch(reference, {
                referrerPolicy: 'no-referrer',
              });
        if (response.ok) {
          const blob = await response.blob();
          const mimeType = blob.type.toLowerCase();
          if (MINIMAX_H3_VIDEO_MIME_TYPES.has(mimeType)) {
            localVideoBytes += blob.size;
            if (localVideoBytes > MINIMAX_H3_MAX_LOCAL_VIDEO_BYTES) {
              throw new Error(
                'MiniMax-H3 本地参考视频总大小不能超过 47MB；更大视频请使用公网 URL'
              );
            }
            pending.push(blob);
            continue;
          }
        }
      } catch (error) {
        if (error instanceof Error && /总大小不能超过/.test(error.message)) {
          throw error;
        }
      }
      pending.push(reference);
      continue;
    }
    if (!isVirtualMediaUrl(reference)) {
      throw new Error('MiniMax-H3 参考视频必须是本地素材或公网 HTTP(S) 地址');
    }

    const blob = await unifiedCacheService.getCachedBlob(reference, {
      allowNetwork: false,
    });
    if (!blob) {
      throw new Error('本地参考视频缓存已失效，请重新上传');
    }
    if (!MINIMAX_H3_VIDEO_MIME_TYPES.has(blob.type.toLowerCase())) {
      throw new Error('MiniMax-H3 本地参考视频仅支持 MP4 或 MOV 格式');
    }
    localVideoBytes += blob.size;
    if (localVideoBytes > MINIMAX_H3_MAX_LOCAL_VIDEO_BYTES) {
      throw new Error(
        'MiniMax-H3 本地参考视频总大小不能超过 47MB；更大视频请使用公网 URL'
      );
    }
    pending.push(blob);
  }

  const materialized: string[] = [];
  for (const reference of pending) {
    if (typeof reference === 'string') {
      materialized.push(reference);
      continue;
    }
    const { blobToDataUrl } = await import('@aitu/utils');
    materialized.push(await blobToDataUrl(reference));
  }

  return materialized;
}

async function prepareMiniMaxH3MediaInput(
  input: MiniMaxH3SubmissionInput,
  provider?: ResolvedProviderContext
): Promise<MiniMaxH3SubmissionInput> {
  return {
    ...input,
    referenceVideos: await materializeMiniMaxH3ReferenceVideos(
      input.referenceVideos,
      provider
    ),
  };
}

function assertMiniMaxH3RequestBodySize(body: Record<string, unknown>): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  if (byteLength > MINIMAX_H3_MAX_REQUEST_BODY_BYTES) {
    throw new Error(
      'MiniMax-H3 请求体不能超过 64MB，请减少本地参考视频数量或改用公网 URL'
    );
  }
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

function normalizeResolution(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase();
}

/**
 * Older MiniMax-H3 tasks were stored with the generic video dimensions
 * instead of the V2 resolution label. Treat those known dimensions as the
 * provider's 768P tier when validating a 2K regeneration request.
 */
export function normalizeMiniMaxH3SourceResolution(value: unknown): string {
  const normalized = normalizeResolution(value);
  if (normalized === '1280X720' || normalized === '720X1280') {
    return '768P';
  }
  return normalized;
}

export function isMiniMaxH3PromptEnhancementEnabled(
  params?: Record<string, unknown> | null
): boolean {
  return normalizeBoolean(params?.[MINIMAX_H3_PROMPT_ENHANCEMENT_PARAM_ID]);
}

export function isMiniMaxH3RegenerationRequest(
  params?: Record<string, unknown> | null
): boolean {
  return (
    String(params?.[MINIMAX_H3_TASK_TYPE_PARAM_ID] || '')
      .trim()
      .toLowerCase() === 'regeneration' ||
    Object.prototype.hasOwnProperty.call(
      params || {},
      MINIMAX_H3_SOURCE_TASK_ID_PARAM_ID
    )
  );
}

export function buildMiniMaxH3RegenerationRequest(
  params?: Record<string, unknown> | null
): Record<string, unknown> {
  const sourceTaskId = String(
    params?.[MINIMAX_H3_SOURCE_TASK_ID_PARAM_ID] || ''
  ).trim();
  if (!sourceTaskId) {
    throw new Error('缺少有效的 MiniMax-H3 源任务 ID，无法升至 2K');
  }

  const sourceResolution = normalizeMiniMaxH3SourceResolution(
    params?.[MINIMAX_H3_SOURCE_RESOLUTION_PARAM_ID]
  );
  if (sourceResolution === '2K') {
    throw new Error('源视频已经是 2K，不能再次升级');
  }
  if (sourceResolution !== '768P') {
    throw new Error('仅支持将 768P 的 MiniMax-H3 视频升级为 2K');
  }

  return {
    model: 'MiniMax-H3',
    source_task_id: sourceTaskId,
    resolution: '2K',
  };
}

export function resolveMiniMaxH3InitialSubmitPath(
  params?: Record<string, unknown> | null
): string {
  if (isMiniMaxH3RegenerationRequest(params)) {
    return MINIMAX_H3_REGENERATION_PATH;
  }
  if (isMiniMaxH3PromptEnhancementEnabled(params)) {
    return MINIMAX_H3_CONTEXT_IR_PATH;
  }
  return '/v2/video_generation';
}

function fillTaskId(path: string, taskId: string): string {
  return path.replace('{taskId}', encodeURIComponent(taskId));
}

function extractProviderErrorMessage(
  rawText: string,
  fallback: string
): string {
  const trimmed = rawText.trim();
  if (!trimmed) return fallback;
  try {
    const payload = JSON.parse(trimmed) as {
      message?: unknown;
      error?: unknown;
      base_resp?: { status_msg?: unknown };
    };
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
    if (
      payload.error &&
      typeof payload.error === 'object' &&
      'message' in payload.error &&
      typeof payload.error.message === 'string' &&
      payload.error.message.trim()
    ) {
      return payload.error.message.trim();
    }
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }
    if (
      typeof payload.base_resp?.status_msg === 'string' &&
      payload.base_resp.status_msg.trim()
    ) {
      return payload.base_resp.status_msg.trim();
    }
  } catch {
    return trimmed.replace(/\s+/g, ' ');
  }
  return fallback;
}

async function throwProviderError(
  response: Response,
  operation: string
): Promise<never> {
  const rawText = await response.text().catch(() => '');
  const detail = extractProviderErrorMessage(rawText, `HTTP ${response.status}`);
  throw new Error(`${operation}失败：${detail}`);
}

function getTaskFailureMessage(payload: Record<string, any>): string {
  const task =
    payload?.task && typeof payload.task === 'object' ? payload.task : payload;
  if (typeof task?.error === 'string' && task.error.trim()) {
    return task.error.trim();
  }
  if (typeof task?.error?.message === 'string' && task.error.message.trim()) {
    return task.error.message.trim();
  }
  return 'MiniMax-H3 提示词增强失败';
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason || new DOMException('Aborted', 'AbortError')
    );
  }
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

export function buildMiniMaxH3ContextIRRequest(
  input: MiniMaxH3SubmissionInput
): Record<string, unknown> {
  const { resolution: _resolution, ...request } =
    buildMiniMaxH3VideoRequest(input);
  if (input.promptLanguage) {
    const languageInstruction =
      input.promptLanguage === 'zh'
        ? '\n\n请用中文输出'
        : '\n\nPlease output the final enhanced video prompt in English.';
    const content = Array.isArray(request.content)
      ? request.content.map((item) =>
          item?.type === 'text' && typeof item.text === 'string'
            ? { ...item, text: `${item.text}${languageInstruction}` }
            : item
        )
      : request.content;
    return { ...request, model: MINIMAX_H3_CONTEXT_IR_MODEL, content };
  }
  return { ...request, model: MINIMAX_H3_CONTEXT_IR_MODEL };
}

async function submitContextIRTask(
  input: MiniMaxH3SubmissionInput,
  options: PrepareMiniMaxH3SubmissionOptions
): Promise<string> {
  const requestBody = buildMiniMaxH3ContextIRRequest(input);
  assertMiniMaxH3RequestBodySize(requestBody);
  const response = await providerTransport.send(options.provider, {
    path: MINIMAX_H3_CONTEXT_IR_PATH,
    baseUrlStrategy: 'trim-v1',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: options.signal,
    fetcher: options.fetcher,
  });
  if (!response.ok) {
    return throwProviderError(response, 'MiniMax-H3 提示词增强提交');
  }
  const payload = (await response.json()) as Record<string, any>;
  const code = payload?.base_resp?.status_code;
  if (code !== undefined && String(code) !== '0') {
    throw new Error(
      payload?.base_resp?.status_msg ||
        `MiniMax-H3 提示词增强提交失败（${code}）`
    );
  }
  const taskId = String(payload?.task_id || payload?.task?.id || '').trim();
  if (!taskId) {
    throw new Error('MiniMax-H3 提示词增强未返回任务 ID');
  }
  return taskId;
}

async function pollContextIRPrompt(
  taskId: string,
  options: PrepareMiniMaxH3SubmissionOptions
): Promise<string> {
  const interval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const maxAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await providerTransport.send(options.provider, {
      path: fillTaskId(MINIMAX_H3_POLL_PATH, taskId),
      baseUrlStrategy: 'trim-v1',
      method: 'GET',
      signal: options.signal,
      fetcher: options.fetcher,
    });
    if (!response.ok) {
      return throwProviderError(response, 'MiniMax-H3 提示词增强查询');
    }
    const payload = (await response.json()) as Record<string, any>;
    const code = payload?.base_resp?.status_code;
    if (code !== undefined && String(code) !== '0') {
      throw new Error(
        payload?.base_resp?.status_msg ||
          `MiniMax-H3 提示词增强查询失败（${code}）`
      );
    }
    const normalized = normalizeMiniMaxH3VideoResponse(payload, taskId);
    if (normalized.status === 'completed') {
      const prompt = String(payload?.task?.content?.prompt || '').trim();
      if (!prompt) {
        throw new Error('MiniMax-H3 提示词增强成功但未返回增强后的提示词');
      }
      return prompt;
    }
    if (normalized.status === 'failed') {
      throw new Error(getTaskFailureMessage(payload));
    }
    if (attempt < maxAttempts - 1) {
      await abortableDelay(interval, options.signal);
    }
  }
  throw new Error('MiniMax-H3 提示词增强超时，请稍后重试');
}

/**
 * Run the Context IR preflight and return the prompt for video submission.
 */
export async function enhanceMiniMaxH3Prompt(
  input: MiniMaxH3SubmissionInput,
  options: PrepareMiniMaxH3SubmissionOptions
): Promise<string> {
  options.signal?.throwIfAborted();
  const preparedInput = await prepareMiniMaxH3MediaInput(input, options.provider);
  const taskId = await submitContextIRTask(preparedInput, options);
  return pollContextIRPrompt(taskId, options);
}

export async function prepareMiniMaxH3Submission(
  input: MiniMaxH3SubmissionInput,
  options: PrepareMiniMaxH3SubmissionOptions
): Promise<PreparedMiniMaxH3Submission> {
  if (isMiniMaxH3RegenerationRequest(input.params)) {
    return {
      path: MINIMAX_H3_REGENERATION_PATH,
      body: buildMiniMaxH3RegenerationRequest(input.params),
      prompt: input.prompt,
      taskType: 'regeneration',
    };
  }

  const preparedInput = await prepareMiniMaxH3MediaInput(input, options.provider);
  let prompt = preparedInput.prompt;
  if (isMiniMaxH3PromptEnhancementEnabled(input.params)) {
    prompt = await enhanceMiniMaxH3Prompt(preparedInput, options);
  }

  const body = buildMiniMaxH3VideoRequest({ ...preparedInput, prompt });
  assertMiniMaxH3RequestBodySize(body);

  return {
    path: '/v2/video_generation',
    body,
    prompt,
    taskType: 'generation',
  };
}

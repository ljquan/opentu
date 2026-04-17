/**
 * Audio API Service
 *
 * Handles Suno-style audio generation with submit/fetch polling.
 * The discovered model id is treated as a capability entry, while the
 * executable model version is carried by the request field `mv`.
 */

import {
  providerTransport,
  resolveInvocationPlanFromRoute,
  type ProviderBaseUrlStrategy,
  type ProviderAuthStrategy,
  type ResolvedProviderContext,
} from './provider-routing';
import {
  resolveInvocationRoute,
  type ModelRef,
} from '../utils/settings-manager';
import type {
  AudioGenerationClipResult,
  AudioGenerationResult,
} from './model-adapters';
import { getForcedSunoParams } from '../utils/suno-model-aliases';
import {
  startLLMApiLog,
  completeLLMApiLog,
  failLLMApiLog,
  updateLLMApiLogMetadata,
} from './media-executor/llm-api-logger';

export interface AudioGenerationParams {
  model: string;
  modelRef?: ModelRef | null;
  prompt: string;
  title?: string;
  tags?: string;
  mv?: string;
  sunoAction?: string;
  notifyHook?: string;
  continueClipId?: string;
  continueTaskId?: string;
  continueAt?: number;
  infillStartS?: number;
  infillEndS?: number;
  params?: Record<string, unknown>;
  taskId?: string;
}

export type SunoAction = 'music' | 'lyrics';

export interface AudioClipRecord {
  id?: string;
  clip_id?: string;
  title?: string;
  status?: string;
  state?: string;
  mv?: string;
  model_name?: string;
  major_model_version?: string;
  duration?: number | null;
  audio_url?: string;
  image_url?: string | null;
  image_large_url?: string | null;
  batch_index?: number;
  metadata?: Record<string, unknown> & {
    duration?: number | null;
    prompt?: string;
    tags?: string;
    error_message?: string | null;
  };
  [key: string]: unknown;
}

export interface AudioTaskResponse {
  taskId: string;
  action?: string;
  status: string;
  progress?: number;
  failReason?: string;
  clips: AudioClipRecord[];
  lyrics?: AudioLyricsPayload | null;
  raw: unknown;
}

export interface AudioLyricsPayload {
  text?: string;
  title?: string;
  tags?: string[];
  status?: string;
  errorMessage?: string;
}

interface AudioPollingOptions {
  interval?: number;
  maxAttempts?: number;
  onProgress?: (progress: number, status?: string) => void;
  onSubmitted?: (taskId: string) => void;
  routeModel?: string | ModelRef | null;
}

interface ClipIdentifierMemory {
  byBatchIndex: Map<number, string>;
  ordered: string[];
}

function inferAuthType(): ProviderAuthStrategy {
  return 'bearer';
}

function resolveAudioProviderContext(
  routeModel?: string | ModelRef | null
): ResolvedProviderContext {
  const plan = resolveInvocationPlanFromRoute('audio', routeModel);
  if (plan) {
    return plan.provider;
  }

  const route = resolveInvocationRoute('audio', routeModel);
  return {
    profileId: route.profileId || 'runtime',
    profileName: route.profileName || 'Runtime',
    providerType: route.providerType || 'custom',
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
    authType: inferAuthType(),
  };
}

function resolveAudioPlanContext(routeModel?: string | ModelRef | null): {
  providerContext: ResolvedProviderContext;
  binding: NonNullable<
    ReturnType<typeof resolveInvocationPlanFromRoute>
  >['binding'] | null;
} {
  const plan = resolveInvocationPlanFromRoute('audio', routeModel);
  return {
    providerContext: plan?.provider || resolveAudioProviderContext(routeModel),
    binding: plan?.binding || null,
  };
}

function inferAudioBaseUrlStrategy(
  providerContext: ResolvedProviderContext,
  binding?: NonNullable<
    ReturnType<typeof resolveInvocationPlanFromRoute>
  >['binding'] | null
): ProviderBaseUrlStrategy | undefined {
  if (binding?.baseUrlStrategy) {
    return binding.baseUrlStrategy;
  }

  const normalizedBaseUrl = providerContext.baseUrl.trim().toLowerCase();
  const isTuziRoot = normalizedBaseUrl.includes('api.tu-zi.com');
  const hasLegacyV1Suffix = /\/v1\/?$/.test(normalizedBaseUrl);

  if (isTuziRoot && hasLegacyV1Suffix) {
    return 'trim-v1';
  }

  return undefined;
}

function replaceTaskIdTemplate(pathTemplate: string, taskId: string): string {
  return pathTemplate
    .replace('{taskId}', taskId)
    .replace('{task_id}', taskId);
}

function normalizeStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeStatus(value);
  return normalized || undefined;
}

function normalizeSunoAction(value: unknown): SunoAction | undefined {
  const normalized = normalizeStatus(value).toLowerCase();
  if (normalized === 'lyrics') {
    return 'lyrics';
  }
  if (normalized === 'music') {
    return 'music';
  }
  return undefined;
}

function resolveSunoModelId(model?: string | ModelRef | null): string | undefined {
  if (!model) {
    return undefined;
  }

  if (typeof model === 'string') {
    return model;
  }

  return model.modelId || undefined;
}

function getForcedSunoParamValue(
  params: AudioGenerationParams,
  key: string
): string | undefined {
  const forcedParams = getForcedSunoParams(
    resolveSunoModelId(params.modelRef) || params.model
  );
  const forcedValue = forcedParams[key];
  return typeof forcedValue === 'string' ? forcedValue : undefined;
}

function resolveRequestedAction(params: AudioGenerationParams): SunoAction {
  return (
    normalizeSunoAction(getForcedSunoParamValue(params, 'sunoAction')) ||
    normalizeSunoAction(params.sunoAction) ||
    normalizeSunoAction(params.params?.sunoAction) ||
    'music'
  );
}

function normalizeLyricsTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tags = value
      .map((tag) => normalizeOptionalString(tag))
      .filter((tag): tag is string => typeof tag === 'string');
    return tags.length > 0 ? tags : undefined;
  }

  const singleTag = normalizeOptionalString(value);
  return singleTag ? [singleTag] : undefined;
}

function toProgressNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value));
  }

  if (typeof value === 'string') {
    const match = value.match(/(\d+(?:\.\d+)?)%?/);
    if (match) {
      return Math.max(0, Math.min(100, Number(match[1])));
    }
  }

  return undefined;
}

function isTerminalSuccess(status: string): boolean {
  const normalized = status.toLowerCase();
  return (
    normalized === 'success' ||
    normalized === 'succeeded' ||
    normalized === 'complete' ||
    normalized === 'completed'
  );
}

function isTerminalFailure(status: string): boolean {
  const normalized = status.toLowerCase();
  return (
    normalized === 'failed' ||
    normalized === 'failure' ||
    normalized === 'error'
  );
}

function canonicalizeLifecycleStatus(status: string): string {
  const normalized = normalizeStatus(status).toLowerCase();
  if (!normalized) {
    return '';
  }

  if (isTerminalFailure(normalized)) {
    return 'failed';
  }

  if (isTerminalSuccess(normalized)) {
    return 'completed';
  }

  return normalized;
}

function resolveProgressValue(...candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    const progress = toProgressNumber(candidate);
    if (progress !== undefined) {
      return progress;
    }
  }

  return undefined;
}

function resolveClipLifecycleStatus(clips: AudioClipRecord[]): string {
  if (clips.length === 0) {
    return '';
  }

  const itemStatuses = clips
    .map((clip) => normalizeStatus(clip.status || clip.state))
    .filter(Boolean);

  if (itemStatuses.some(isTerminalFailure)) {
    return 'failed';
  }

  if (itemStatuses.length > 0 && itemStatuses.every(isTerminalSuccess)) {
    return 'completed';
  }

  return '';
}

function collectNestedDataCandidates(payload: any, maxDepth = 6): any[] {
  const candidates: any[] = [];
  let current = payload;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      break;
    }

    candidates.push(current);
    current = current.data;
  }

  return candidates;
}

function extractLyricsPayload(payload: any): AudioLyricsPayload | null {
  const candidates = collectNestedDataCandidates(payload);
  let fallback: AudioLyricsPayload | null = null;

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }

    const text = normalizeOptionalString(candidate.text);
    const title = normalizeOptionalString(candidate.title);
    const tags = normalizeLyricsTags(candidate.tags);
    const status =
      normalizeOptionalString(candidate.status) ||
      normalizeOptionalString(candidate.state);
    const errorMessage =
      normalizeOptionalString(candidate.error_message) ||
      normalizeOptionalString(candidate.errorMessage);

    if (text || title || tags) {
      return {
        text,
        title,
        tags,
        status,
        errorMessage,
      };
    }

    if (!fallback && (status || errorMessage)) {
      fallback = {
        text,
        title,
        tags,
        status,
        errorMessage,
      };
    }
  }

  return fallback;
}

function normalizeLifecycleStatus(payload: any): string {
  const clips = extractAudioClips(payload);
  const clipStatus = resolveClipLifecycleStatus(clips);
  if (clipStatus) {
    return clipStatus;
  }

  const lyrics = extractLyricsPayload(payload);
  const lyricsStatus = normalizeStatus(lyrics?.status);
  if (lyricsStatus) {
    if (isTerminalFailure(lyricsStatus)) {
      return 'failed';
    }
    if (isTerminalSuccess(lyricsStatus)) {
      return 'completed';
    }
  }

  const statusCandidates = [
    payload?.data?.data?.status,
    payload?.data?.status,
    payload?.status,
    payload?.data?.data?.state,
    payload?.data?.state,
    payload?.state,
  ]
    .map((candidate) => normalizeStatus(candidate))
    .filter(Boolean);

  const failureStatus = statusCandidates.find(isTerminalFailure);
  if (failureStatus) {
    return 'failed';
  }

  const successStatus = statusCandidates.find(isTerminalSuccess);
  if (successStatus) {
    return 'completed';
  }

  const progress = resolveProgressValue(
    payload?.progress,
    payload?.data?.progress,
    payload?.data?.data?.progress
  );
  const hasAudioResult = clips.some(
    (clip) =>
      typeof clip.audio_url === 'string' && clip.audio_url.trim().length > 0
  );
  const hasLyricsResult =
    typeof lyrics?.text === 'string' && lyrics.text.trim().length > 0;

  // Some providers keep a stale outer wrapper status while the nested task
  // payload and generated clips already indicate completion.
  if (progress === 100 && (hasAudioResult || hasLyricsResult)) {
    return 'completed';
  }

  return canonicalizeLifecycleStatus(statusCandidates[0] || '') || 'processing';
}

function extractAudioClips(payload: any): AudioClipRecord[] {
  const candidates = [
    payload?.data,
    payload?.clips,
    payload?.data?.clips,
    payload?.data?.data,
    payload?.data?.data?.data,
    payload?.data?.data?.clips,
    payload?.data?.items,
    payload?.data?.data?.items,
    payload?.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as AudioClipRecord[];
    }
  }

  return [];
}

function resolveClipIdentifier(clip: AudioClipRecord): string | undefined {
  return normalizeOptionalString(clip.clip_id) || normalizeOptionalString(clip.id);
}

function createClipIdentifierMemory(): ClipIdentifierMemory {
  return {
    byBatchIndex: new Map<number, string>(),
    ordered: [],
  };
}

function rememberClipIdentifiers(
  clips: AudioClipRecord[],
  memory: ClipIdentifierMemory
): void {
  for (const clip of clips) {
    const clipId = normalizeOptionalString(clip.clip_id);
    if (!clipId) {
      continue;
    }

    if (
      typeof clip.batch_index === 'number' &&
      Number.isFinite(clip.batch_index) &&
      !memory.byBatchIndex.has(clip.batch_index)
    ) {
      memory.byBatchIndex.set(clip.batch_index, clipId);
    }

    if (!memory.ordered.includes(clipId)) {
      memory.ordered.push(clipId);
    }
  }
}

function applyRememberedClipIdentifiers(
  clips: AudioClipRecord[],
  memory: ClipIdentifierMemory
): AudioClipRecord[] {
  return clips.map((clip, index) => {
    if (normalizeOptionalString(clip.clip_id)) {
      return clip;
    }

    let rememberedClipId: string | undefined;
    if (typeof clip.batch_index === 'number' && Number.isFinite(clip.batch_index)) {
      rememberedClipId = memory.byBatchIndex.get(clip.batch_index);
    }
    if (!rememberedClipId) {
      rememberedClipId = memory.ordered[index];
    }
    if (!rememberedClipId) {
      return clip;
    }

    return {
      ...clip,
      clip_id: rememberedClipId,
    };
  });
}

function normalizeAudioClipResult(
  clip: AudioClipRecord
): AudioGenerationClipResult | null {
  const audioUrl = normalizeOptionalString(clip.audio_url);
  if (!audioUrl) {
    return null;
  }

  return {
    id: normalizeOptionalString(clip.id),
    clipId: resolveClipIdentifier(clip),
    title: normalizeOptionalString(clip.title),
    status:
      normalizeOptionalString(clip.status) ||
      normalizeOptionalString(clip.state),
    audioUrl,
    imageUrl: normalizeOptionalString(clip.image_url),
    imageLargeUrl: normalizeOptionalString(clip.image_large_url),
    duration:
      clip.duration ??
      (typeof clip.metadata?.duration === 'number' ? clip.metadata.duration : null),
    modelName: normalizeOptionalString(clip.model_name),
    majorModelVersion: normalizeOptionalString(clip.major_model_version),
  };
}

function extractFailureReason(payload: any, clips: AudioClipRecord[]): string {
  const lyrics = extractLyricsPayload(payload);
  const candidates = [
    payload?.fail_reason,
    payload?.message,
    payload?.error,
    payload?.error_message,
    payload?.data?.error_message,
    payload?.data?.message,
    payload?.data?.error,
    clips[0]?.metadata?.error_message,
    lyrics?.errorMessage,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return normalizeSunoAction(payload?.action || payload?.data?.action) === 'lyrics'
    ? '歌词生成失败'
    : '音乐生成失败';
}

function getPrimaryTaskId(payload: any, fallback = ''): string {
  const candidates = [
    payload?.task_id,
    payload?.taskId,
    payload?.id,
    payload?.data,
    payload?.data?.task_id,
    payload?.data?.taskId,
    payload?.data?.id,
    payload?.data?.data?.task_id,
    payload?.data?.data?.taskId,
    payload?.data?.data?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return fallback;
}

function normalizeAudioTaskResponse(
  payload: any,
  fallbackTaskId = '',
  clipMemory?: ClipIdentifierMemory
): AudioTaskResponse {
  const extractedClips = extractAudioClips(payload).sort((left, right) => {
    const leftIndex =
      typeof left.batch_index === 'number' ? left.batch_index : Number.MAX_SAFE_INTEGER;
    const rightIndex =
      typeof right.batch_index === 'number' ? right.batch_index : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
  if (clipMemory) {
    rememberClipIdentifiers(extractedClips, clipMemory);
  }
  const clips = clipMemory
    ? applyRememberedClipIdentifiers(extractedClips, clipMemory)
    : extractedClips;
  const lyrics = extractLyricsPayload(payload);

  return {
    taskId: getPrimaryTaskId(payload, fallbackTaskId),
    action:
      normalizeStatus(payload?.action) ||
      normalizeStatus(payload?.data?.action) ||
      normalizeStatus(payload?.data?.data?.action) ||
      undefined,
    status: normalizeLifecycleStatus(payload),
    progress: resolveProgressValue(
      payload?.progress,
      payload?.data?.progress,
      payload?.data?.data?.progress
    ) ??
      (clips.length > 0 &&
      clips.every((clip) =>
        isTerminalSuccess(normalizeStatus(clip.status || clip.state))
      )
        ? 100
        : lyrics?.text
        ? 100
        : undefined),
    failReason: extractFailureReason(payload, clips),
    clips,
    lyrics,
    raw: payload,
  };
}

function inferAudioFormat(url?: string): string {
  if (!url) return 'mp3';
  const match = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  return match?.[1]?.toLowerCase() || 'mp3';
}

function withUploadVersion(version: string): string {
  return version.endsWith('-upload') ? version : `${version}-upload`;
}

function resolveVersionValue(params: AudioGenerationParams): string {
  const requestedVersion =
    params.mv ||
    (typeof params.params?.mv === 'string' ? params.params.mv : undefined) ||
    'chirp-v3-5';

  const continueSource =
    typeof params.params?.continueSource === 'string'
      ? params.params.continueSource
      : getForcedSunoParamValue(params, 'continueSource');
  const uploadedContinuation =
    continueSource === 'upload' || params.params?.uploadedContinuation === true;

  return uploadedContinuation
    ? withUploadVersion(requestedVersion)
    : requestedVersion;
}

function buildMusicSubmitBody(params: AudioGenerationParams): string {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    mv: resolveVersionValue(params),
  };

  const title =
    params.title ||
    (typeof params.params?.title === 'string' ? params.params.title : undefined);
  const tags =
    params.tags ||
    (typeof params.params?.tags === 'string' ? params.params.tags : undefined);
  const continueClipId =
    params.continueClipId ||
    (typeof params.params?.continueClipId === 'string'
      ? params.params.continueClipId
      : undefined);
  const continueTaskId =
    params.continueTaskId ||
    (typeof params.params?.continueTaskId === 'string'
      ? params.params.continueTaskId
      : undefined) ||
    (typeof params.params?.task_id === 'string'
      ? params.params.task_id
      : undefined);
  const continueAtValue =
    params.continueAt ??
    (typeof params.params?.continueAt === 'number'
      ? params.params.continueAt
      : undefined);
  const infillStartSValue =
    params.infillStartS ??
    (typeof params.params?.infillStartS === 'number'
      ? params.params.infillStartS
      : undefined);
  const infillEndSValue =
    params.infillEndS ??
    (typeof params.params?.infillEndS === 'number'
      ? params.params.infillEndS
      : undefined);

  if (title) {
    body.title = title;
  }
  if (tags) {
    body.tags = tags;
  }
  if (continueClipId) {
    body.continue_clip_id = continueClipId;
  }
  if (continueTaskId) {
    body.task_id = continueTaskId;
  }
  if (typeof continueAtValue === 'number' && Number.isFinite(continueAtValue)) {
    body.continue_at = continueAtValue;
  }

  if (
    typeof infillStartSValue === 'number' &&
    Number.isFinite(infillStartSValue)
  ) {
    body.infill_start_s = infillStartSValue;
  }
  if (
    typeof infillEndSValue === 'number' &&
    Number.isFinite(infillEndSValue)
  ) {
    body.infill_end_s = infillEndSValue;
  }

  return JSON.stringify(body);
}

function buildLyricsSubmitBody(params: AudioGenerationParams): string {
  const body: Record<string, unknown> = {
    prompt: params.prompt,
  };

  const notifyHook =
    params.notifyHook ||
    (typeof params.params?.notifyHook === 'string'
      ? params.params.notifyHook
      : undefined) ||
    (typeof params.params?.notify_hook === 'string'
      ? params.params.notify_hook
      : undefined);

  if (notifyHook) {
    body.notify_hook = notifyHook;
  }

  return JSON.stringify(body);
}

function buildSubmitBody(params: AudioGenerationParams): string {
  return resolveRequestedAction(params) === 'lyrics'
    ? buildLyricsSubmitBody(params)
    : buildMusicSubmitBody(params);
}

function resolveSubmitPath(
  params: AudioGenerationParams,
  binding?: NonNullable<
    ReturnType<typeof resolveInvocationPlanFromRoute>
  >['binding'] | null
): string {
  const action = resolveRequestedAction(params);
  const submitPathByAction = binding?.metadata?.audio?.submitPathByAction;
  if (submitPathByAction?.[action]) {
    return submitPathByAction[action];
  }

  if (
    action === 'lyrics' ||
    getForcedSunoParamValue(params, 'sunoAction') === 'lyrics'
  ) {
    return '/suno/submit/lyrics';
  }

  return binding?.submitPath || '/suno/submit/music';
}

export function extractAudioGenerationResult(
  response: AudioTaskResponse
): AudioGenerationResult {
  const action = normalizeSunoAction(response.action);
  const lyrics = response.lyrics;
  if (action === 'lyrics' || lyrics?.text || lyrics?.title) {
    return {
      url: '',
      resultKind: 'lyrics',
      title: lyrics?.title,
      lyricsText: lyrics?.text,
      lyricsTitle: lyrics?.title,
      lyricsTags: lyrics?.tags,
      format: 'lyrics',
      providerTaskId: response.taskId || undefined,
      raw: response.raw,
    };
  }

  const clipsWithAudio = response.clips
    .map((clip) => normalizeAudioClipResult(clip))
    .filter((clip): clip is AudioGenerationClipResult => clip !== null);
  const primaryClip = clipsWithAudio[0];
  const primaryUrl = primaryClip?.audioUrl;

  if (!primaryUrl) {
    throw new Error('API 未返回有效的音频 URL');
  }

  const urls = clipsWithAudio
    .map((clip) => clip.audioUrl)
    .filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
  const clipIds = clipsWithAudio
    .map((clip) => clip.clipId || clip.id)
    .filter((clipId): clipId is string => typeof clipId === 'string' && clipId.length > 0);

  return {
    url: primaryUrl,
    resultKind: 'audio',
    urls: urls.length > 1 ? urls : undefined,
    title: primaryClip?.title,
    duration: primaryClip?.duration ?? null,
    imageUrl: primaryClip?.imageLargeUrl || primaryClip?.imageUrl,
    format: inferAudioFormat(primaryUrl),
    providerTaskId: response.taskId || undefined,
    primaryClipId: primaryClip?.clipId || primaryClip?.id,
    clipIds: clipIds.length > 0 ? clipIds : undefined,
    clips: clipsWithAudio.length > 0 ? clipsWithAudio : undefined,
    raw: response.raw,
  };
}

function hasResolvedTaskResult(response: AudioTaskResponse): boolean {
  if (response.clips.length > 0) {
    return response.clips.some(
      (clip) =>
        typeof clip.audio_url === 'string' && clip.audio_url.trim().length > 0
    );
  }

  return typeof response.lyrics?.text === 'string' &&
    response.lyrics.text.trim().length > 0;
}

class AudioAPIService {
  async submitAudioGeneration(
    params: AudioGenerationParams
  ): Promise<AudioTaskResponse> {
    const { providerContext, binding } = resolveAudioPlanContext(
      params.modelRef || params.model
    );
    const baseUrlStrategy = inferAudioBaseUrlStrategy(providerContext, binding);

    if (!providerContext.apiKey) {
      throw new Error('API Key 未配置，请先配置 API Key');
    }

    const action = resolveRequestedAction(params);
    const submitPath = resolveSubmitPath(params, binding);
    const body = buildSubmitBody(params);
    const startTime = Date.now();

    const logId = startLLMApiLog({
      endpoint: submitPath,
      model: params.model,
      taskType: 'audio',
      prompt: params.prompt,
      taskId: params.taskId,
    });

    let response: Response;
    try {
      response = await providerTransport.send(providerContext, {
        path: submitPath,
        baseUrlStrategy,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (error: any) {
      failLLMApiLog(logId, {
        duration: Date.now() - startTime,
        errorMessage: error.message || String(error),
      });
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const duration = Date.now() - startTime;
      failLLMApiLog(logId, {
        httpStatus: response.status,
        duration,
        errorMessage: errorText.substring(0, 500),
      });
      const error = new Error(
        `${action === 'lyrics' ? '歌词' : '音乐'}生成提交失败: ${response.status} - ${errorText}`
      );
      (error as any).apiErrorBody = errorText;
      (error as any).httpStatus = response.status;
      throw error;
    }

    const payload = await response.json();
    const result = normalizeAudioTaskResponse(payload);
    const duration = Date.now() - startTime;

    completeLLMApiLog(logId, {
      httpStatus: response.status,
      duration,
      resultType: action === 'lyrics' ? 'lyrics' : 'audio',
      remoteId: result.taskId,
      responseBody: JSON.stringify(payload),
    });

    if (result.taskId) {
      updateLLMApiLogMetadata(logId, { remoteId: result.taskId });
    }

    return result;
  }

  async queryAudioTask(
    taskId: string,
    routeModel?: string | ModelRef | null
  ): Promise<AudioTaskResponse> {
    if (!taskId.trim()) {
      throw new Error('Suno 任务 ID 为空，无法查询任务状态');
    }

    const { providerContext, binding } = resolveAudioPlanContext(routeModel);
    const baseUrlStrategy = inferAudioBaseUrlStrategy(providerContext, binding);

    if (!providerContext.apiKey) {
      throw new Error('API Key 未配置');
    }

    const path = binding?.pollPathTemplate
      ? replaceTaskIdTemplate(binding.pollPathTemplate, taskId)
      : `/suno/fetch/${taskId}`;

    const response = await providerTransport.send(providerContext, {
      path,
      baseUrlStrategy,
      method: 'GET',
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(
        `Suno 任务查询失败: ${response.status} - ${errorText}`
      );
      (error as any).apiErrorBody = errorText;
      (error as any).httpStatus = response.status;
      throw error;
    }

    const payload = await response.json();
    return normalizeAudioTaskResponse(payload, taskId);
  }

  async generateAudioWithPolling(
    params: AudioGenerationParams,
    options: AudioPollingOptions = {}
  ): Promise<AudioTaskResponse> {
    const {
      interval = 5000,
      maxAttempts = 720,
      onProgress,
      onSubmitted,
    } = options;

    const submitResponse = await this.submitAudioGeneration(params);

    if (!submitResponse.taskId.trim()) {
      throw new Error(
        `${resolveRequestedAction(params) === 'lyrics' ? '歌词' : '音乐'}生成提交成功，但未返回任务 ID`
      );
    }

    if (onSubmitted) {
      onSubmitted(submitResponse.taskId);
    }

    if (onProgress) {
      onProgress(0, submitResponse.status);
    }

    if (isTerminalFailure(submitResponse.status)) {
      throw new Error(
        submitResponse.failReason ||
          (resolveRequestedAction(params) === 'lyrics'
            ? '歌词生成失败'
            : '音乐生成失败')
      );
    }

    if (isTerminalSuccess(submitResponse.status) && hasResolvedTaskResult(submitResponse)) {
      return submitResponse;
    }

    return this.pollUntilComplete(submitResponse.taskId, {
      interval,
      maxAttempts,
      onProgress,
      routeModel: params.modelRef || params.model,
    });
  }

  async resumePolling(
    taskId: string,
    options: AudioPollingOptions = {}
  ): Promise<AudioTaskResponse> {
    const clipMemory = createClipIdentifierMemory();
    const immediate = normalizeAudioTaskResponse(
      (await this.queryAudioTask(taskId, options.routeModel)).raw,
      taskId,
      clipMemory
    );

    if (options.onProgress) {
      options.onProgress(immediate.progress || 0, immediate.status);
    }

    if (isTerminalSuccess(immediate.status)) {
      if (hasResolvedTaskResult(immediate)) {
        return immediate;
      }
    }

    if (isTerminalFailure(immediate.status)) {
      throw new Error(immediate.failReason || 'Suno 生成失败');
    }

    return this.pollUntilComplete(taskId, options, clipMemory);
  }

  private async pollUntilComplete(
    taskId: string,
    options: AudioPollingOptions = {},
    clipMemory: ClipIdentifierMemory = createClipIdentifierMemory()
  ): Promise<AudioTaskResponse> {
    const { interval = 5000, maxAttempts = 720, onProgress } = options;

    let attempts = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 10;

    while (attempts < maxAttempts) {
      await this.sleep(interval);
      attempts += 1;

      try {
        const payload = await this.queryAudioTask(taskId, options.routeModel);
        const result = normalizeAudioTaskResponse(payload.raw, taskId, clipMemory);
        consecutiveErrors = 0;

        if (onProgress) {
          onProgress(result.progress || 0, result.status);
        }

        if (isTerminalSuccess(result.status)) {
          if (hasResolvedTaskResult(result)) {
            return result;
          }
        }

        if (isTerminalFailure(result.status)) {
          throw new Error(result.failReason || 'Suno 生成失败');
        }
      } catch (error) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw error;
        }

        const backoffInterval = Math.min(
          interval * Math.pow(1.5, consecutiveErrors),
          60000
        );
        await this.sleep(backoffInterval - interval);
      }
    }

    throw new Error('Suno 生成超时，请稍后重试');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const audioAPIService = new AudioAPIService();

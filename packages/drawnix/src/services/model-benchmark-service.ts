import { BehaviorSubject, type Observable } from 'rxjs';
import { defaultGeminiClient } from '../utils/gemini-api';
import type { GeminiMessage } from '../utils/gemini-api/types';
import type { ModelConfig } from '../constants/model-config';
import type { ModelVendor } from '../constants/model-config';
import { kvStorageService } from './kv-storage-service';
import { generateTaskId } from '../utils/task-utils';
import { createModelRef } from '../utils/settings-manager';
import { analytics } from '../utils/umami-analytics';
import {
  getAdapterContextFromSettings,
  resolveAdapterForInvocation,
  type AudioGenerationRequest,
  type AudioModelAdapter,
  type ImageGenerationRequest,
  type ImageModelAdapter,
  type VideoGenerationRequest,
  type VideoModelAdapter,
} from './model-adapters';
import {
  BENCHMARK_PROMPT_PRESETS,
  computeValueScore,
  getDefaultPromptPreset,
  rankBenchmarkEntries,
  resolvePromptPreset,
  type BenchmarkModality,
  type BenchmarkPromptPreset,
  type BenchmarkRankingMode,
} from './model-benchmark-pure';
import {
  buildPromptWithKnowledgeContext,
  normalizeKnowledgeContextRefs,
} from './generation-context-service';
import type { KnowledgeContextRef } from '../types/task.types';

export type { BenchmarkModality, BenchmarkRankingMode };

const STORAGE_KEY = 'aitu:model-benchmark:sessions';
const MAX_SESSIONS = 12;
const MAX_PERSISTED_TEXT_LENGTH = 4000;
const MAX_PERSISTED_URL_LENGTH = 120000;
const DEFAULT_CONCURRENCY = 2;

export type BenchmarkCompareMode = 'cross-provider' | 'cross-model' | 'custom';
export type BenchmarkEntryStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';
export type BenchmarkSessionStatus =
  | 'draft'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed';

export interface ModelBenchmarkTarget {
  profileId: string;
  profileName: string;
  modelId: string;
  modelLabel: string;
  modality: BenchmarkModality;
  vendor: ModelVendor;
  selectionKey: string;
}

export interface ModelBenchmarkPreview {
  text?: string;
  url?: string;
  urls?: string[];
  format?: string;
  duration?: number | null;
  title?: string;
  rawData?: any;
}

export interface ModelBenchmarkEntry extends ModelBenchmarkTarget {
  id: string;
  status: BenchmarkEntryStatus;
  startedAt: number | null;
  firstResponseAt: number | null;
  completedAt: number | null;
  firstResponseMs: number | null;
  totalDurationMs: number | null;
  estimatedCost: number | null;
  errorSummary: string | null;
  preview: ModelBenchmarkPreview;
  userScore: number | null;
  favorite: boolean;
  rejected: boolean;
}

export interface ModelBenchmarkSession {
  id: string;
  title: string;
  modality: BenchmarkModality;
  compareMode: BenchmarkCompareMode;
  promptPresetId: string;
  prompt: string;
  knowledgeContextRefs?: KnowledgeContextRef[];
  status: BenchmarkSessionStatus;
  rankingMode: BenchmarkRankingMode;
  createdAt: number;
  updatedAt: number;
  source: 'manual' | 'shortcut';
  entries: ModelBenchmarkEntry[];
}

export interface ModelBenchmarkStoreState {
  sessions: ModelBenchmarkSession[];
  activeSessionId: string | null;
  ready: boolean;
}

export interface ModelBenchmarkSummary {
  hasFavorite: boolean;
  hasRejected: boolean;
  bestValueScore: number | null;
  latestUserScore: number | null;
}

export interface CreateBenchmarkSessionInput {
  modality: BenchmarkModality;
  compareMode: BenchmarkCompareMode;
  promptPresetId: string;
  prompt: string;
  knowledgeContextRefs?: KnowledgeContextRef[];
  rankingMode: BenchmarkRankingMode;
  targets: ModelBenchmarkTarget[];
  source?: 'manual' | 'shortcut';
}

export interface ModelBenchmarkLaunchRequest {
  modality?: BenchmarkModality;
  compareMode?: BenchmarkCompareMode;
  profileId?: string;
  modelId?: string;
  autoRun?: boolean;
  launchedAt?: number;
}

export function buildBenchmarkSelectionKey(
  profileId: string,
  modelId: string
): string {
  return `${profileId}::${modelId}`;
}

function sanitizeText(text?: string): string | undefined {
  if (!text) {
    return undefined;
  }
  return text.length > MAX_PERSISTED_TEXT_LENGTH
    ? `${text.slice(0, MAX_PERSISTED_TEXT_LENGTH)}...`
    : text;
}

function sanitizeUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }
  if (url.startsWith('data:') && url.length > MAX_PERSISTED_URL_LENGTH) {
    return undefined;
  }
  return url.length > MAX_PERSISTED_URL_LENGTH
    ? url.slice(0, MAX_PERSISTED_URL_LENGTH)
    : url;
}

function sanitizePreview(
  preview: ModelBenchmarkPreview
): ModelBenchmarkPreview {
  return {
    text: sanitizeText(preview.text),
    url: sanitizeUrl(preview.url),
    urls: preview.urls?.map((item) => sanitizeUrl(item)).filter(Boolean) as
      | string[]
      | undefined,
    format: preview.format,
    duration: preview.duration,
    title: sanitizeText(preview.title),
    rawData: preview.rawData,
  };
}

function sanitizeEntry(entry: ModelBenchmarkEntry): ModelBenchmarkEntry {
  return {
    ...entry,
    errorSummary: sanitizeText(entry.errorSummary || undefined) || null,
    preview: sanitizePreview(entry.preview),
  };
}

function sanitizeSession(
  session: ModelBenchmarkSession
): ModelBenchmarkSession {
  return {
    ...session,
    prompt: sanitizeText(session.prompt) || session.prompt,
    knowledgeContextRefs: normalizeKnowledgeContextRefs(
      session.knowledgeContextRefs
    ),
    entries: session.entries.map(sanitizeEntry),
  };
}

function trimSessions(
  sessions: ModelBenchmarkSession[]
): ModelBenchmarkSession[] {
  return [...sessions]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SESSIONS)
    .map(sanitizeSession);
}

function createSessionTitle(
  input: CreateBenchmarkSessionInput,
  createdAt: number
): string {
  const { modality, compareMode, targets } = input;
  const modalityLabel =
    modality === 'text'
      ? '文本'
      : modality === 'image'
      ? '图片'
      : modality === 'video'
      ? '视频'
      : '音频';

  let subject = '';
  if (compareMode === 'cross-provider' && targets.length > 0) {
    subject = targets[0].modelLabel;
  } else if (compareMode === 'cross-model' && targets.length > 0) {
    subject = targets[0].profileName;
  } else {
    subject = '自定义批测';
  }

  const timeLabel = new Date(createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${subject} · ${modalityLabel} · ${timeLabel}`;
}

function createEntryFromTarget(
  target: ModelBenchmarkTarget
): ModelBenchmarkEntry {
  return {
    ...target,
    id: generateTaskId(),
    status: 'pending',
    startedAt: null,
    firstResponseAt: null,
    completedAt: null,
    firstResponseMs: null,
    totalDurationMs: null,
    estimatedCost: null,
    errorSummary: null,
    preview: {},
    userScore: null,
    favorite: false,
    rejected: false,
  };
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || '请求失败';
  }
  return '请求失败';
}

export function trackBenchmarkEvent(
  eventName: string,
  payload: Record<string, unknown>
): void {
  analytics.track(eventName, {
    area: 'model_benchmark',
    ...payload,
  });
}

function getEntryStatusCounts(entries: ModelBenchmarkEntry[]) {
  return {
    targetCount: entries.length,
    completedCount: entries.filter((entry) => entry.status === 'completed')
      .length,
    failedCount: entries.filter((entry) => entry.status === 'failed').length,
    runningCount: entries.filter((entry) => entry.status === 'running').length,
    pendingCount: entries.filter((entry) => entry.status === 'pending').length,
  };
}

async function executeTextBenchmark(
  entry: ModelBenchmarkEntry,
  prompt: string
): Promise<ModelBenchmarkPreview & { firstResponseAt: number | null }> {
  let firstResponseAt: number | null = null;
  const modelRef = createModelRef(entry.profileId, entry.modelId);
  const messages: GeminiMessage[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: prompt }],
    },
  ];
  const response = await defaultGeminiClient.sendChat(
    messages,
    (content) => {
      if (!firstResponseAt && content.trim()) {
        firstResponseAt = Date.now();
      }
    },
    undefined,
    modelRef
  );
  const text = response.choices?.[0]?.message?.content || '';
  return {
    firstResponseAt,
    text,
    title: text.slice(0, 32),
    rawData: response,
  };
}

async function executeImageBenchmark(
  entry: ModelBenchmarkEntry,
  prompt: string,
  preset: BenchmarkPromptPreset
): Promise<ModelBenchmarkPreview & { firstResponseAt: number | null }> {
  let firstResponseAt: number | null = null;
  const modelRef = createModelRef(entry.profileId, entry.modelId);
  const adapter = resolveAdapterForInvocation(
    'image',
    entry.modelId,
    modelRef
  ) as ImageModelAdapter | undefined;
  if (!adapter || adapter.kind !== 'image') {
    throw new Error(`未找到图片适配器：${entry.modelId}`);
  }
  const request: ImageGenerationRequest = {
    prompt,
    model: entry.modelId,
    modelRef,
    size: preset.size,
    params: {
      n: 1,
      onSubmitted: () => {
        if (!firstResponseAt) {
          firstResponseAt = Date.now();
        }
      },
      onProgress: () => {
        if (!firstResponseAt) {
          firstResponseAt = Date.now();
        }
      },
    },
  };
  const result = await adapter.generateImage(
    {
      ...getAdapterContextFromSettings('image', modelRef),
      requestId: entry.id,
    },
    request
  );
  return {
    firstResponseAt,
    url: result.url,
    urls: result.urls,
    format: result.format,
    rawData: result.raw,
  };
}

async function executeVideoBenchmark(
  entry: ModelBenchmarkEntry,
  prompt: string,
  preset: BenchmarkPromptPreset
): Promise<ModelBenchmarkPreview & { firstResponseAt: number | null }> {
  let firstResponseAt: number | null = null;
  const modelRef = createModelRef(entry.profileId, entry.modelId);
  const adapter = resolveAdapterForInvocation(
    'video',
    entry.modelId,
    modelRef
  ) as VideoModelAdapter | undefined;
  if (!adapter || adapter.kind !== 'video') {
    throw new Error(`未找到视频适配器：${entry.modelId}`);
  }
  const request: VideoGenerationRequest = {
    prompt,
    model: entry.modelId,
    modelRef,
    size: preset.size,
    duration: preset.duration,
    params: {
      onSubmitted: () => {
        if (!firstResponseAt) {
          firstResponseAt = Date.now();
        }
      },
      onProgress: () => {
        if (!firstResponseAt) {
          firstResponseAt = Date.now();
        }
      },
    },
  };
  const result = await adapter.generateVideo(
    getAdapterContextFromSettings('video', modelRef),
    request
  );
  return {
    firstResponseAt,
    url: result.url,
    format: result.format,
    duration: result.duration,
    rawData: result.raw,
  };
}

async function executeAudioBenchmark(
  entry: ModelBenchmarkEntry,
  prompt: string,
  preset: BenchmarkPromptPreset
): Promise<ModelBenchmarkPreview & { firstResponseAt: number | null }> {
  let firstResponseAt: number | null = null;
  const modelRef = createModelRef(entry.profileId, entry.modelId);
  const adapter = resolveAdapterForInvocation(
    'audio',
    entry.modelId,
    modelRef
  ) as AudioModelAdapter | undefined;
  if (!adapter || adapter.kind !== 'audio') {
    throw new Error(`未找到音频适配器：${entry.modelId}`);
  }
  const request: AudioGenerationRequest = {
    prompt,
    model: entry.modelId,
    modelRef,
    title: preset.title,
    tags: preset.tags,
    params: {
      onSubmitted: () => {
        if (!firstResponseAt) {
          firstResponseAt = Date.now();
        }
      },
      onProgress: () => {
        if (!firstResponseAt) {
          firstResponseAt = Date.now();
        }
      },
    },
  };
  const result = await adapter.generateAudio(
    getAdapterContextFromSettings('audio', modelRef),
    request
  );
  return {
    firstResponseAt,
    url: result.url,
    urls: result.urls,
    format: result.format,
    duration: result.duration,
    title: result.title,
    text: result.resultKind === 'lyrics' ? result.lyricsText : undefined,
    rawData: result.raw,
  };
}

async function executeBenchmark(
  entry: ModelBenchmarkEntry,
  prompt: string,
  preset: BenchmarkPromptPreset
): Promise<ModelBenchmarkPreview & { firstResponseAt: number | null }> {
  switch (entry.modality) {
    case 'text':
      return executeTextBenchmark(entry, prompt);
    case 'image':
      return executeImageBenchmark(entry, prompt, preset);
    case 'video':
      return executeVideoBenchmark(entry, prompt, preset);
    case 'audio':
      return executeAudioBenchmark(entry, prompt, preset);
    default:
      throw new Error('不支持的测试模态');
  }
}

class ModelBenchmarkService {
  private readonly state$ = new BehaviorSubject<ModelBenchmarkStoreState>({
    sessions: [],
    activeSessionId: null,
    ready: false,
  });

  constructor() {
    void this.load();
  }

  private async load() {
    if (!kvStorageService.isAvailable()) {
      this.state$.next({
        sessions: [],
        activeSessionId: null,
        ready: true,
      });
      return;
    }
    try {
      const persisted = await kvStorageService.get<ModelBenchmarkStoreState>(
        STORAGE_KEY
      );
      const sessions = trimSessions(persisted?.sessions || []);
      const activeSessionId = sessions.some(
        (session) => session.id === persisted?.activeSessionId
      )
        ? persisted?.activeSessionId || null
        : sessions[0]?.id || null;
      this.state$.next({
        sessions,
        activeSessionId,
        ready: true,
      });
    } catch (error) {
      console.warn('[ModelBenchmark] failed to load state:', error);
      this.state$.next({
        sessions: [],
        activeSessionId: null,
        ready: true,
      });
    }
  }

  private persist() {
    const current = this.state$.value;
    void kvStorageService.set(STORAGE_KEY, {
      sessions: trimSessions(current.sessions),
      activeSessionId: current.activeSessionId,
      ready: true,
    });
  }

  private mutate(
    updater: (state: ModelBenchmarkStoreState) => ModelBenchmarkStoreState
  ) {
    const nextState = updater(this.state$.value);
    this.state$.next(nextState);
    this.persist();
  }

  observe(): Observable<ModelBenchmarkStoreState> {
    return this.state$.asObservable();
  }

  getState(): ModelBenchmarkStoreState {
    return this.state$.value;
  }

  getLatestEntryStatus(
    profileId: string,
    modelId: string
  ): BenchmarkEntryStatus | null {
    const key = buildBenchmarkSelectionKey(profileId, modelId);
    for (const session of this.state$.value.sessions) {
      for (const entry of session.entries) {
        if (entry.selectionKey === key && entry.status !== 'pending') {
          return entry.status;
        }
      }
    }
    return null;
  }

  getModelBenchmarkSummary(modelId: string): ModelBenchmarkSummary {
    let hasFavorite = false;
    let hasRejected = false;
    let bestValueScore: number | null = null;
    let latestUserScore: number | null = null;

    for (const session of this.state$.value.sessions) {
      for (const entry of session.entries) {
        if (entry.modelId !== modelId) continue;
        if (entry.favorite) hasFavorite = true;
        if (entry.rejected) hasRejected = true;
        if (latestUserScore === null && entry.userScore != null) {
          latestUserScore = entry.userScore;
        }
        const vs = computeValueScore(entry);
        if (vs !== null && (bestValueScore === null || vs > bestValueScore)) {
          bestValueScore = vs;
        }
      }
    }

    return { hasFavorite, hasRejected, bestValueScore, latestUserScore };
  }

  setActiveSession(sessionId: string | null) {
    this.mutate((state) => ({
      ...state,
      activeSessionId: sessionId,
    }));
  }

  createSession(input: CreateBenchmarkSessionInput): ModelBenchmarkSession {
    const createdAt = Date.now();
    const session: ModelBenchmarkSession = {
      id: generateTaskId(),
      title: createSessionTitle(input, createdAt),
      modality: input.modality,
      compareMode: input.compareMode,
      promptPresetId: input.promptPresetId,
      prompt: input.prompt,
      knowledgeContextRefs: normalizeKnowledgeContextRefs(
        input.knowledgeContextRefs
      ),
      status: 'draft',
      rankingMode: input.rankingMode,
      createdAt,
      updatedAt: createdAt,
      source: input.source || 'manual',
      entries: input.targets.map(createEntryFromTarget),
    };

    this.mutate((state) => ({
      ...state,
      sessions: trimSessions([session, ...state.sessions]),
      activeSessionId: session.id,
    }));

    trackBenchmarkEvent('model_benchmark_session_created', {
      sessionId: session.id,
      modality: session.modality,
      compareMode: session.compareMode,
      source: session.source,
      targetCount: session.entries.length,
      promptPresetId: session.promptPresetId,
      promptLength: session.prompt.length,
      knowledgeContextCount: session.knowledgeContextRefs?.length || 0,
    });

    return session;
  }

  removeSession(sessionId: string) {
    const removedSession = this.state$.value.sessions.find(
      (session) => session.id === sessionId
    );
    if (!removedSession) {
      return;
    }

    this.mutate((state) => {
      const sessions = state.sessions.filter((item) => item.id !== sessionId);
      return {
        ...state,
        sessions,
        activeSessionId:
          state.activeSessionId === sessionId
            ? sessions[0]?.id || null
            : state.activeSessionId,
      };
    });

    trackBenchmarkEvent('model_benchmark_session_removed', {
      sessionId,
      modality: removedSession.modality,
      compareMode: removedSession.compareMode,
      source: removedSession.source,
      status: removedSession.status,
      rankingMode: removedSession.rankingMode,
      ...getEntryStatusCounts(removedSession.entries),
      hasFavorite: removedSession.entries.some((entry) => entry.favorite),
      hasRejected: removedSession.entries.some((entry) => entry.rejected),
    });
  }

  setRankingMode(sessionId: string, rankingMode: BenchmarkRankingMode) {
    const currentSession = this.state$.value.sessions.find(
      (session) => session.id === sessionId
    );
    if (!currentSession || currentSession.rankingMode === rankingMode) {
      return;
    }

    this.mutate((state) => ({
      ...state,
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              rankingMode,
              updatedAt: Date.now(),
            }
          : session
      ),
    }));

    trackBenchmarkEvent('model_benchmark_ranking_mode_changed', {
      sessionId,
      modality: currentSession.modality,
      compareMode: currentSession.compareMode,
      previousRankingMode: currentSession.rankingMode,
      rankingMode,
      targetCount: currentSession.entries.length,
    });
  }

  setEntryFeedback(
    sessionId: string,
    entryId: string,
    updates: Partial<
      Pick<ModelBenchmarkEntry, 'userScore' | 'favorite' | 'rejected'>
    >
  ) {
    const currentSession = this.state$.value.sessions.find(
      (session) => session.id === sessionId
    );
    const currentEntry = currentSession?.entries.find(
      (entry) => entry.id === entryId
    );
    if (!currentSession || !currentEntry) {
      return;
    }

    const nextUserScore =
      'userScore' in updates
        ? updates.userScore ?? null
        : currentEntry.userScore;
    const nextFavorite =
      'favorite' in updates ? Boolean(updates.favorite) : currentEntry.favorite;
    const nextRejected =
      'rejected' in updates ? Boolean(updates.rejected) : currentEntry.rejected;

    this.mutate((state) => ({
      ...state,
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              updatedAt: Date.now(),
              entries: session.entries.map((entry) =>
                entry.id === entryId
                  ? {
                      ...entry,
                      ...updates,
                    }
                  : entry
              ),
            }
          : session
      ),
    }));

    trackBenchmarkEvent('model_benchmark_entry_feedback_changed', {
      sessionId,
      entryId,
      modality: currentEntry.modality,
      compareMode: currentSession.compareMode,
      profileId: currentEntry.profileId,
      profileName: currentEntry.profileName,
      modelId: currentEntry.modelId,
      modelLabel: currentEntry.modelLabel,
      vendor: currentEntry.vendor,
      entryStatus: currentEntry.status,
      changedFields: Object.keys(updates).join(','),
      previousUserScore: currentEntry.userScore,
      userScore: nextUserScore,
      previousFavorite: currentEntry.favorite,
      favorite: nextFavorite,
      previousRejected: currentEntry.rejected,
      rejected: nextRejected,
    });
  }

  async runSession(
    sessionId: string,
    concurrency = DEFAULT_CONCURRENCY
  ): Promise<void> {
    const currentSession = this.state$.value.sessions.find(
      (session) => session.id === sessionId
    );
    if (!currentSession || currentSession.entries.length === 0) {
      return;
    }

    const runStartedAt = Date.now();
    trackBenchmarkEvent('model_benchmark_session_started', {
      sessionId,
      modality: currentSession.modality,
      compareMode: currentSession.compareMode,
      source: currentSession.source,
      targetCount: currentSession.entries.length,
      concurrency,
      promptPresetId: currentSession.promptPresetId,
      promptLength: currentSession.prompt.length,
      knowledgeContextCount: currentSession.knowledgeContextRefs?.length || 0,
    });

    const preset = resolvePromptPreset(
      currentSession.promptPresetId,
      currentSession.modality
    );
    const knowledgeContextResult = currentSession.knowledgeContextRefs?.length
      ? await buildPromptWithKnowledgeContext(
          currentSession.prompt,
          currentSession.knowledgeContextRefs
        )
      : null;
    const executionPrompt =
      knowledgeContextResult?.prompt || currentSession.prompt;
    const queue = [...currentSession.entries];

    this.mutate((state) => ({
      ...state,
      activeSessionId: sessionId,
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              status: 'running',
              updatedAt: Date.now(),
              entries: session.entries.map((entry) => ({
                ...entry,
                status: 'pending',
                startedAt: null,
                firstResponseAt: null,
                completedAt: null,
                firstResponseMs: null,
                totalDurationMs: null,
                errorSummary: null,
                preview: {},
              })),
            }
          : session
      ),
    }));

    let cursor = 0;
    const workerCount = Math.max(1, Math.min(concurrency, queue.length));
    await Promise.all(
      Array.from({ length: workerCount }).map(async () => {
        while (cursor < queue.length) {
          const next = queue[cursor];
          cursor += 1;
          if (next) {
            await this.runEntry(sessionId, next.id, preset, executionPrompt);
          }
        }
      })
    );

    this.mutate((state) => ({
      ...state,
      sessions: state.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        const failedCount = session.entries.filter(
          (entry) => entry.status === 'failed'
        ).length;
        const allFailed = failedCount === session.entries.length;
        const hasFailed = failedCount > 0;
        return {
          ...session,
          status: allFailed ? 'failed' : hasFailed ? 'partial' : 'completed',
          updatedAt: Date.now(),
        };
      }),
    }));

    const finalSession = this.state$.value.sessions.find(
      (session) => session.id === sessionId
    );
    if (finalSession) {
      const completedCount = finalSession.entries.filter(
        (entry) => entry.status === 'completed'
      ).length;
      const failedCount = finalSession.entries.filter(
        (entry) => entry.status === 'failed'
      ).length;
      trackBenchmarkEvent('model_benchmark_session_completed', {
        sessionId,
        modality: finalSession.modality,
        compareMode: finalSession.compareMode,
        source: finalSession.source,
        status: finalSession.status,
        targetCount: finalSession.entries.length,
        completedCount,
        failedCount,
        durationMs: Date.now() - runStartedAt,
      });
    }
  }

  private async runEntry(
    sessionId: string,
    entryId: string,
    preset: BenchmarkPromptPreset,
    executionPrompt: string
  ) {
    const startedAt = Date.now();

    this.mutate((state) => ({
      ...state,
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              updatedAt: startedAt,
              entries: session.entries.map((entry) =>
                entry.id === entryId
                  ? {
                      ...entry,
                      status: 'running',
                      startedAt,
                    }
                  : entry
              ),
            }
          : session
      ),
    }));

    try {
      const latestSession = this.state$.value.sessions.find(
        (session) => session.id === sessionId
      );
      const latestEntry = latestSession?.entries.find(
        (entry) => entry.id === entryId
      );
      if (!latestSession || !latestEntry) {
        return;
      }
      const result = await executeBenchmark(
        latestEntry,
        executionPrompt,
        preset
      );
      const completedAt = Date.now();
      const firstResponseAt = result.firstResponseAt || completedAt;

      this.mutate((state) => ({
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: completedAt,
                entries: session.entries.map((entry) =>
                  entry.id === entryId
                    ? {
                        ...entry,
                        status: 'completed',
                        completedAt,
                        firstResponseAt,
                        firstResponseMs: firstResponseAt - startedAt,
                        totalDurationMs: completedAt - startedAt,
                        preview: sanitizePreview(result),
                        errorSummary: null,
                      }
                    : entry
                ),
              }
            : session
        ),
      }));
      trackBenchmarkEvent('model_benchmark_entry_completed', {
        sessionId,
        entryId,
        modality: latestEntry.modality,
        compareMode: latestSession.compareMode,
        profileId: latestEntry.profileId,
        profileName: latestEntry.profileName,
        modelId: latestEntry.modelId,
        vendor: latestEntry.vendor,
        firstResponseMs: firstResponseAt - startedAt,
        totalDurationMs: completedAt - startedAt,
        hasPreview: Boolean(result.text || result.url || result.urls?.length),
        resultCount: result.urls?.length || (result.url || result.text ? 1 : 0),
        format: result.format,
      });
    } catch (error) {
      const completedAt = Date.now();
      const latestSession = this.state$.value.sessions.find(
        (session) => session.id === sessionId
      );
      const latestEntry = latestSession?.entries.find(
        (entry) => entry.id === entryId
      );
      this.mutate((state) => ({
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                updatedAt: completedAt,
                entries: session.entries.map((entry) =>
                  entry.id === entryId
                    ? {
                        ...entry,
                        status: 'failed',
                        completedAt,
                        totalDurationMs: completedAt - startedAt,
                        errorSummary: summarizeError(error),
                      }
                    : entry
                ),
              }
            : session
        ),
      }));
      if (latestEntry && latestSession) {
        trackBenchmarkEvent('model_benchmark_entry_failed', {
          sessionId,
          entryId,
          modality: latestEntry.modality,
          compareMode: latestSession.compareMode,
          profileId: latestEntry.profileId,
          profileName: latestEntry.profileName,
          modelId: latestEntry.modelId,
          vendor: latestEntry.vendor,
          totalDurationMs: completedAt - startedAt,
          errorMessage: summarizeError(error),
        });
      }
    }
  }
}

export function buildBenchmarkTarget(
  profileId: string,
  profileName: string,
  model: ModelConfig
): ModelBenchmarkTarget {
  return {
    profileId,
    profileName,
    modelId: model.id,
    modelLabel: model.shortLabel || model.label || model.id,
    modality: model.type,
    vendor: model.vendor,
    selectionKey:
      model.selectionKey || buildBenchmarkSelectionKey(profileId, model.id),
  };
}

export {
  BENCHMARK_PROMPT_PRESETS,
  getDefaultPromptPreset,
  rankBenchmarkEntries,
  computeValueScore,
};
export { resolvePromptPreset as resolveBenchmarkPromptPreset };

export const modelBenchmarkService = new ModelBenchmarkService();

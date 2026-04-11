import { BehaviorSubject, type Observable } from 'rxjs';
import { defaultGeminiClient } from '../utils/gemini-api';
import type { GeminiMessage } from '../utils/gemini-api/types';
import type { ModelConfig } from '../constants/model-config';
import type { ModelVendor } from '../constants/model-config';
import { kvStorageService } from './kv-storage-service';
import { generateTaskId } from '../utils/task-utils';
import { createModelRef } from '../utils/settings-manager';
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
  getDefaultPromptPreset,
  rankBenchmarkEntries,
  resolvePromptPreset,
  type BenchmarkModality,
  type BenchmarkPromptPreset,
  type BenchmarkRankingMode,
} from './model-benchmark-pure';

const STORAGE_KEY = 'aitu:model-benchmark:sessions';
const MAX_SESSIONS = 12;
const MAX_PERSISTED_TEXT_LENGTH = 4000;
const MAX_PERSISTED_URL_LENGTH = 120000;
const DEFAULT_CONCURRENCY = 2;

export type BenchmarkCompareMode =
  | 'cross-provider'
  | 'cross-model'
  | 'custom';
export type BenchmarkEntryStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';
export type BenchmarkSessionStatus =
  | 'draft'
  | 'running'
  | 'completed'
  | 'partial';

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

export interface CreateBenchmarkSessionInput {
  modality: BenchmarkModality;
  compareMode: BenchmarkCompareMode;
  promptPresetId: string;
  prompt: string;
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

function buildSelectionKey(profileId: string, modelId: string): string {
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

function sanitizePreview(preview: ModelBenchmarkPreview): ModelBenchmarkPreview {
  return {
    text: sanitizeText(preview.text),
    url: sanitizeUrl(preview.url),
    urls: preview.urls
      ?.map((item) => sanitizeUrl(item))
      .filter(Boolean) as string[] | undefined,
    format: preview.format,
    duration: preview.duration,
    title: sanitizeText(preview.title),
  };
}

function sanitizeEntry(
  entry: ModelBenchmarkEntry
): ModelBenchmarkEntry {
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
  modality: BenchmarkModality,
  compareMode: BenchmarkCompareMode,
  createdAt: number
): string {
  const modalityLabel =
    modality === 'text'
      ? '文本'
      : modality === 'image'
      ? '图片'
      : modality === 'video'
      ? '视频'
      : '音频';
  const modeLabel =
    compareMode === 'cross-provider'
      ? '同模型跨供应商'
      : compareMode === 'cross-model'
      ? '同供应商跨模型'
      : '自定义批测';
  const timeLabel = new Date(createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${modeLabel} · ${modalityLabel} · ${timeLabel}`;
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
    getAdapterContextFromSettings('image', modelRef),
    request
  );
  return {
    firstResponseAt,
    url: result.url,
    urls: result.urls,
    format: result.format,
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
      const persisted =
        await kvStorageService.get<ModelBenchmarkStoreState>(STORAGE_KEY);
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
      title: createSessionTitle(
        input.modality,
        input.compareMode,
        createdAt
      ),
      modality: input.modality,
      compareMode: input.compareMode,
      promptPresetId: input.promptPresetId,
      prompt: input.prompt,
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

    return session;
  }

  removeSession(sessionId: string) {
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
  }

  setRankingMode(sessionId: string, rankingMode: BenchmarkRankingMode) {
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
  }

  setEntryFeedback(
    sessionId: string,
    entryId: string,
    updates: Partial<
      Pick<ModelBenchmarkEntry, 'userScore' | 'favorite' | 'rejected'>
    >
  ) {
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

    const preset = resolvePromptPreset(
      currentSession.promptPresetId,
      currentSession.modality
    );
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
            await this.runEntry(sessionId, next.id, preset);
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
        const hasFailed = session.entries.some((entry) => entry.status === 'failed');
        return {
          ...session,
          status: hasFailed ? 'partial' : 'completed',
          updatedAt: Date.now(),
        };
      }),
    }));
  }

  private async runEntry(
    sessionId: string,
    entryId: string,
    preset: BenchmarkPromptPreset
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
      const latestEntry = latestSession?.entries.find((entry) => entry.id === entryId);
      if (!latestSession || !latestEntry) {
        return;
      }
      const result = await executeBenchmark(
        latestEntry,
        latestSession.prompt,
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
    } catch (error) {
      const completedAt = Date.now();
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
      model.selectionKey || buildSelectionKey(profileId, model.id),
  };
}

export { BENCHMARK_PROMPT_PRESETS, getDefaultPromptPreset, rankBenchmarkEntries };
export { resolvePromptPreset as resolveBenchmarkPromptPreset };

export const modelBenchmarkService = new ModelBenchmarkService();

import type { ModelRef } from '../utils/settings-types';
import {
  providerTransport,
  listSettingsProviderProfiles,
  resolveInvocationPlanFromRoute,
  type InvocationPlan,
} from './provider-routing';

export const OPENAI_AUDIO_SPEECH_PROTOCOL = 'openai.audio.speech' as const;
export const OPENAI_AUDIO_SPEECH_REQUEST_SCHEMA =
  'openai.audio.speech.json' as const;
export const DEFAULT_OPENAI_SPEECH_MODEL = 'gpt-4o-mini-tts' as const;

export type SpeechAudioFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';

export interface GenerateSpeechInput {
  model: string | ModelRef;
  text: string;
  voice: string;
  format?: SpeechAudioFormat;
  speed?: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

export interface GeneratedSpeechAudio {
  blob: Blob;
  mimeType: string;
  format: SpeechAudioFormat;
  modelRef: ModelRef;
}

export class SpeechProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechProviderError';
  }
}

function createBuiltInSpeechPlan(model: string | ModelRef): InvocationPlan | null {
  const requestedProfileId =
    typeof model === 'string' ? null : model.profileId?.trim() || null;
  const profile = listSettingsProviderProfiles().find(
    (candidate) =>
      (requestedProfileId ? candidate.id === requestedProfileId : true) &&
      Boolean(candidate.baseUrl.trim() && candidate.apiKey.trim())
  );
  if (!profile) return null;
  const modelId =
    (typeof model === 'string' ? model : model.modelId)?.trim() ||
    DEFAULT_OPENAI_SPEECH_MODEL;
  return {
    provider: {
      profileId: profile.id,
      profileName: profile.name,
      providerType: profile.providerType,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      authType: profile.authType,
      extraHeaders: profile.extraHeaders,
    },
    modelRef: { profileId: profile.id, modelId },
    binding: {
      id: `${profile.id}:${modelId}:builtin-speech`,
      profileId: profile.id,
      modelId,
      operation: 'audio',
      protocol: OPENAI_AUDIO_SPEECH_PROTOCOL,
      requestSchema: OPENAI_AUDIO_SPEECH_REQUEST_SCHEMA,
      responseSchema: 'openai.audio.speech.audio',
      submitPath: '/audio/speech',
      priority: 1000,
      confidence: 'high',
      source: 'template',
    },
  };
}

export function resolveSpeechPlan(model: string | ModelRef): InvocationPlan {
  const plan = resolveInvocationPlanFromRoute('audio', model, {
    preferredRequestSchema: OPENAI_AUDIO_SPEECH_REQUEST_SCHEMA,
  });
  const compatiblePlan =
    plan?.binding.protocol === OPENAI_AUDIO_SPEECH_PROTOCOL &&
    plan.binding.requestSchema === OPENAI_AUDIO_SPEECH_REQUEST_SCHEMA
      ? plan
      : createBuiltInSpeechPlan(model);
  if (!compatiblePlan) {
    throw new SpeechProviderError(
      '当前供应商账号不可用于内置 TTS，请检查供应商地址和 API Key'
    );
  }
  if (!compatiblePlan.provider.baseUrl.trim()) {
    throw new SpeechProviderError('TTS 供应商地址未配置');
  }
  if (!compatiblePlan.provider.apiKey.trim()) {
    throw new SpeechProviderError('TTS 供应商 API Key 未配置');
  }
  return compatiblePlan;
}

function normalizeInput(input: GenerateSpeechInput): {
  text: string;
  voice: string;
  format: SpeechAudioFormat;
  speed?: number;
} {
  const text = input.text.trim();
  const voice = input.voice.trim();
  if (!text) throw new SpeechProviderError('TTS 文本不能为空');
  if (!voice) throw new SpeechProviderError('TTS 声音 ID 不能为空');
  if (
    input.speed !== undefined &&
    (!Number.isFinite(input.speed) || input.speed <= 0)
  ) {
    throw new SpeechProviderError('TTS 语速必须大于 0');
  }
  return {
    text,
    voice,
    format: input.format || 'mp3',
    ...(input.speed !== undefined ? { speed: input.speed } : {}),
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return response.statusText || `HTTP ${response.status}`;
  try {
    const payload = JSON.parse(text) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    if (typeof payload.error === 'string') return payload.error;
    if (typeof payload.error?.message === 'string') return payload.error.message;
    if (typeof payload.message === 'string') return payload.message;
  } catch {
    // Preserve a bounded plain-text provider error below.
  }
  return text.trim().slice(0, 500);
}

export async function generateSpeechAudio(
  input: GenerateSpeechInput
): Promise<GeneratedSpeechAudio> {
  const normalized = normalizeInput(input);
  const plan = resolveSpeechPlan(input.model);
  input.signal?.throwIfAborted();

  const response = await providerTransport.send(plan.provider, {
    path: plan.binding.submitPath,
    baseUrlStrategy: plan.binding.baseUrlStrategy,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'audio/*',
    },
    body: JSON.stringify({
      model: plan.modelRef.modelId,
      input: normalized.text,
      voice: normalized.voice,
      response_format: normalized.format,
      ...(normalized.speed !== undefined ? { speed: normalized.speed } : {}),
    }),
    signal: input.signal,
    fetcher: input.fetcher,
  });

  if (!response.ok) {
    throw new SpeechProviderError(
      `TTS 请求失败（HTTP ${response.status}）：${await readErrorMessage(
        response
      )}`
    );
  }

  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ||
    '';
  if (
    contentType.includes('application/json') ||
    contentType.startsWith('text/')
  ) {
    throw new SpeechProviderError('TTS 接口返回了文本/JSON，而不是音频二进制');
  }
  const blob = await response.blob();
  input.signal?.throwIfAborted();
  if (!blob.size) throw new SpeechProviderError('TTS 接口返回了空音频');

  return {
    blob,
    mimeType: contentType || blob.type || `audio/${normalized.format}`,
    format: normalized.format,
    modelRef: {
      profileId: plan.modelRef.profileId,
      modelId: plan.modelRef.modelId,
    },
  };
}

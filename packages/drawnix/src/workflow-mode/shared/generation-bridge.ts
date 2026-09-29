import type { Capability, ModelDefaults } from './model-defaults';

export const NATIVE_MODELS_REQUEST = 'opentu:native-models:request:v1';
export const NATIVE_MODELS_RESPONSE = 'opentu:native-models:response:v1';
export const OPEN_PROVIDER_SETTINGS = 'opentu:provider-settings:open:v1';
export const GENERATE_REQUEST = 'opentu:generate:request:v1';
export const GENERATE_RESPONSE = 'opentu:generate:response:v1';
export const GENERATE_CANCEL = 'opentu:generate:cancel:v1';

export interface GenerationRequest {
  capability: Capability;
  channelId: string;
  model: string;
  prompt: string;
  images: string[];
  params?: Record<string, string | number | boolean>;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  videos?: string[];
  audios?: string[];
  size?: string;
  quality?: string;
  count?: number;
  duration?: number;
  background?: 'transparent' | 'opaque' | 'auto';
  voice?: string;
  format?: string;
  speed?: string;
  resolution?: string;
  aspectRatio?: string;
  generateAudio?: boolean;
  watermark?: boolean;
}
export interface GenerationResult {
  resultKind?: 'image' | 'video' | 'audio' | 'lyrics' | 'text';
  urls?: string[];
  text?: string;
}

export function isGenerationRequest(
  value: unknown
): value is GenerationRequest {
  if (!value || typeof value !== 'object') return false;
  const data = value as GenerationRequest;
  return (
    ['image', 'video', 'audio', 'text'].includes(data.capability) &&
    typeof data.channelId === 'string' &&
    typeof data.model === 'string' &&
    typeof data.prompt === 'string' &&
    Array.isArray(data.images) &&
    (data.params === undefined ||
      (!!data.params &&
        typeof data.params === 'object' &&
        !Array.isArray(data.params) &&
        Object.values(data.params).every(
          (value) =>
            typeof value === 'string' ||
            typeof value === 'boolean' ||
            (typeof value === 'number' && Number.isFinite(value))
        ))) &&
    (data.messages === undefined ||
      (Array.isArray(data.messages) &&
        data.messages.every(
          (message) =>
            message &&
            ['system', 'user', 'assistant'].includes(message.role) &&
            typeof message.content === 'string'
        ))) &&
    ['videos', 'audios'].every((key) => {
      const urls = data[key as 'videos'];
      return (
        urls === undefined ||
        (Array.isArray(urls) &&
          urls.every(
            (url) =>
              typeof url === 'string' &&
              (/^(https?:|data:(video|audio)\/|blob:)/i.test(url) ||
                (key === 'audios' &&
                  (/^asset:\/\/[a-z0-9][a-z0-9._/-]*$/i.test(url) ||
                    (url.length <= 512 &&
                      /^[a-z0-9][a-z0-9._/-]*$/i.test(url)))))
          ))
      );
    }) &&
    data.images.every(
      (url) =>
        typeof url === 'string' && /^(https?:|data:image\/|blob:)/i.test(url)
    ) &&
    [
      'size',
      'quality',
      'voice',
      'format',
      'speed',
      'resolution',
      'aspectRatio',
    ].every(
      (key) =>
        data[key as keyof GenerationRequest] === undefined ||
        typeof data[key as keyof GenerationRequest] === 'string'
    ) &&
    ['generateAudio', 'watermark'].every(
      (key) =>
        data[key as keyof GenerationRequest] === undefined ||
        typeof data[key as keyof GenerationRequest] === 'boolean'
    ) &&
    (data.background === undefined ||
      ['transparent', 'opaque', 'auto'].includes(data.background)) &&
    (data.count === undefined ||
      (Number.isInteger(data.count) && data.count > 0)) &&
    (data.duration === undefined ||
      (Number.isFinite(data.duration) && data.duration > 0))
  );
}

export function mergeNativeModels<
  T extends {
    channels: ModelDefaults['channels'];
    models: string[];
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
  }
>(config: T, incoming: ModelDefaults): T {
  const incomingIds = new Set(incoming.channels.map((channel) => channel.id));
  const channels = config.channels.flatMap((channel) => {
    if (channel.opentuProfileId === undefined || incomingIds.has(channel.id)) return [channel];
    const scripts = channel.models.filter((model) => model.script);
    return scripts.length ? [{ ...channel, models: scripts }] : [];
  });
  for (const channel of incoming.channels) {
    const existing = channels.find((item) => item.id === channel.id);
    if (!existing) channels.push(channel);
    else {
      const models = channel.models.map((model) => {
        const previous = existing.models.find(
          (item) =>
            item.name === model.name && item.capability === model.capability
        );
        return {
          ...model,
          ...(previous?.script ? { script: previous.script } : {}),
        };
      });
      models.push(...existing.models.filter((model) => model.script && !models.some((current) => current.name === model.name && current.capability === model.capability)));
      channels[channels.indexOf(existing)] = {
        ...existing,
        ...channel,
        models,
      };
    }
  }
  const next = {
    ...config,
    channels,
    models: channels.flatMap((channel) =>
      channel.models.map((model) => channel.id + '::' + model.name)
    ),
  };
  for (const capability of ['image', 'video', 'text', 'audio'] as const) {
    const key = `${capability}Model` as const;
    if (!next[key] || !next.models.includes(next[key]))
      next[key] = incoming.defaults[capability];
  }
  return next;
}

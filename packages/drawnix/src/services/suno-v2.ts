import { isSunoNativeModel } from './suno-native';
import catalog from './suno-v2-catalog.json';
import type { AudioTaskResponse, AudioGenerationParams, SunoV2Resource, SunoV2Result } from './audio-api-types';
import type { AudioGenerationResult } from './model-adapters/types';
export type { SunoV2Resource, SunoV2Result } from './audio-api-types';

export interface SunoV2Field {
  name: string;
  label: string;
  description?: string;
  type: string;
  enum?: string[];
  enumLabels?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  items?: { type: string };
}

// A documented action does not establish a currently available Tuzi model.
// These models are explicitly excluded from this integration.
const UNAVAILABLE_V2_ACTIONS = new Set(['create-voice', 'add-instrumental', 'add-vocals']);

export const SUNO_V2_ACTIONS = catalog.actions.map((action) => ({
  ...action,
  supported: !UNAVAILABLE_V2_ACTIONS.has(action.action),
}));

export function isSunoV2Model(model?: string | null): boolean {
  return typeof model === 'string' && model.toLowerCase().startsWith('suno/');
}

export function isUnavailableSunoModel(model?: string | null): boolean {
  const id = model?.trim().toLowerCase() || '';
  if (isSunoNativeModel(id)) return false;
  if (isSunoV2Model(id)) return !getSunoV2Action(id)?.supported;
  return /^(suno_|suno-all-stems$)/.test(id) && !['suno_music', 'suno_lyrics'].includes(id);
}

export function isSunoV2FieldVisible(field: SunoV2Field, body: Record<string, unknown>): boolean {
  if (field.name === 'gpt_description_prompt') return body.custom !== true;
  if (body.custom === false && ['prompt', 'persona_id', 'max_mode', 'auto_lyrics'].includes(field.name)) return false;
  return true;
}

export function getSunoV2Action(model?: string | null) {
  return SUNO_V2_ACTIONS.find((action) => action.model === model?.toLowerCase()) || null;
}

export function getSunoV2Fields(model: string): SunoV2Field[] {
  const fields = catalog.fields as Record<string, Omit<SunoV2Field, 'name'>>;
  return (getSunoV2Action(model)?.fields || []).map((key) => ({
    ...fields[key], name: key.slice(key.lastIndexOf(':') + 1),
  }));
}

export function assertSunoV2Action(model: string) {
  const action = getSunoV2Action(model);
  if (!action?.supported) throw new Error('该 Suno v2 动作当前不可用');
  return action;
}

export function buildSunoV2Body(
  params: AudioGenerationParams,
  profileId: string
): Record<string, unknown> {
  const model = params.modelRef?.modelId || params.model;
  const action = assertSunoV2Action(model);
  const fields = getSunoV2Fields(model);
  const explicit = params.params?.sunoV2Body;
  const body: Record<string, unknown> = explicit && typeof explicit === 'object' && !Array.isArray(explicit)
    ? { ...(explicit as Record<string, unknown>) }
    : action.action === 'lyrics'
    ? { prompt: params.prompt }
    : action.action === 'music'
    ? { custom: true, instrumental: params.instrumental === true, prompt: params.prompt,
        ...(params.title ? { title: params.title } : {}),
        ...(params.tags ? { tags: params.tags } : {}),
        ...(params.mv ? { mv: params.mv } : {}) }
    : {};

  for (const key of Object.keys(body)) {
    if (!fields.some((field) => field.name === key)) {
      throw new Error(`Suno v2 ${action.label} 不支持参数 ${key}`);
    }
    if (body[key] === undefined || body[key] === '') delete body[key];
  }
  for (const required of action.required) {
    if (body[required] === undefined || body[required] === null) {
      throw new Error(`Suno v2 缺少必填参数 ${required}`);
    }
  }
  for (const field of fields) {
    const value = body[field.name];
    if (value === undefined) continue;
    const type = field.type;
    const valid = type === 'array' ? Array.isArray(value)
      : type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
      : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : typeof value === type;
    if (!valid || (typeof value === 'string' && !value.trim()) || (field.enum && !field.enum.includes(value as string))) {
      throw new Error(`${field.label} 参数无效`);
    }
    if (typeof value === 'number' && (
      (field.minimum !== undefined && value < field.minimum) ||
      (field.maximum !== undefined && value > field.maximum))) throw new Error(`${field.label} 超出范围`);
    if (typeof value === 'string' && ((field.minLength !== undefined && Array.from(value).length < field.minLength) ||
      (field.maxLength !== undefined && Array.from(value).length > field.maxLength))) throw new Error(`${field.label} 长度超出范围`);
    if (Array.isArray(value) && (
      (field.minItems !== undefined && value.length < field.minItems) ||
      (field.maxItems !== undefined && value.length > field.maxItems) ||
      value.some((item) => typeof item !== field.items?.type || !String(item).trim()))) {
      throw new Error(`${field.label} 列表无效`);
    }
  }
  for (const key of ['continue_at', 'infill_start_s', 'infill_end_s', 'chop_sample_start_s', 'chop_sample_end_s']) {
    if (typeof body[key] === 'number' && (body[key] as number) < 0) throw new Error('时间不能小于 0');
  }
  for (const [start, end] of [['infill_start_s', 'infill_end_s'], ['chop_sample_start_s', 'chop_sample_end_s']]) {
    const startValue = body[start];
    const endValue = body[end];
    if (typeof startValue === 'number' && typeof endValue === 'number' && startValue >= endValue) {
      throw new Error('开始时间必须小于结束时间');
    }
  }
  for (const key of ['style_weight', 'weirdness_constraint', 'audio_weight']) {
    if (typeof body[key] === 'number' && ((body[key] as number) < 0 || (body[key] as number) > 1)) throw new Error(`${key} 必须在 0 到 1 之间`);
  }
  if (typeof body.duration === 'number' && (body.duration < 10 || body.duration > 360)) throw new Error('时长必须在 10 到 360 秒之间');
  if (body.persona_id && body.model_id) throw new Error('音色与自建模型不能同时选择');
  if (typeof body.speed_multiplier === 'number' && (body.speed_multiplier < 0.25 || body.speed_multiplier > 4)) throw new Error('速度倍率必须在 0.25 到 4 之间');
  if (body.bpm !== undefined && (!Number.isFinite(Number(body.bpm)) || Number(body.bpm) < 1 || Number(body.bpm) > 300)) throw new Error('节拍必须在 1 到 300 之间');
  if (body.vocal_start_s !== undefined || body.vocal_end_s !== undefined) {
    if (typeof body.vocal_start_s !== 'number' || typeof body.vocal_end_s !== 'number' ||
      body.vocal_start_s < 0 || body.vocal_end_s <= body.vocal_start_s || body.vocal_end_s - body.vocal_start_s >= 30) {
      throw new Error('人声起点和终点须一起填写，终点须大于起点，区间须短于 30 秒');
    }
  }
  if (Array.isArray(body.formats) && (!body.formats.length || body.formats.some((format) => !['mp3', 'm4a', 'wav'].includes(format as string)))) {
    throw new Error('导出格式无效');
  }
  if (body.custom === false && ['music', 'cover', 'upload-cover', 'mashup', 'sample'].includes(action.action) && !body.gpt_description_prompt) {
    throw new Error('请填写灵感描述');
  }
  for (const [key, max] of [['prompt', 5000], ['gpt_description_prompt', 3000], ['title', 80], ['tags', 1000]] as const) {
    if (typeof body[key] === 'string' && Array.from(body[key] as string).length > max) throw new Error(`${key} 超过 ${max} 字`);
  }
  for (const key of ['audio_url', 'audio_urls']) {
    const urls = Array.isArray(body[key]) ? body[key] as string[] : body[key] ? [body[key] as string] : [];
    for (const value of urls) {
      let url: URL;
      try { url = new URL(value); } catch { throw new Error('请填写可公开下载的音频 HTTP/HTTPS 地址'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('音频地址必须使用 HTTP/HTTPS');
    }
  }
  const resources = (params.params?.sunoV2Resources || []) as SunoV2Resource[];
  for (const key of ['music_id', 'persona_id', 'model_id', 'file_id', 'mashup_music_id']) {
    const ids = Array.isArray(body[key]) ? body[key] as string[] : body[key] ? [body[key] as string] : [];
    if (key === 'mashup_music_id' && new Set(ids).size !== ids.length) throw new Error('混音需要两首不同歌曲');
    for (const id of ids) {
      const kind = key === 'mashup_music_id' ? 'music_id' : key;
      if (!Array.isArray(resources) || !resources.some((resource) => resource.id === id && resource.kind === kind && resource.profileId === profileId)) {
        throw new Error('请选择当前渠道已完成的 Suno v2 资源');
      }
    }
  }
  return body;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function httpUrl(value: unknown): string {
  const url = text(value);
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? url : '';
  } catch { return ''; }
}

export function normalizeSunoV2Response(
  payload: unknown, fallbackTaskId: string, profileId: string, fallbackAction?: string
): AudioTaskResponse {
  const outer = record(payload);
  const code = String(outer.code ?? '').toLowerCase();
  if (code && !['success', '200', 'ok'].includes(code)) {
    throw Object.assign(new Error(text(outer.message) || `Suno v2 请求失败 (${code})`), { workflowProviderFailure: true });
  }
  // Tuzi fetch wraps a flattened task in data; suppliers may retain data.data.
  const task = outer.status ? outer : record(outer.data);
  const data = { ...task, ...record(task.data) };
  const action = text(task.action || outer.action || fallbackAction).toLowerCase();
  const status = text(task.status || outer.status).toUpperCase();
  const failed = ['FAILED', 'FAILURE', 'ERROR', 'CANCELLED'].includes(status);
  const complete = ['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'COMPLETE'].includes(status);
  const musics = Array.isArray(data.musics) ? data.musics.map(record) : [];
  const resources: SunoV2Resource[] = [];
  const collectResources = (item: Record<string, unknown>) => {
    for (const kind of ['music_id', 'persona_id', 'model_id', 'file_id'] as const) {
      const id = text(item[kind]);
      if (id && !resources.some((r) => r.id === id && r.kind === kind)) resources.push({
        id, kind, profileId, title: text(item.title) || undefined, audioUrl: httpUrl(item.audio_url) || undefined,
      });
    }
  };
  for (const music of musics) collectResources(music);
  collectResources(data);
  const resultItems = Array.isArray(data.result) ? data.result.map(record) : [record(data.result)];
  const files: SunoV2Result['files'] = [];
  for (const item of resultItems) {
    collectResources(item);
    const children = Array.isArray(item.files) ? item.files.map(record) : [];
    for (const file of [item, ...children]) {
      const fileUrl = httpUrl(file.file_url);
      if (fileUrl) files.push({ format: text(file.format) || undefined, fileUrl });
    }
  }
  if (action === 'gen-midi') {
    const collectMidiFiles = (value: unknown, depth = 0) => {
      if (depth > 8 || !value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach((item) => collectMidiFiles(item, depth + 1)); return; }
      const item = record(value);
      const fileUrl = httpUrl(item.midi_url || item.file_url);
      if (fileUrl && !files.some((file) => file.fileUrl === fileUrl)) files.push({ format: 'midi', fileUrl });
      Object.values(item).forEach((child) => collectMidiFiles(child, depth + 1));
    };
    collectMidiFiles(data.result);
  }
  const lyrics = (Array.isArray(data.lyrics) ? data.lyrics : []).map((item: unknown) => {
    const value = record(item);
    return { text: text(typeof item === 'string' ? item : value.text || value.lyrics || value.prompt),
      title: text(value.title) || undefined,
      tags: Array.isArray(value.tags) ? value.tags.filter((tag: unknown) => typeof tag === 'string')
        : text(value.tags) ? text(value.tags).split(',').map((tag) => tag.trim()).filter(Boolean) : undefined };
  }).filter((item: { text: string }) => !!item.text);
  const clips = musics.map((music: Record<string, unknown>, index: number) => ({
    ...music, title: text(music.title) || undefined,
    duration: typeof music.duration === 'number' ? music.duration : null,
    audio_url: httpUrl(music.audio_url) || undefined,
    clip_id: text(music.music_id) || undefined, batch_index: index,
  }));
  const v2: SunoV2Result = { action, profileId, resources, files, lyrics, data: data.result ?? data };
  const expected = getSunoV2Action(`suno/${action}`)?.resultKind;
  const valid = expected === 'musics' ? clips.some((clip) => !!text(clip.audio_url) || !!text(clip.clip_id))
    : expected === 'lyrics' ? lyrics.length > 0
    : ['persona_id', 'model_id', 'file_id'].includes(expected || '') ? resources.some((resource) => resource.kind === expected)
    : action === 'download' ? files.length > 0
    : action === 'upsample-tags' ? !!text(record(data.result).upsampled_tags)
    : action === 'aligned-lyrics' ? [record(data.result).alignment, record(data.result).waveform_data].some((value) => Array.isArray(value) && value.length > 0)
    : action === 'gen-midi' ? files.length > 0 || (Array.isArray(record(data.result).instruments) && (record(data.result).instruments as unknown[]).length > 0)
    : resources.length > 0 || files.length > 0;
  if (complete && !valid) throw Object.assign(new Error('Suno v2 已完成但未返回有效结果'), { workflowProviderFailure: true });
  return {
    taskId: text(task.task_id || outer.task_id) || fallbackTaskId,
    action, status: failed ? 'failed' : complete ? 'completed' : 'processing',
    progress: complete ? 100 : Number.parseFloat(String(task.progress || '0')) || 0,
    failReason: text(task.fail_reason || task.message || outer.message) || 'Suno v2 生成失败',
    clips,
    lyrics: lyrics[0] || null,
    sunoV2: v2,
    raw: payload,
  };
}

export function extractSunoV2Result(response: AudioTaskResponse): AudioGenerationResult | null {
  const data = response.sunoV2;
  if (!data) return null;
  const clips = response.clips.filter((clip) => !!text(clip.audio_url)).map((clip) => ({
    clipId: text(clip.clip_id) || undefined,
    audioUrl: text(clip.audio_url), title: text(clip.title) || undefined,
    imageUrl: text(clip.image_large_url || clip.image_url) || undefined,
    duration: typeof clip.duration === 'number' ? clip.duration : null,
  }));
  const urls = clips.map((clip) => clip.audioUrl);
  // MIDI and structured output remain downloadable details, never audio player/cache inputs.
  const audioFiles = data.action === 'gen-midi' ? [] : data.files;
  const url = urls[0] || audioFiles[0]?.fileUrl || '';
  return {
    url, urls: urls.length ? urls : audioFiles.map((file) => file.fileUrl),
    resultKind: data.lyrics.length ? 'lyrics' : 'audio',
    format: data.lyrics.length ? 'lyrics' : url ? data.files[0]?.format || url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || 'mp3' : 'json',
    lyricsText: data.lyrics[0]?.text, lyricsTitle: data.lyrics[0]?.title, lyricsTags: data.lyrics[0]?.tags,
    title: clips[0]?.title, imageUrl: clips[0]?.imageUrl,
    duration: clips[0]?.duration, clips, primaryClipId: clips[0]?.clipId,
    clipIds: clips.map((clip) => clip.clipId).filter((id): id is string => !!id),
    providerTaskId: response.taskId,
    analysisData: { sunoV2: data }, raw: response.raw,
  };
}

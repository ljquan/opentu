import catalog from './suno-native-catalog.json';
import type { AudioGenerationParams, AudioTaskResponse } from './audio-api-types';
import type { AudioGenerationResult } from './model-adapters/types';

export interface NativeSunoSchema {
  oneOf?: NativeSunoSchema[];
  type?: string; format?: string; description?: string; default?: unknown;
  enum?: (string | number | boolean)[]; required?: string[];
  properties?: Record<string, NativeSunoSchema>; items?: NativeSunoSchema;
  minimum?: number; maximum?: number; minItems?: number; maxItems?: number;
  minLength?: number; maxLength?: number; multipleOf?: number;
}
export interface NativeSunoAction {
  action: string; label: string; path: string; method: string; mime?: string;
  schema: NativeSunoSchema; resultKind: string; pollPath?: string; docsUrl?: string;
  legacy?: boolean;
}
export interface NativeSunoResource {
  profileId: string; taskId?: string; audioId?: string; personaId?: string; voiceId?: string;
  url?: string; title?: string; sourceAction: string;
}
export interface NativeSunoResult {
  action: string; profileId: string; resources: NativeSunoResource[];
  files: Array<{ url: string; kind: 'audio' | 'video' | 'image' | 'midi' | 'file'; label: string }>;
  lyrics: Array<{ text: string; title?: string }>; data: unknown;
}

export const SUNO_NATIVE_ACTIONS: NativeSunoAction[] = [
  ...catalog.actions as unknown as NativeSunoAction[],
  { action: 'legacy-upload', label: '旧版 URL 上传', path: '/suno/uploads/audio-url', method: 'POST', legacy: true,
    pollPath: '/suno/fetch/{taskId}', resultKind: 'upload', schema: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } } } },
  { action: 'legacy-concat', label: '旧版拼接', path: '/suno/submit/concat', method: 'POST', legacy: true,
    pollPath: '/suno/fetch/{taskId}', resultKind: 'audio', schema: { type: 'object', properties: {
      gpt_description_prompt: { type: 'string' }, task_id: { type: 'string' }, continue_clip_id: { type: 'string' }, prompt: { type: 'string' },
      mv: { type: 'string' }, title: { type: 'string' }, tags: { type: 'string' },
      continue_at: { type: 'number', minimum: 0 }, make_instrumental: { type: 'boolean' },
    } } },
];

// UI presets select an explicit documented endpoint. They do not rename models in a provider request.
const ENTRY_ACTIONS: Record<string, string> = {
  suno_native_generate: 'generate', suno_native_sounds: 'sounds', suno_native_extend: 'extend',
  suno_act_mp4: 'mp4', suno_act_wav: 'wav', suno_act_stems: 'stems', suno_act_vox: 'stems',
  suno_act_midi: 'midi', 'suno-midi': 'midi', suno_persona_create: 'persona',
  suno_act_tags: 'style', 'suno-tags': 'style', suno_act_timing: 'timestamped-lyrics',
  suno_uploads: 'legacy-upload', suno_concat: 'legacy-concat',
  'suno-all-stems': 'add-instrumental', 'suno-vocal-stems': 'add-vocals',
  'suno-remix-uploaded': 'upload-cover', 'suno-infill': 'replace-section',
};
export function isSunoNativeModel(model?: string | null): boolean {
  return !!ENTRY_ACTIONS[model?.trim().toLowerCase() || ''];
}
export function getSunoNativeAction(model: string, params?: Record<string, unknown>): NativeSunoAction {
  if (!isSunoNativeModel(model)) throw new Error('该模型不是已接入的 Suno 原生入口');
  const name = params?.sunoNativeAction ?? ENTRY_ACTIONS[model.trim().toLowerCase()];
  const action = SUNO_NATIVE_ACTIONS.find((item) => item.action === name);
  if (!action) throw new Error('未知 Suno 原生动作');
  return action;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function url(value: unknown): string {
  try { const u = new URL(text(value)); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
function failure(message: string): Error { return Object.assign(new Error(message), { workflowProviderFailure: true }); }

const CUSTOM_ONLY_FIELDS = ['title', 'negativeTags', 'duration', 'vocalGender', 'styleWeight', 'weirdnessConstraint', 'audioWeight', 'variety'];
export function isSunoNativeFieldVisible(action: NativeSunoAction, name: string, values: Record<string, unknown>): boolean {
  if (action.action === 'generate') {
    const custom = values.customMode === true || values.customMode === 'true';
    if (CUSTOM_ONLY_FIELDS.includes(name)) return custom;
    if (['imageUrls', 'videoUrls', 'audioUrls'].includes(name)) return !custom;
  }
  if (action.action === 'extend' && (values.instrumental === true || values.instrumental === 'true') && ['prompt', 'vocalGender'].includes(name)) return false;
  return true;
}

export function validateNativeSunoValue(value: unknown, schema: NativeSunoSchema, name: string): void {
  const valid = schema.type === 'array' ? Array.isArray(value)
    : schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : schema.type === 'integer' ? Number.isInteger(value)
    : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : !schema.type || typeof value === schema.type;
  if (!valid || (schema.enum && !schema.enum.includes(value as string))) throw new Error(`${name} 参数类型或选项无效`);
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) throw new Error(`${name} 超出范围`);
  if (typeof value === 'number' && schema.multipleOf && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-8) throw new Error(`${name} 步长无效`);
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if ((schema.minLength !== undefined && length < schema.minLength) || (schema.maxLength !== undefined && length > schema.maxLength)) throw new Error(`${name} 长度超出范围`);
    if ((schema.format === 'uri' || /(?:Url|URL)$/.test(name)) && !url(value)) throw new Error(`${name} 必须是 HTTP/HTTPS 地址`);
  }
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) throw new Error(`${name} 数量超出范围`);
    value.forEach((item, index) => validateNativeSunoValue(item, schema.items || {}, `${name}[${index}]`));
    if (/Urls$|UrlList$/.test(name) && value.some((item) => !url(item))) throw new Error(`${name} 必须是 HTTP/HTTPS 地址列表`);
  }
}
export function buildSunoNativeBody(params: AudioGenerationParams, profileId: string): Record<string, unknown> {
  const action = getSunoNativeAction(params.modelRef?.modelId || params.model, params.params);
  const body = { ...object(params.params?.sunoNativeBody) };
  const properties = action.schema.properties || {};
  for (const [name, value] of Object.entries(body)) {
    if (!properties[name]) throw new Error(`当前动作不支持参数 ${name}`);
    if (value === undefined || value === '') delete body[name];
  }
  for (const name of action.schema.required || []) if (body[name] === undefined || body[name] === null || (typeof body[name] === 'string' && !String(body[name]).trim())) throw new Error(`缺少必填参数 ${name}`);
  for (const [name, value] of Object.entries(body)) validateNativeSunoValue(value, properties[name], name);
  if (action.schema.oneOf && action.schema.oneOf.filter((branch) => branch.required?.every((name) => body[name] !== undefined && body[name] !== '')).length !== 1) throw new Error('请选择一种来源：已有任务和曲目，或上传音频地址');
  for (const [start, end] of [['vocalStart', 'vocalEnd'], ['vocalStartS', 'vocalEndS'], ['infillStartS', 'infillEndS']]) {
    if (typeof body[start] === 'number' && typeof body[end] === 'number' && Number(body[end]) <= Number(body[start])) throw new Error('结束时间必须晚于开始时间');
  }
  if (action.action === 'persona' && (body.vocalStart !== undefined || body.vocalEnd !== undefined)) {
    const length = Number(body.vocalEnd ?? 30) - Number(body.vocalStart ?? 0);
    if (length < 10 || length > 30) throw new Error('Persona 分析区间须为 10–30 秒');
  }
  if (action.action === 'generate') {
    const has = (key: string) => Array.isArray(body[key]) ? (body[key] as unknown[]).length > 0 : !!body[key];
    const sources = body.customMode === true ? ['style', 'lyrics', 'negativeTags'] : ['imageUrls', 'videoUrls', 'audioUrls', 'style', 'lyrics'];
    if (!sources.some(has)) throw new Error('请至少填写一种风格、歌词或对应模式的参考素材');
    if (body.customMode === false) {
      const count = ['imageUrls', 'videoUrls', 'audioUrls'].reduce((total, key) => total + (Array.isArray(body[key]) ? (body[key] as unknown[]).length : 0), 0) + Number(has('style')) + Number(has('lyrics'));
      if (count > 10) throw new Error('参考素材、风格和歌词总数不能超过 10');
    }
  }
  for (const name of Object.keys(body)) if (!isSunoNativeFieldVisible(action, name, body)) throw new Error(`当前模式不支持参数 ${name}`);
  if (action.action === 'legacy-concat' && !body.task_id && !body.continue_clip_id) throw new Error('拼接需要来源任务 ID 或曲目 ID');
  if (action.action === 'upload-stream' && !/^data:[^;,]*;base64,[A-Za-z0-9+/]+=*$/.test(String(body.file))) throw new Error('请选择要上传的文件');
  const resources = params.params?.sunoNativeResources;
  if (Array.isArray(resources)) {
    for (const key of ['taskId', 'audioId', 'personaId', 'voiceId', 'task_id', 'continue_clip_id']) {
      const resourceKey = key === 'task_id' ? 'taskId' : key === 'continue_clip_id' ? 'audioId' : key;
      const matches = resources.filter((resource) => (object(resource)[resourceKey] || (resourceKey === 'personaId' ? object(resource).voiceId : undefined)) === body[key] && body[key] !== undefined);
      if (matches.length && !matches.some((resource) => object(resource).profileId === profileId)) throw new Error('不能引用其他渠道的 Suno 资源');
    }
    const paired = resources.map(object).find((resource) => resource.profileId === profileId && resource.audioId === (body.audioId || body.continue_clip_id));
    if (paired?.taskId && (body.taskId || body.task_id) && paired.taskId !== (body.taskId || body.task_id)) throw new Error('任务 ID 和曲目 ID 不属于同一结果');
  }
  return body;
}

export function nativeSunoRequestBody(action: NativeSunoAction, body: Record<string, unknown>): BodyInit | undefined {
  if (action.method === 'GET') return undefined;
  if (action.mime !== 'multipart/form-data') return JSON.stringify(body);
  const form = new FormData();
  const data = String(body.file); const [header, encoded] = data.split(',');
  const binary = atob(encoded); const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  form.append('file', new Blob([bytes], { type: header.slice(5).split(';')[0] || 'application/octet-stream' }), text(body.fileName) || 'upload.bin');
  for (const [key, value] of Object.entries(body)) if (key !== 'file') form.append(key, String(value));
  return form;
}

export function normalizeSunoNativeResponse(payload: unknown, action: NativeSunoAction, profileId: string, fallbackTaskId = '', submitting = false): AudioTaskResponse {
  const outer = object(payload);
  if (outer.success === false || (outer.code !== undefined && !['200', 'success', 'ok'].includes(String(outer.code).toLowerCase()))) throw failure(text(outer.msg || outer.message || outer.error) || 'Suno 原生请求失败');
  if (outer.error) throw failure(text(outer.error) || text(object(outer.error).message) || 'Suno 原生接口不可用');
  const data = object(outer.data); const response = object(data.response);
  const publicId = fallbackTaskId || text(data.taskId || data.task_id) || text(outer.task_id) || text(outer.data);
  const rawStatus = String(data.status ?? data.successFlag ?? '').toUpperCase();
  const failed = /FAIL|ERROR|EXCEPTION/.test(rawStatus) || rawStatus === '3' || (rawStatus === '2' && ['midi', 'style'].includes(action.action));
  let complete = ['SUCCESS', 'COMPLETE', 'COMPLETED', '1'].includes(rawStatus) || (!action.pollPath && !publicId);
  if (['voice-validate', 'voice-regenerate'].includes(action.action) && rawStatus === 'WAIT_VALIDATING' && text(data.validateInfo)) complete = true;
  // Synchronous proxies may also return a source task ID. It does not make them asynchronous.
  if (!action.pollPath && outer.code === 200) complete = true;
  if (action.action.startsWith('upload-') && url(data.downloadUrl)) complete = true;
  const resources: NativeSunoResource[] = [];
  const files: NativeSunoResult['files'] = [];
  const lyrics: NativeSunoResult['lyrics'] = [];
  const clips: AudioTaskResponse['clips'] = [];
  const addFile = (value: unknown, kind: NativeSunoResult['files'][number]['kind'], label: string) => {
    const link = url(value); if (link && !files.some((file) => file.url === link)) files.push({ url: link, kind, label });
  };
  const items = [response.sunoData, response.originData, response.data, data.data, outer.data].find(Array.isArray) as unknown[] | undefined;
  for (const raw of items || []) {
    const item = object(raw);
    const audioUrl = url(item.audio_url || item.audioUrl || item.source_audio_url);
    const audioId = text(item.id || item.audioId || item.clip_id);
    if (audioId) resources.push({ profileId, taskId: publicId, audioId, url: audioUrl || undefined, title: text(item.title || item.stem_type_group_name), sourceAction: action.action });
    if (audioUrl) { addFile(audioUrl, 'audio', text(item.title || item.stem_type_group_name) || '音频'); clips.push({ clip_id: audioId, audio_url: audioUrl, title: text(item.title), duration: typeof item.duration === 'number' ? item.duration : undefined }); }
    if (action.resultKind === 'lyrics' && text(item.text)) lyrics.push({ text: text(item.text), title: text(item.title) });
  }
  for (const item of [data, response]) {
    if (text(item.personaId)) resources.push({ profileId, personaId: text(item.personaId), title: text(item.name), sourceAction: action.action });
    if (text(item.voiceId)) resources.push({ profileId, voiceId: text(item.voiceId), taskId: publicId, sourceAction: action.action });
    for (const [key, value] of Object.entries(item)) {
      if (key === 'videoUrl' || key === 'video_url') addFile(value, 'video', 'MP4');
      else if (key === 'images' && Array.isArray(value)) value.forEach((link) => addFile(link, 'image', '封面'));
      else if (/midiUrl|midi_url|midiFileUrl/.test(key)) addFile(value, 'midi', 'MIDI');
      else if (key === 'downloadUrl') addFile(value, 'file', text(data.fileName) || '上传文件');
      else if (/Url$|_url$/.test(key) && /audio|vocal|instrumental|drum|bass|piano|guitar|keyboard|percussion|string|synth|woodwind|brass|fx/i.test(key)) addFile(value, 'audio', key);
    }
  }
  const uploadData = object(data.data);
  if (action.resultKind === 'upload' && text(uploadData.id || uploadData.clip_id)) resources.push({ profileId, taskId: publicId, audioId: text(uploadData.id || uploadData.clip_id), sourceAction: action.action });
  const uploadUrl = url(data.downloadUrl || data.url || data.audio_url || uploadData.downloadUrl || uploadData.url || uploadData.audio_url);
  if (action.resultKind === 'upload' && uploadUrl) addFile(uploadUrl, 'file', '上传文件');
  if (action.resultKind === 'upload' && uploadUrl) resources.push({ profileId, taskId: publicId || undefined, url: uploadUrl, sourceAction: action.action });
  if (publicId && !resources.some((resource) => resource.taskId === publicId)) resources.push({ profileId, taskId: publicId, sourceAction: action.action });
  const details = action.legacy ? (data.data ?? data) : (outer.data ?? {});
  const valid = action.resultKind === 'audio' ? files.some((file) => file.kind === 'audio')
    : action.resultKind === 'video' ? files.some((file) => file.kind === 'video')
    : action.resultKind === 'image' ? files.some((file) => file.kind === 'image')
    : action.resultKind === 'lyrics' ? lyrics.length > 0
    : action.resultKind === 'persona' ? resources.some((resource) => resource.personaId)
    : action.resultKind === 'voice' ? resources.some((resource) => resource.voiceId)
    : action.resultKind === 'midi' ? files.some((file) => file.kind === 'midi') || (Array.isArray(object(data.midiData).instruments) && (object(data.midiData).instruments as unknown[]).length > 0)
    : action.resultKind === 'timeline' ? Array.isArray(data.alignedWords) && data.alignedWords.length > 0
    : action.resultKind === 'text' ? !!text(data.result || data.validateInfo)
    : action.resultKind === 'availability' ? typeof data.isAvailable === 'boolean'
    : action.resultKind === 'credits' ? typeof outer.data === 'number'
    : action.resultKind === 'upload' ? !!uploadUrl || resources.some((resource) => resource.audioId)
    : false;
  if (complete && !failed && !valid) throw failure('Suno 已完成但未返回有效结果');
  if (submitting && !complete && !failed && !publicId) throw failure('Suno 未返回任务 ID');
  return { taskId: publicId, action: action.action, status: failed ? 'failed' : complete ? 'completed' : 'processing',
    progress: complete ? 100 : 0, clips, failReason: failed ? text(data.errorMessage || data.fail_reason || data.error_message) || `Suno 任务失败（${rawStatus}）` : '',
    lyrics: lyrics[0] || null, sunoNative: { action: action.action, profileId, resources, files, lyrics, data: details }, raw: payload };
}

export function extractSunoNativeResult(response: AudioTaskResponse): AudioGenerationResult | null {
  const native = response.sunoNative; if (!native) return null;
  const audio = native.files.filter((file) => file.kind === 'audio');
  return { url: audio[0]?.url || '', urls: audio.map((file) => file.url),
    resultKind: native.lyrics.length ? 'lyrics' : 'audio', format: native.lyrics.length ? 'lyrics' : audio.length ? (native.action === 'wav' ? 'wav' : 'mp3') : 'json',
    lyricsText: native.lyrics[0]?.text, lyricsTitle: native.lyrics[0]?.title,
    providerTaskId: response.taskId || undefined,
    clips: response.clips.map((clip) => ({ clipId: text(clip.clip_id), audioUrl: text(clip.audio_url), title: text(clip.title) })),
    analysisData: { sunoNative: native }, raw: response.raw };
}

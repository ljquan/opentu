import type { ParamConfig } from '../constants/model-config';
import type { Task } from '../types/task.types';
import { SUNO_NATIVE_ACTIONS, isSunoNativeFieldVisible, buildSunoNativeBody, getSunoNativeAction, type NativeSunoResource, type NativeSunoResult } from './suno-native';

const labels: Record<string, string> = {
  taskId: '来源任务 ID', task_id: '来源任务 ID', audioId: '曲目 ID', continue_clip_id: '来源曲目 ID',
  personaId: 'Persona ID', personaModel: 'Persona 类型', model: 'Suno 版本',
  gpt_description_prompt: '创作描述', audioUrl: '音频地址', mv: 'Suno 版本', continue_at: '续写起点（秒）', make_instrumental: '纯音乐', prompt: '创作描述', lyrics: '歌词', fullLyrics: '完整歌词', style: '音乐风格', tags: '风格标签',
  title: '标题', negativeTags: '排除风格', customMode: '自定义模式', instrumental: '纯音乐',
  callBackUrl: '回调地址', calBackUrl: '回调地址', uploadUrl: '音频地址', uploadUrlList: '音频地址列表',
  continueAt: '续写起点（秒）', infillStartS: '替换起点（秒）', infillEndS: '替换终点（秒）',
  name: '名称', description: '描述', vocalStart: '人声起点（秒）', vocalEnd: '人声终点（秒）',
  vocalStartS: '人声起点（秒）', vocalEndS: '人声终点（秒）',
  vocalGender: '人声性别', styleWeight: '风格权重', weirdnessConstraint: '创意程度', audioWeight: '音频权重', variety: '多样性',
  content: '待扩写风格', type: '分轨模式', stemName: '乐器名称',
  author: '视频作者', domainName: '视频水印',
  voiceUrl: '原始人声音频地址', verifyUrl: '朗读验证录音地址', voiceName: '音色名称', singerSkillLevel: '演唱水平', language: '验证语言',
  file: '上传文件', base64Data: '上传文件', fileUrl: '文件地址', url: '音频地址', uploadPath: '上传目录', fileName: '文件名',
  soundLoop: '循环音效', soundTempo: '节拍', soundKey: '调性', grabLyrics: '获取歌词', duration: '时长（秒）',
  imageUrls: '图片地址列表', videoUrls: '视频地址列表', audioUrls: '音频参考地址列表',
};
export function collectSunoNativeResources(tasks: Task[], profileId?: string): NativeSunoResource[] {
  return tasks.filter((task) => task.status === 'completed').flatMap((task) => {
    const result = (task.result?.analysisData as { sunoNative?: NativeSunoResult } | undefined)?.sunoNative;
    if (result) return result.resources.filter((resource) => !profileId || resource.profileId === profileId);
    const sourceProfileId = task.params.modelRef?.profileId;
    if (!sourceProfileId || (profileId && sourceProfileId !== profileId) || !['suno_music', 'suno_lyrics'].includes(task.params.model || '')) return [];
    return (task.result?.clips || []).map((clip) => ({ profileId: sourceProfileId, sourceAction: 'legacy-music',
      taskId: task.result?.providerTaskId || task.remoteId, audioId: clip.clipId, url: clip.audioUrl, title: clip.title }));
  });
}
export function sunoNativeResourceKey(resource: NativeSunoResource): string {
  return JSON.stringify([resource.profileId, resource.sourceAction, resource.taskId, resource.audioId, resource.personaId, resource.voiceId, resource.url]);
}
export function getSunoNativeParams(model: string, values: Record<string, string> = {}, resources: NativeSunoResource[] = []): ParamConfig[] {
  const action = getSunoNativeAction(model, values);
  const common = { compatibleModels: [model], modelType: 'audio' as const };
  const params: ParamConfig[] = [{ ...common, id: 'sunoNativeAction', label: '制作动作', valueType: 'enum',
    options: SUNO_NATIVE_ACTIONS.map((entry) => ({ value: entry.action, label: entry.label })), defaultValue: action.action }];
  const sources = resources.filter((resource) => !!action.legacy === resource.sourceAction.startsWith('legacy-'));
  if (sources.length) params.push({ ...common, id: 'sunoNativeSource', label: '从已完成结果填入资源', valueType: 'enum', control: 'select',
    options: sources.map((resource) => ({ value: sunoNativeResourceKey(resource), label: resource.title || resource.audioId || resource.personaId || resource.taskId || resource.url || '资源' })) });
  for (const [name, schema] of Object.entries(action.schema.properties || {})) {
    if (!isSunoNativeFieldVisible(action, name, values)) continue;
    const required = action.schema.required?.includes(name);
    params.push({ ...common, id: name, label: `${labels[name] || name}${required ? ' *' : ''}`,
      description: `${name}${schema.description ? ` · ${schema.description}` : ''}`,
      valueType: schema.enum || schema.type === 'boolean' ? 'enum' : ['number', 'integer'].includes(schema.type || '') ? 'number' : 'string',
      control: name === 'file' || name === 'base64Data' ? 'file' : schema.type === 'boolean' ? 'switch'
        : schema.type === 'array' || ['prompt', 'lyrics', 'fullLyrics', 'description', 'content'].includes(name) ? 'textarea' : undefined,
      options: schema.type === 'boolean' ? [{ value: 'false', label: '关闭' }, { value: 'true', label: '开启' }]
        : schema.enum?.map((value) => ({ value: String(value), label: String(value) })),
      defaultValue: schema.default === undefined ? undefined : String(schema.default),
      min: schema.minimum, max: schema.maximum, integer: schema.type === 'integer', step: schema.type === 'integer' ? 1 : undefined });
  }
  return params;
}
export function buildSunoNativeInputParams(model: string, values: Record<string, string>, prompt: string, profileId: string, resources: NativeSunoResource[] = []) {
  const action = getSunoNativeAction(model, values);
  const body: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(action.schema.properties || {})) {
    if (!isSunoNativeFieldVisible(action, name, values)) continue;
    const value = values[name];
    if (value === undefined || value === '') { if (schema.default !== undefined) body[name] = schema.default; continue; }
    if (schema.type === 'boolean') { if (!['true', 'false'].includes(value)) throw new Error(`${name} 必须为开关值`); body[name] = value === 'true'; }
    else if (['integer', 'number'].includes(schema.type || '')) body[name] = value.trim() ? Number(value) : NaN;
    else if (schema.type === 'array') {
      if (value.trim().startsWith('[')) { try { body[name] = JSON.parse(value); } catch { throw new Error(`${name} 列表无效`); } }
      else body[name] = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    } else body[name] = value;
  }
  const sources = resources.filter((resource) => !!action.legacy === resource.sourceAction.startsWith('legacy-'));
  const source = sources.find((resource) => sunoNativeResourceKey(resource) === values.sunoNativeSource);
  if (values.sunoNativeSource && !source) throw new Error('所选来源资源已不可用，请重新选择');
  if (source) {
    if (source.profileId !== profileId) throw new Error('不能引用其他渠道的 Suno 资源');
    for (const [name, key] of Object.entries({ taskId: 'taskId', task_id: 'taskId', audioId: 'audioId', continue_clip_id: 'audioId', personaId: 'personaId', uploadUrl: 'url', audioUrl: 'url', voiceUrl: 'url' })) {
      const value = source[key as keyof NativeSunoResource];
      if (action.schema.oneOf && ['uploadUrl', 'audioUrl'].includes(name) && source.taskId && source.audioId) continue;
      if (value && action.schema.properties?.[name] && !body[name]) body[name] = value;
    }
  }
  if (source?.voiceId && action.schema.properties?.personaId && !body.personaId) { body.personaId = source.voiceId; body.personaModel = 'voice_persona'; }
  const promptField = action.action === 'style' ? 'content' : 'prompt';
  if (prompt.trim() && action.schema.properties?.[promptField] && isSunoNativeFieldVisible(action, promptField, body) && !body[promptField]) body[promptField] = prompt;
  const params = { sunoNativeAction: action.action, sunoNativeBody: body, sunoNativeResources: resources };
  buildSunoNativeBody({ model, prompt, params }, profileId);
  return params;
}

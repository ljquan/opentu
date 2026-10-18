import type { ParamConfig } from '../constants/model-config';
import type { Task } from '../types/task.types';
import {
  assertSunoV2Action, buildSunoV2Body, getSunoV2Fields, getSunoV2Action,
  isSunoV2FieldVisible, type SunoV2Resource, type SunoV2Result,
} from './suno-v2';

const RESOURCE_FIELDS = ['music_id', 'persona_id', 'model_id', 'file_id', 'mashup_music_id'];

export function collectSunoV2Resources(tasks: Task[], profileId: string): SunoV2Resource[] {
  const resources = tasks.filter((task) => task.status === 'completed')
    .flatMap((task) => (task.result?.analysisData as { sunoV2?: SunoV2Result } | undefined)?.sunoV2?.resources || [])
    .filter((resource) => resource.profileId === profileId);
  return Array.from(new Map(resources.map((resource) => [`${resource.kind}:${resource.id}`, resource])).values());
}

export function getSunoV2Params(model: string, resources: SunoV2Resource[] = []): ParamConfig[] {
  if (!getSunoV2Action(model)?.supported) return [];
  return getSunoV2Fields(model).map((field): ParamConfig => {
    const resource = RESOURCE_FIELDS.includes(field.name);
    const kind = field.name === 'mashup_music_id' ? 'music_id' : field.name;
    const options = resource
      ? resources.filter((item) => item.kind === kind).map((item) => ({ value: item.id, label: item.title ? `${item.title} (${item.id})` : item.id }))
      : field.name === 'formats'
      ? ['mp3', 'm4a', 'wav'].map((value) => ({ value, label: value.toUpperCase() }))
      : field.enum?.map((value, index) => ({ value, label: field.enumLabels?.[index] || value }));
    return {
      id: field.name, label: field.label, description: field.description,
      valueType: options || field.type === 'boolean' ? 'enum' : ['number', 'integer'].includes(field.type) ? 'number' : 'string',
      control: field.type === 'boolean' ? 'switch'
        : field.name === 'audio_urls' || ['prompt', 'gpt_description_prompt', 'infill_lyrics', 'sound'].includes(field.name) ? 'textarea'
        : field.type === 'array' ? 'multiselect' : resource ? 'select' : undefined,
      options: field.type === 'boolean' ? [{ value: 'false', label: '关闭' }, { value: 'true', label: '开启' }] : options,
      defaultValue: field.name === 'formats' ? '["mp3"]' : field.default === undefined ? undefined : String(field.default),
      min: field.minimum ?? (field.name === 'speed_multiplier' ? 0.25 : field.name === 'duration' ? 10 : /(?:_s|_at)$/.test(field.name) || ['style_weight', 'weirdness_constraint', 'audio_weight'].includes(field.name) ? 0 : undefined),
      max: field.maximum ?? (field.name === 'speed_multiplier' ? 4 : field.name === 'duration' ? 360 : ['style_weight', 'weirdness_constraint', 'audio_weight'].includes(field.name) ? 1 : undefined),
      step: field.type === 'integer' ? 1 : undefined, integer: field.type === 'integer',
      compatibleModels: [model], modelType: 'audio',
    };
  });
}

export function getVisibleSunoV2Params(model: string, params: ParamConfig[], values: Record<string, string>): ParamConfig[] {
  const custom = values.custom === undefined
    ? getSunoV2Fields(model).find((field) => field.name === 'custom')?.default
    : values.custom === 'true';
  return params.filter((param) => isSunoV2FieldVisible({ name: param.id, label: param.label, type: '' }, { custom }));
}

export function buildSunoV2InputParams(model: string, values: Record<string, string>, prompt: string,
  profileId: string, resources: SunoV2Resource[]) {
  const action = assertSunoV2Action(model);
  const body: Record<string, unknown> = {};
  for (const field of getSunoV2Fields(model)) {
    const value = values[field.name];
    if (value === undefined || value === '') {
      if (field.default !== undefined) body[field.name] = field.default;
      continue;
    }
    if (field.type === 'boolean') {
      if (!['true', 'false'].includes(value)) throw new Error(`${field.label} 参数无效`);
      body[field.name] = value === 'true';
    } else if (['number', 'integer'].includes(field.type)) {
      body[field.name] = value.trim() ? Number(value) : NaN;
    } else if (field.type === 'array') {
      if (field.name === 'audio_urls' && !value.trim().startsWith('[')) {
        body[field.name] = value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
      } else {
        try { body[field.name] = JSON.parse(value); } catch { throw new Error(`${field.label} 列表无效`); }
      }
    } else body[field.name] = value;
  }
  const fields = getSunoV2Fields(model);
  const promptField = body.custom === false && fields.some((field) => field.name === 'gpt_description_prompt')
    ? 'gpt_description_prompt' : action.action === 'sounds' ? 'sound' : action.action === 'upsample-tags' ? 'tags' : 'prompt';
  if (prompt.trim() && fields.some((field) => field.name === promptField) && !body[promptField]) body[promptField] = prompt;
  const visibleBody = Object.fromEntries(Object.entries(body).filter(([name]) => {
    const field = fields.find((item) => item.name === name);
    return field && isSunoV2FieldVisible(field, body);
  }));
  const params = { sunoV2Body: visibleBody, sunoV2Resources: resources };
  buildSunoV2Body({ model, prompt: prompt || action.label, params }, profileId);
  return params;
}

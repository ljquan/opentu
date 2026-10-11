import type { ProviderVideoBindingMetadata } from '../services/provider-routing/types';

export const VEO_ADVANCED_PARAMETER_IDS = [
  'negative_prompt',
  'generate_audio',
  'seed',
  'person_generation',
] as const;

export function getVeoPersonGenerationOptions(
  metadata?: ProviderVideoBindingMetadata | null
): readonly string[] {
  return metadata?.veoAdvancedParameters?.personGenerationOptions?.length
    ? metadata.veoAdvancedParameters.personGenerationOptions
    : ['dont_allow', 'allow_adult', 'allow_all'];
}

export function buildVeoAdvancedParameters(
  modelId: string,
  supplied?: Record<string, unknown>,
  metadata?: ProviderVideoBindingMetadata | null
): Record<string, unknown> | undefined {
  if (modelId !== 'veo3.1') return undefined;
  const result: Record<string, unknown> = {};
  for (const id of VEO_ADVANCED_PARAMETER_IDS) {
    const value = supplied?.[id];
    if (value === undefined || value === null || value === '') continue;
    if (id === 'generate_audio') {
      if (
        value !== true &&
        value !== false &&
        value !== 'true' &&
        value !== 'false'
      ) {
        throw new Error('Veo 生成音频参数必须为 true 或 false');
      }
      result.generateAudio = value === true || value === 'true';
    } else if (id === 'seed') {
      const seed =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim()
          ? Number(value)
          : NaN;
      const max =
        metadata?.veoAdvancedParameters?.seedMax ?? Number.MAX_SAFE_INTEGER;
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > max) {
        throw new Error('Veo 随机种子超出当前渠道范围或不是非负整数');
      }
      result.seed = seed;
    } else if (id === 'person_generation') {
      if (
        typeof value !== 'string' ||
        !getVeoPersonGenerationOptions(metadata).includes(value)
      ) {
        throw new Error('Veo 人物生成参数不受当前渠道支持');
      }
      result.personGeneration = value;
    } else {
      if (typeof value !== 'string')
        throw new Error('Veo 负向提示词必须为字符串');
      if (value.trim()) result.negativePrompt = value.trim();
    }
  }
  return Object.keys(result).length ? result : undefined;
}

export function appendVeoAdvancedMetadata(
  formData: FormData,
  modelId: string,
  supplied?: Record<string, unknown>,
  metadata?: ProviderVideoBindingMetadata | null
): void {
  const parameters = buildVeoAdvancedParameters(modelId, supplied, metadata);
  if (parameters) formData.append('metadata', JSON.stringify(parameters));
}

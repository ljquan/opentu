export type NativeParameterValue = string | number | boolean;
export interface NativeParameter {
  id: string;
  label: string;
  valueType: 'enum' | 'number' | 'string';
  options?: Array<{ value: string; label: string }>;
  defaultValue?: NativeParameterValue;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  disabledReason?: string;
  variants?: Array<{
    when: Record<string, string[]>;
    options?: Array<{ value: string; label: string }>;
    defaultValue?: NativeParameterValue;
    min?: number;
    max?: number;
    disabledReason?: string;
  }>;
}
export interface NativeReferenceInput {
  formats?: Array<'url' | 'data' | 'asset'>;
  minCount?: number;
  maxCount?: number;
  mode?: 'reference' | 'frames' | 'components';
  labels?: string[];
}
export interface NativeReferenceInputs {
  images?: NativeReferenceInput;
  videos?: NativeReferenceInput;
  audios?: NativeReferenceInput;
}

export function isNativeReferenceInputs(
  value: unknown
): value is NativeReferenceInputs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, input]) =>
      ['images', 'videos', 'audios'].includes(key) &&
      input &&
      typeof input === 'object' &&
      ['minCount', 'maxCount'].every(
        (field) =>
          input[field] === undefined ||
          (Number.isInteger(input[field]) && input[field] >= 0)
      ) &&
      (input.mode === undefined ||
        ['reference', 'frames', 'components'].includes(input.mode)) &&
      (input.formats === undefined ||
        (Array.isArray(input.formats) &&
          input.formats.every((format: unknown) =>
            ['url', 'data', 'asset'].includes(String(format))
          ))) &&
      (input.labels === undefined ||
        (Array.isArray(input.labels) &&
          input.labels.every((label: unknown) => typeof label === 'string')))
  );
}

export function isNativeParameter(value: unknown): value is NativeParameter {
  if (!value || typeof value !== 'object') return false;
  const item = value as NativeParameter;
  return (
    typeof item.id === 'string' &&
    typeof item.label === 'string' &&
    ['enum', 'number', 'string'].includes(item.valueType) &&
    (item.defaultValue === undefined ||
      typeof item.defaultValue === 'string' ||
      typeof item.defaultValue === 'boolean' ||
      (typeof item.defaultValue === 'number' &&
        Number.isFinite(item.defaultValue))) &&
    (item.options === undefined ||
      (Array.isArray(item.options) &&
        item.options.every(
          (option) =>
            option &&
            typeof option.value === 'string' &&
            typeof option.label === 'string'
        ))) &&
    ['min', 'max', 'step'].every(
      (key) =>
        item[key as 'min'] === undefined || Number.isFinite(item[key as 'min'])
    ) &&
    (item.integer === undefined || typeof item.integer === 'boolean') &&
    (item.disabledReason === undefined ||
      typeof item.disabledReason === 'string') &&
    (item.variants === undefined ||
      (Array.isArray(item.variants) &&
        item.variants.every(
          (variant) =>
            variant &&
            variant.when &&
            typeof variant.when === 'object' &&
            !Array.isArray(variant.when) &&
            Object.values(variant.when).every(
              (values) =>
                Array.isArray(values) &&
                values.every((value) => typeof value === 'string')
            ) &&
            isNativeParameter({ ...item, ...variant, variants: undefined })
        )))
  );
}

export function effectiveNativeParameters(
  parameters: NativeParameter[],
  values: Record<string, NativeParameterValue> = {}
): NativeParameter[] {
  const merged = {
    ...Object.fromEntries(
      parameters
        .filter((parameter) => parameter.defaultValue !== undefined)
        .map((parameter) => [parameter.id, parameter.defaultValue])
    ),
    ...values,
  };
  return parameters.map((parameter) => {
    const variant = parameter.variants?.find((variant) =>
      Object.entries(variant.when).every(([key, allowed]) =>
        allowed.includes(String(merged[key]))
      )
    );
    if (!variant) return parameter;
    const { when: _when, ...overrides } = variant;
    return { ...parameter, ...overrides };
  });
}

export function resolveNativeParameters(
  parameters: NativeParameter[],
  supplied: Record<string, NativeParameterValue> = {}
): Record<string, NativeParameterValue> {
  const result: Record<string, NativeParameterValue> = {};
  for (const key of Object.keys(supplied)) {
    if (!parameters.some((parameter) => parameter.id === key))
      throw new Error(`未知模型参数: ${key}`);
  }
  for (const parameter of effectiveNativeParameters(parameters, supplied)) {
    const value = supplied[parameter.id] ?? parameter.defaultValue;
    if (parameter.disabledReason) {
      if (supplied[parameter.id] !== undefined)
        throw new Error(`${parameter.label}: ${parameter.disabledReason}`);
      continue;
    }
    if (value === undefined) continue;
    const invalid =
      parameter.valueType === 'enum'
        ? !parameter.options?.some((option) => option.value === String(value))
        : parameter.valueType === 'string'
        ? typeof value !== 'string'
        : typeof value !== 'number' ||
          !Number.isFinite(value) ||
          (parameter.integer && !Number.isInteger(value)) ||
          (parameter.min !== undefined && value < parameter.min) ||
          (parameter.max !== undefined && value > parameter.max);
    if (invalid)
      throw new Error(`${parameter.label} 参数值无效: ${String(value)}`);
    result[parameter.id] = value;
  }
  return result;
}

export function validateNativeReferences(
  inputs: NativeReferenceInputs,
  references: { images?: string[]; videos?: string[]; audios?: string[] }
): void {
  for (const key of ['images', 'videos', 'audios'] as const) {
    const count = references[key]?.length || 0;
    const input = inputs[key];
    if (
      (!input && count) ||
      (input?.maxCount !== undefined && count > input.maxCount) ||
      (input?.minCount !== undefined && count < input.minCount)
    ) {
      throw new Error(`模型参考素材 ${key} 数量无效 (${count})`);
    }
    for (const reference of references[key] || []) {
      const format = /^https?:/i.test(reference)
        ? 'url'
        : /^(data:|blob:)/i.test(reference)
        ? 'data'
        : 'asset';
      if (input?.formats && !input.formats.includes(format))
        throw new Error(`模型参考素材 ${key} 不支持 ${format} 格式`);
    }
  }
}

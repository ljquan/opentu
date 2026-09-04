export const OFFICIAL_GPT_IMAGE_EDIT_REQUEST_SCHEMA =
  'openai.image.gpt-edit-form';

export const TUZI_GPT_IMAGE_EDIT_REQUEST_SCHEMA = 'tuzi.image.gpt-edit-json';

export const TUZI_GPT_IMAGE_MODEL_ID = 'gpt-image-2';

const TUZI_GPT_IMAGE_LEGACY_ALIASES = new Set(['image-2', 'image2']);

export function isTuziGPTImageLegacyAlias(modelId?: string | null): boolean {
  return TUZI_GPT_IMAGE_LEGACY_ALIASES.has(
    (modelId || '').trim().toLowerCase()
  );
}

export function normalizeTuziGPTImageModelId(
  modelId?: string | null
): string | undefined {
  const normalized = modelId?.trim();
  if (!normalized) {
    return undefined;
  }

  return isTuziGPTImageLegacyAlias(normalized)
    ? TUZI_GPT_IMAGE_MODEL_ID
    : normalized;
}

export async function shouldRetryTuziGPTImageAlias(
  response: Response,
  modelId?: string | null
): Promise<boolean> {
  if (!isTuziGPTImageLegacyAlias(modelId)) {
    return false;
  }

  const body = await response
    .clone()
    .text()
    .catch(() => '');
  if (!body) {
    return false;
  }

  try {
    const data = JSON.parse(body) as {
      error?: string | { code?: string; message?: string };
      code?: string;
      message?: string;
    };
    const code = typeof data.error === 'object' ? data.error?.code : data.code;
    const message =
      typeof data.error === 'string'
        ? data.error
        : data.error?.message || data.message || '';

    return (
      code === 'model_not_found' ||
      /模型.+无可用渠道|model.+not.+found/i.test(message)
    );
  } catch {
    return /model_not_found|模型.+无可用渠道|model.+not.+found/i.test(body);
  }
}

export const GPT_IMAGE_EDIT_REQUEST_SCHEMAS = [
  OFFICIAL_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
  TUZI_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
] as const;

export function isGPTImageEditRequestSchema(
  value?: string | readonly string[] | null
): boolean {
  const schemas = Array.isArray(value) ? value : value ? [value] : [];

  return schemas.some((schema) =>
    GPT_IMAGE_EDIT_REQUEST_SCHEMAS.includes(
      schema as (typeof GPT_IMAGE_EDIT_REQUEST_SCHEMAS)[number]
    )
  );
}

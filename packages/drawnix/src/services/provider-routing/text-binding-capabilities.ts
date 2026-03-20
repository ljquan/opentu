import type {
  ProviderModelBinding,
  ProviderTextBindingMetadata,
} from './types';

const DEFAULT_TEXT_IMAGE_INPUT_LIMIT = 6;

export function getTextBindingMetadata(
  binding?: ProviderModelBinding | null
): ProviderTextBindingMetadata | null {
  return binding?.metadata?.text || null;
}

export function supportsTextBindingImageInput(
  binding?: ProviderModelBinding | null
): boolean {
  return getTextBindingMetadata(binding)?.supportsImageInput === true;
}

export function getTextBindingMaxImageCount(
  binding?: ProviderModelBinding | null
): number {
  const maxImageCount = getTextBindingMetadata(binding)?.maxImageCount;

  if (!maxImageCount || maxImageCount <= 0) {
    return DEFAULT_TEXT_IMAGE_INPUT_LIMIT;
  }

  return maxImageCount;
}

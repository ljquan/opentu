import { runtimeModelDiscovery } from '../utils/runtime-model-discovery';
import { setPersistedModelSelection } from '../utils/ai-model-selection-storage';
import { tuziEmbeddedConfig } from './tuzi-embedded-config';
import type { TuziManagedProvider } from './tuzi-session-api';

function tuziV1BaseUrl(): string {
  return `${tuziEmbeddedConfig.apiBaseUrl?.replace(/\/+$/, '') || ''}/v1`;
}

export async function discoverAndUseAllTuziProviderModels(
  provider: TuziManagedProvider
): Promise<number> {
  try {
    await runtimeModelDiscovery.discover(
      provider.id,
      tuziV1BaseUrl(),
      provider.apiKey,
      [],
      { selectAll: true }
    );
    const allModels = runtimeModelDiscovery.getState(
      provider.id
    ).discoveredModels;
    return allModels.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : '模型同步失败';
    runtimeModelDiscovery.setError(provider.id, message);
    throw error;
  }
}

export function selectTuziProviderImageModel(
  provider: TuziManagedProvider
): boolean {
  const state = runtimeModelDiscovery.getState(provider.id);
  const imageModel = [...state.models, ...state.discoveredModels].find(
    (model, index, models) =>
      model.type === 'image' &&
      models.findIndex((candidate) => candidate.id === model.id) === index
  );
  if (!imageModel) return false;

  setPersistedModelSelection('image', {
    modelId: imageModel.id,
    modelRef: {
      profileId: provider.id,
      modelId: imageModel.id,
    },
    providerIdHint: provider.id,
    vendorHint: imageModel.vendor,
  });
  return true;
}

export async function discoverChangedTuziProviderModels(
  providers: TuziManagedProvider[],
  previousApiKeys: ReadonlyMap<string, string>,
  options?: { selectImageModelForProviderId?: string }
): Promise<void> {
  const changedProviders = providers.filter(
    (provider) =>
      previousApiKeys.get(provider.id) !== provider.apiKey ||
      runtimeModelDiscovery.getState(provider.id).discoveredModels.length === 0
  );
  const results = await Promise.allSettled(
    changedProviders.map(discoverAndUseAllTuziProviderModels)
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `[Tuzi] Failed to synchronize models for ${changedProviders[index].group}:`,
        result.reason
      );
    }
  });
  const selectedProvider = providers.find(
    (provider) => provider.id === options?.selectImageModelForProviderId
  );
  if (selectedProvider) {
    selectTuziProviderImageModel(selectedProvider);
  }
}

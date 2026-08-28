import { runtimeModelDiscovery } from '../utils/runtime-model-discovery';
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
      provider.apiKey
    );
    const allModels = runtimeModelDiscovery.getState(provider.id).discoveredModels;
    runtimeModelDiscovery.applySelection(
      provider.id,
      allModels.map((model) => model.id)
    );
    return allModels.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : '模型同步失败';
    runtimeModelDiscovery.setError(provider.id, message);
    throw error;
  }
}

export async function discoverChangedTuziProviderModels(
  providers: TuziManagedProvider[],
  previousApiKeys: ReadonlyMap<string, string>
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
}

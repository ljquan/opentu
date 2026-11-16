import type { ModelConfig } from '../constants/model-config';
import {
  findExactSelectableModel,
  findMatchingSelectableModel,
} from './model-selection';
import {
  getPinnedSelectableModel,
  runtimeModelDiscovery,
} from './runtime-model-discovery';
import { providerProfilesSettings, type ModelRef } from './settings-manager';

/** Restore a saved provider exactly, including models hidden from the quick list. */
export async function resolveSavedGenerationModel(
  type: 'image' | 'video',
  models: ModelConfig[],
  modelId?: string | null,
  modelRef?: ModelRef | null
): Promise<ModelConfig | undefined> {
  const profileId = modelRef?.profileId;
  if (!profileId) return findMatchingSelectableModel(models, modelId, modelRef);
  const profile = providerProfilesSettings
    .get()
    .find((item) => item.id === profileId);
  if (
    !profile ||
    profile.enabled === false ||
    !profile.baseUrl?.trim() ||
    !profile.apiKey?.trim()
  )
    return;
  const exact = findExactSelectableModel(models, modelId, modelRef);
  if (exact) return exact;
  // The picker already supports pinned historical models. Its filtered quick
  // list is not an availability check; do not silently select another provider.
  // Provider catalogs load lazily after refresh. Fetch only the saved provider
  // before treating an empty catalog as a removed model.
  if (runtimeModelDiscovery.getState(profileId).discoveredModels.length === 0) {
    try {
      await (runtimeModelDiscovery.getInFlightDiscovery(profileId) ||
        runtimeModelDiscovery.discover(
          profileId,
          profile.baseUrl,
          profile.apiKey
        ));
    } catch {
      return;
    }
  }
  const pinned = getPinnedSelectableModel(type, modelId, modelRef);
  return pinned
    ? findExactSelectableModel([pinned], modelId, modelRef)
    : undefined;
}

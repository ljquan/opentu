import {
  TUZI_PROVIDER_DEFAULT_BASE_URL,
  type ProviderProfile,
} from '../../utils/settings-manager';
import {
  normalizeModelApiBaseUrl,
  runtimeModelDiscovery,
} from '../../utils/runtime-model-discovery';

export function getCredentialChangedProfiles(
  profiles: ProviderProfile[],
  previousProfiles: ProviderProfile[]
): ProviderProfile[] {
  return profiles.filter((profile) => {
    const previous = previousProfiles.find((item) => item.id === profile.id);
    return (
      !previous ||
      profile.apiKey.trim() !== previous.apiKey.trim() ||
      normalizeModelApiBaseUrl(
        profile.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL
      ) !==
        normalizeModelApiBaseUrl(
          previous.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL
        )
    );
  });
}

export async function refreshChangedProviderModels(
  profiles: ProviderProfile[]
): Promise<string[]> {
  const failures = await Promise.all(
    profiles.map(async (profile) => {
      if (
        !profile.apiKey.trim() ||
        profile.capabilities.supportsModelsEndpoint === false
      ) {
        return null;
      }
      try {
        const models = await runtimeModelDiscovery.discover(
          profile.id,
          profile.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL,
          profile.apiKey.trim()
        );
        runtimeModelDiscovery.applySelection(
          profile.id,
          models.map((model) => model.id)
        );
        return null;
      } catch {
        // Do not expose gateway responses that might contain credentials.
        runtimeModelDiscovery.setError(
          profile.id,
          '模型刷新失败，请重新获取模型'
        );
        return profile.name;
      }
    })
  );
  return failures.filter((name): name is string => name !== null);
}

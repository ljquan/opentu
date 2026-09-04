import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  TUZI_BUSINESS_PROVIDER_PROFILE_ID,
  TUZI_CODEX_PROVIDER_PROFILE_ID,
  TUZI_MIX_PROVIDER_PROFILE_ID,
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
  type ProviderProfile,
} from '../../utils/settings-manager';

const BUILT_IN_TUZI_PROVIDER_IDS = new Set([
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
  TUZI_MIX_PROVIDER_PROFILE_ID,
  TUZI_CODEX_PROVIDER_PROFILE_ID,
  TUZI_BUSINESS_PROVIDER_PROFILE_ID,
]);

export function isManagedProviderProfile(profileId: string): boolean {
  return (
    profileId.startsWith('tuzi-managed-') ||
    BUILT_IN_TUZI_PROVIDER_IDS.has(profileId)
  );
}

export function shouldShowProviderProfile(
  profileId: string,
  showTuziProviders: boolean
): boolean {
  return showTuziProviders || !profileId.startsWith('tuzi-managed-');
}

export function canDisableProvider(
  profiles: ProviderProfile[],
  profileId: string
): boolean {
  const targetProfile = profiles.find((profile) => profile.id === profileId);
  if (!targetProfile?.enabled) {
    return true;
  }

  const enabledCount = profiles.filter((profile) => profile.enabled).length;
  return enabledCount > 1;
}

import type { ProviderProfile } from '../../utils/settings-manager';

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

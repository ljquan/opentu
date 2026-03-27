import { useEffect, useState } from 'react';
import {
  providerProfilesSettings,
  type ProviderProfile,
} from '../utils/settings-manager';

export function useProviderProfiles(): ProviderProfile[] {
  const [profiles, setProfiles] = useState<ProviderProfile[]>(() =>
    providerProfilesSettings.get()
  );

  useEffect(() => {
    const handleChange = (nextProfiles: ProviderProfile[]) => {
      setProfiles(nextProfiles);
    };

    setProfiles(providerProfilesSettings.get());
    providerProfilesSettings.addListener(handleChange);

    return () => {
      providerProfilesSettings.removeListener(handleChange);
    };
  }, []);

  return profiles;
}

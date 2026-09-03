import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  TUZI_BUSINESS_PROVIDER_PROFILE_ID,
  TUZI_CODEX_PROVIDER_PROFILE_ID,
  TUZI_MIX_PROVIDER_PROFILE_ID,
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
  TUZI_PROVIDER_ICON_URL,
  providerCatalogsSettings,
  providerProfilesSettings,
} from '../utils/settings-manager';
import type { ProviderProfile } from '../utils/settings-types';
import { tuziEmbeddedConfig } from './tuzi-embedded-config';
import type { TuziManagedProvider } from './tuzi-session-api';

const MANAGED_PROVIDER_PREFIX = 'tuzi-managed-';
const BUILT_IN_TUZI_PROVIDER_IDS = new Set([
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
  TUZI_MIX_PROVIDER_PROFILE_ID,
  TUZI_CODEX_PROVIDER_PROFILE_ID,
  TUZI_BUSINESS_PROVIDER_PROFILE_ID,
]);
const DEFAULT_CAPABILITIES: ProviderProfile['capabilities'] = {
  supportsModelsEndpoint: true,
  supportsText: true,
  supportsImage: true,
  supportsVideo: true,
  supportsAudio: true,
  supportsTools: true,
};

function tuziV1BaseUrl(): string {
  return `${tuziEmbeddedConfig.apiBaseUrl?.replace(/\/+$/, '') || ''}/v1`;
}

function pricingUrl(): string {
  return `${
    tuziEmbeddedConfig.apiBaseUrl?.replace(/\/+$/, '') || ''
  }/api/pricing`;
}

function managedProviderName(provider: TuziManagedProvider): string {
  const group = provider.group.trim();
  const displayName = provider.displayName.trim();
  if (displayName && displayName !== group) {
    return displayName;
  }
  return group ? `${group} 分组` : 'Tuzi 分组';
}

function defaultTemplate(profiles: ProviderProfile[]): ProviderProfile | null {
  return (
    profiles.find(
      (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
    ) || null
  );
}

function toProfile(
  provider: TuziManagedProvider,
  template: ProviderProfile | null
): ProviderProfile {
  return {
    ...(template || {}),
    id: provider.id,
    name: managedProviderName(provider),
    iconUrl: template?.iconUrl || TUZI_PROVIDER_ICON_URL,
    homepageUrl: template?.homepageUrl,
    providerType: template?.providerType || 'openai-compatible',
    baseUrl: tuziV1BaseUrl(),
    apiKey: provider.apiKey,
    authType: template?.authType || 'bearer',
    imageApiCompatibility: template?.imageApiCompatibility || 'tuzi-gpt-image',
    preferAsyncImageEndpoint: template?.preferAsyncImageEndpoint === true,
    enabled: provider.status === 1,
    capabilities: template?.capabilities || DEFAULT_CAPABILITIES,
    pricingUrl: pricingUrl(),
    pricingGroup: provider.group,
    cnyPerUsd: template?.cnyPerUsd,
  };
}

export async function synchronizeTuziManagedProviders(
  providers: TuziManagedProvider[]
): Promise<void> {
  const existing = providerProfilesSettings.get();
  const template = defaultTemplate(existing);
  const incoming = new Map(
    providers.map((provider) => [provider.id, provider])
  );
  const retained = existing.filter(
    (profile) =>
      !profile.id.startsWith(MANAGED_PROVIDER_PREFIX) ||
      incoming.has(profile.id)
  );
  const merged = retained.map((profile) => {
    const provider = incoming.get(profile.id);
    if (provider) return { ...profile, ...toProfile(provider, template) };
    if (BUILT_IN_TUZI_PROVIDER_IDS.has(profile.id)) {
      return { ...profile, enabled: false };
    }
    return profile;
  });
  const knownIds = new Set(merged.map((profile) => profile.id));
  providers.forEach((provider) => {
    if (!knownIds.has(provider.id)) merged.push(toProfile(provider, template));
  });
  await providerProfilesSettings.update(merged);
  const validProfileIds = new Set(merged.map((profile) => profile.id));
  const existingCatalogs = providerCatalogsSettings.get();
  const retainedCatalogs = existingCatalogs.filter((catalog) =>
    validProfileIds.has(catalog.profileId)
  );
  if (retainedCatalogs.length !== existingCatalogs.length) {
    await providerCatalogsSettings.update(retainedCatalogs);
  }
}

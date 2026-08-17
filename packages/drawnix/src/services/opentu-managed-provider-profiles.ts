import {
  DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
  TUZI_CODEX_PROVIDER_PROFILE_ID,
  TUZI_MIX_PROVIDER_PROFILE_ID,
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
  TUZI_PROVIDER_ICON_URL,
  setManagedProviderProfiles,
  type ProviderProfile,
} from '../utils/settings-manager';
import { configIndexedDBWriter } from '../utils/config-indexeddb-writer';
import { getActiveStorageNamespace } from './storage-context';

export interface ManagedProviderGroupInput {
  group: string;
  display_name: string;
  api_key: string;
  base_url: string;
  status?: string;
  token_id?: number | string;
}

interface ManagedProviderProfilesSnapshot {
  credentialId: string;
  profiles: ProviderProfile[];
}

const FIXED_PROFILE_IDS: Readonly<Record<string, string>> = {
  default: TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
  'gemini-mix': TUZI_MIX_PROVIDER_PROFILE_ID,
  codex: TUZI_CODEX_PROVIDER_PROFILE_ID,
};

const DEFAULT_CAPABILITIES = {
  supportsModelsEndpoint: true,
  supportsText: true,
  supportsImage: true,
  supportsVideo: true,
  supportsAudio: true,
  supportsTools: true,
};

let mutationQueue: Promise<void> = Promise.resolve();

function assertActiveCredential(credentialId: string): string {
  const normalized = credentialId.trim();
  const namespace = getActiveStorageNamespace();
  if (
    !normalized ||
    namespace.kind !== 'credential' ||
    namespace.credentialId !== normalized
  ) {
    throw new Error(
      'Managed provider response does not match active credential'
    );
  }
  return normalized;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getManagedProviderProfileId(group: string): string {
  const normalized = group.trim().toLowerCase();
  const fixed = FIXED_PROFILE_IDS[normalized];
  if (fixed) return fixed;

  const slug =
    normalized
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'group';
  return `tuzi-managed-${slug}-${stableHash(normalized)}`;
}

function isEnabledStatus(status?: string): boolean {
  if (!status) return true;
  return !['disabled', 'inactive', 'revoked', 'deleted'].includes(
    status.trim().toLowerCase()
  );
}

function toManagedProfile(
  input: ManagedProviderGroupInput,
  credentialId: string
): ProviderProfile {
  const group = input.group.trim();
  const displayName = input.display_name.trim() || group;
  const apiKey = input.api_key.trim();
  const baseUrl = input.base_url.trim();
  if (!group || !apiKey || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error('Managed provider group payload is invalid');
  }

  return {
    id: getManagedProviderProfileId(group),
    name: displayName,
    iconUrl: TUZI_PROVIDER_ICON_URL,
    homepageUrl: 'https://api.tu-zi.com/',
    providerType: 'openai-compatible',
    baseUrl,
    apiKey,
    authType: 'bearer',
    imageApiCompatibility: DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
    preferAsyncImageEndpoint: false,
    enabled: isEnabledStatus(input.status),
    capabilities: { ...DEFAULT_CAPABILITIES },
    pricingGroup: group,
    managedBy: 'tuzi',
    managedGroup: group,
    managedCredentialId: credentialId,
    managedTokenId: input.token_id,
  };
}

async function readSnapshot(
  credentialId: string
): Promise<ManagedProviderProfilesSnapshot> {
  assertActiveCredential(credentialId);
  const snapshot =
    await configIndexedDBWriter.getManagedProviderProfiles<ManagedProviderProfilesSnapshot>();
  assertActiveCredential(credentialId);
  if (!snapshot || snapshot.credentialId !== credentialId) {
    return { credentialId, profiles: [] };
  }
  return {
    credentialId,
    profiles: Array.isArray(snapshot.profiles)
      ? snapshot.profiles.filter(
          (profile) =>
            profile?.managedBy === 'tuzi' &&
            profile.managedCredentialId === credentialId
        )
      : [],
  };
}

async function persistSnapshot(
  snapshot: ManagedProviderProfilesSnapshot
): Promise<void> {
  assertActiveCredential(snapshot.credentialId);
  await configIndexedDBWriter.saveManagedProviderProfiles(snapshot);
  assertActiveCredential(snapshot.credentialId);
  setManagedProviderProfiles(snapshot.profiles);
}

function enqueue(
  credentialId: string,
  mutation: () => Promise<void>
): Promise<void> {
  assertActiveCredential(credentialId);
  const result = mutationQueue.then(async () => {
    assertActiveCredential(credentialId);
    await mutation();
  });
  mutationQueue = result.catch(() => undefined);
  return result;
}

export async function reconcileManagedProviderGroups(
  groups: ManagedProviderGroupInput[],
  credentialId: string
): Promise<void> {
  return enqueue(credentialId, async () => {
    const normalizedCredentialId = assertActiveCredential(credentialId);
    const current = await readSnapshot(normalizedCredentialId);
    const incoming = Array.from(
      new Map(
        groups.map((group) => {
          const profile = toManagedProfile(group, normalizedCredentialId);
          return [profile.id, profile] as const;
        })
      ).values()
    );
    const incomingIds = new Set(incoming.map((profile) => profile.id));
    const unavailable = current.profiles
      .filter((profile) => !incomingIds.has(profile.id))
      .map((profile) => ({ ...profile, enabled: false }));
    await persistSnapshot({
      credentialId: normalizedCredentialId,
      profiles: [...incoming, ...unavailable],
    });
  });
}

export async function updateManagedProviderGroup(
  group: ManagedProviderGroupInput,
  credentialId: string
): Promise<void> {
  return enqueue(credentialId, async () => {
    const normalizedCredentialId = assertActiveCredential(credentialId);
    const current = await readSnapshot(normalizedCredentialId);
    const replacement = toManagedProfile(group, normalizedCredentialId);
    await persistSnapshot({
      credentialId: normalizedCredentialId,
      profiles: [
        ...current.profiles.filter((profile) => profile.id !== replacement.id),
        replacement,
      ],
    });
  });
}

import type { ProviderProfile } from '../utils/settings-types';
import type { TuziManagedProvider } from './tuzi-session-api';
import { tuziEmbeddedConfig } from './tuzi-embedded-config';
import { getTuziSystemToken, getTuziSystemUserId } from './tuzi-token-auth';

export interface TuziProviderVerification {
  id: string;
  token_id?: number;
  token_name?: string;
  groups: string[];
  usable: boolean;
  reason?: string;
  model_limits_enabled: boolean;
  models?: string[];
  ip_restricted: boolean;
  expires_at?: number;
  quota_limited: boolean;
  count_limited: boolean;
}
interface VerifiedEntry {
  profile: ProviderProfile;
  result: TuziProviderVerification;
}
let verified = new Map<string, VerifiedEntry>();
let account = '';
let credential = '';
export const TUZI_PROVIDER_REUSE_EVENT = 'opentu:tuzi-provider-reuse';
const HISTORY_KEY = 'opentu.tuzi.reused-groups.v1';
const MANAGED_KEY = 'opentu.tuzi.managed-groups.v1';
const ACTIVE_KEY = 'opentu.tuzi.active-provider.v1';
function scope(): string {
  return `${tuziEmbeddedConfig.apiBaseUrl || ''}:${getTuziSystemUserId()}`;
}
export function isCurrentTuziEndpoint(baseUrl: string): boolean {
  try {
    return (
      new URL(baseUrl).origin ===
      new URL(tuziEmbeddedConfig.apiBaseUrl || '').origin
    );
  } catch {
    return false;
  }
}
function current(): boolean {
  return (
    Boolean(credential) &&
    account === scope() &&
    credential === getTuziSystemToken()
  );
}
export function resetTuziProviderVerification(): void {
  const hadEntries = verified.size > 0;
  verified.clear();
  account = '';
  credential = '';
  if (hadEntries && typeof window !== 'undefined')
    window.dispatchEvent(new Event(TUZI_PROVIDER_REUSE_EVENT));
}
export function setTuziProviderVerification(
  profiles: ProviderProfile[],
  results: TuziProviderVerification[]
): void {
  verified = new Map(
    profiles.flatMap((profile) => {
      const result = results.find((item) => item.id === profile.id);
      return result ? [[profile.id, { profile: { ...profile }, result }]] : [];
    })
  );
  account = scope();
  credential = getTuziSystemToken();
  const groups = results.flatMap((item) => (item.token_id ? item.groups : []));
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
    history[account] = [...new Set([...(history[account] || []), ...groups])];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* Optional browser storage. */
  }
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(TUZI_PROVIDER_REUSE_EVENT));
}
export function getPreviouslyReusedGroups(): string[] {
  try {
    const managed =
      JSON.parse(localStorage.getItem(MANAGED_KEY) || '{}')[scope()] || [];
    return (
      JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}')[scope()] || []
    ).filter((group: string) => !managed.includes(group));
  } catch {
    return [];
  }
}
export function getTuziProviderVerification(
  profile: ProviderProfile
): TuziProviderVerification | null {
  const entry = current() ? verified.get(profile.id) : undefined;
  return entry &&
    entry.profile.apiKey === profile.apiKey &&
    entry.profile.baseUrl === profile.baseUrl
    ? entry.result
    : null;
}
export function isVerifiedTuziProvider(profile: ProviderProfile): boolean {
  return (
    profile.enabled !== false &&
    getTuziProviderVerification(profile)?.usable === true
  );
}
export function getReusedTuziProviders(
  profiles: ProviderProfile[]
): TuziManagedProvider[] {
  return profiles.flatMap((profile) => {
    const result = getTuziProviderVerification(profile);
    if (!result?.usable || profile.enabled === false) return [];
    return [
      {
        id: profile.id,
        group: result.groups[0],
        groups: result.groups,
        displayName: profile.name,
        apiKey: profile.apiKey,
        status: 1,
        rotatedAt: 0,
        source: 'existing' as const,
        tokenName: result.token_name,
        restrictions: [
          result.model_limits_enabled && '模型限制',
          result.ip_restricted && 'IP 限制',
          result.quota_limited && '额度限制',
          result.count_limited && '次数限制',
          result.expires_at !== -1 && '有效期限制',
        ].filter(Boolean) as string[],
      },
    ];
  });
}
export function getTuziProviderIssues(
  profiles: ProviderProfile[]
): { id: string; name: string; reason: string }[] {
  const reasons: Record<string, string> = {
    not_owned_or_missing: '不属于当前账户或令牌已删除',
    disabled: '令牌已停用',
    expired: '令牌已过期',
    quota_exhausted: '令牌额度已耗尽',
    count_exhausted: '令牌次数已耗尽',
    group_unavailable: '分组权限不可用',
    models_unavailable: '令牌没有可用模型权限',
  };
  return profiles.flatMap((profile) => {
    const result = getTuziProviderVerification(profile);
    return result && !result.usable
      ? [
          {
            id: profile.id,
            name: profile.name,
            reason: reasons[result.reason || ''] || '令牌不可用',
          },
        ]
      : [];
  });
}
export function getTuziActiveProviderId(): string | null {
  try {
    return (
      JSON.parse(localStorage.getItem(ACTIVE_KEY) || '{}')[scope()] || null
    );
  } catch {
    return null;
  }
}
export function saveTuziActiveProviderId(id: string): void {
  try {
    const data = JSON.parse(localStorage.getItem(ACTIVE_KEY) || '{}');
    data[scope()] = id;
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(data));
  } catch {
    /* Optional browser storage. */
  }
}

export function recordTuziManagedGroups(groups: string[]): void {
  if (!groups.length) return;
  try {
    const history = JSON.parse(localStorage.getItem(MANAGED_KEY) || '{}');
    history[scope()] = [...new Set([...(history[scope()] || []), ...groups])];
    localStorage.setItem(MANAGED_KEY, JSON.stringify(history));
  } catch {
    /* Optional browser storage. */
  }
}

const TUZI_PROVIDER_SELECTION_KEY = 'opentu.tuzi.provider-groups.v1';
const TUZI_ACTIVE_PROVIDER_GROUP_KEY = 'opentu.tuzi.active-provider-group.v1';

export const TUZI_ACTIVE_PROVIDER_GROUP_EVENT =
  'opentu:tuzi-active-provider-group';

type SelectionStore = Record<string, string[]>;
type ActiveGroupStore = Record<string, string>;

function normalizeGroup(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUserId(value: number | string): string {
  return String(value).trim();
}

function readStore(): SelectionStore {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(
      window.localStorage.getItem(TUZI_PROVIDER_SELECTION_KEY) || '{}'
    );
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as SelectionStore)
      : {};
  } catch {
    return {};
  }
}

function readActiveGroupStore(): ActiveGroupStore {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(
      window.localStorage.getItem(TUZI_ACTIVE_PROVIDER_GROUP_KEY) || '{}'
    );
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as ActiveGroupStore)
      : {};
  } catch {
    return {};
  }
}

export function getTuziProviderGroupSelection(
  userId: number | string
): string[] | null {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;
  const value = readStore()[normalizedUserId];
  return Array.isArray(value)
    ? [...new Set(value.map(normalizeGroup).filter(Boolean))]
    : null;
}

export function saveTuziProviderGroupSelection(
  userId: number | string,
  groups: readonly string[]
): void {
  if (typeof window === 'undefined') return;
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return;
  try {
    const store = readStore();
    store[normalizedUserId] = [...new Set(groups.map(normalizeGroup))].filter(
      Boolean
    );
    window.localStorage.setItem(
      TUZI_PROVIDER_SELECTION_KEY,
      JSON.stringify(store)
    );
  } catch {
    // localStorage is optional in embedded environments.
  }
}

export function clearTuziProviderGroupSelection(userId: number | string): void {
  if (typeof window === 'undefined') return;
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return;
  try {
    const store = readStore();
    delete store[normalizedUserId];
    window.localStorage.setItem(
      TUZI_PROVIDER_SELECTION_KEY,
      JSON.stringify(store)
    );
    clearTuziActiveProviderGroup(userId);
  } catch {
    // localStorage is optional in embedded environments.
  }
}

export function getTuziActiveProviderGroup(
  userId: number | string
): string | null {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;
  return normalizeGroup(readActiveGroupStore()[normalizedUserId]) || null;
}

export function saveTuziActiveProviderGroup(
  userId: number | string,
  group: string
): void {
  if (typeof window === 'undefined') return;
  const normalizedUserId = normalizeUserId(userId);
  const normalized = normalizeGroup(group);
  if (!normalizedUserId || !normalized) return;
  try {
    const store = readActiveGroupStore();
    if (store[normalizedUserId] === normalized) return;
    store[normalizedUserId] = normalized;
    window.localStorage.setItem(
      TUZI_ACTIVE_PROVIDER_GROUP_KEY,
      JSON.stringify(store)
    );
    window.dispatchEvent(
      new CustomEvent(TUZI_ACTIVE_PROVIDER_GROUP_EVENT, {
        detail: { userId: normalizedUserId, group: normalized },
      })
    );
  } catch {
    // localStorage is optional in embedded environments.
  }
}

export function clearTuziActiveProviderGroup(userId: number | string): void {
  if (typeof window === 'undefined') return;
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return;
  try {
    const store = readActiveGroupStore();
    if (!(normalizedUserId in store)) return;
    delete store[normalizedUserId];
    window.localStorage.setItem(
      TUZI_ACTIVE_PROVIDER_GROUP_KEY,
      JSON.stringify(store)
    );
    window.dispatchEvent(
      new CustomEvent(TUZI_ACTIVE_PROVIDER_GROUP_EVENT, {
        detail: { userId: normalizedUserId, group: '' },
      })
    );
  } catch {
    // localStorage is optional in embedded environments.
  }
}

export function resolveTuziActiveProviderGroup(
  userId: number | string,
  groups: readonly string[]
): string | null {
  const normalizedGroups = [...new Set(groups.map(normalizeGroup))].filter(
    Boolean
  );
  const saved = getTuziActiveProviderGroup(userId);
  if (saved && normalizedGroups.includes(saved)) return saved;
  return normalizedGroups.includes('default')
    ? 'default'
    : normalizedGroups[0] || null;
}

export const FEATURE_DISCOVERY_STORAGE_PREFIX = 'aitu:feature-discovery:';
export const FEATURE_DISCOVERY_CHANGE_EVENT = 'aitu:feature-discovery-change';

// Change only the affected entries when shipping another discoverable feature.
export const FEATURE_DISCOVERY_REVISIONS = {
  'app-menu': 'canvas-image-toolbar-20261026',
  'canvas-settings': 'canvas-image-toolbar-20261026',
} as const;

export type FeatureDiscoveryEntry = keyof typeof FEATURE_DISCOVERY_REVISIONS;
const seenInSession = new Map<FeatureDiscoveryEntry, string>();

export function hasUnseenFeature(entry: FeatureDiscoveryEntry): boolean {
  const revision = FEATURE_DISCOVERY_REVISIONS[entry];
  if (!revision || seenInSession.get(entry) === revision) return false;
  try {
    return (
      localStorage.getItem(FEATURE_DISCOVERY_STORAGE_PREFIX + entry) !==
      revision
    );
  } catch {
    return true;
  }
}

export function acknowledgeFeature(entry: FeatureDiscoveryEntry): void {
  if (!hasUnseenFeature(entry)) return;
  const revision = FEATURE_DISCOVERY_REVISIONS[entry];
  try {
    localStorage.setItem(FEATURE_DISCOVERY_STORAGE_PREFIX + entry, revision);
  } catch (error) {
    seenInSession.set(entry, revision);
    // Keep dismissal in this page when browser storage is unavailable.
    console.debug(
      '[FeatureDiscovery] Could not persist viewed feature:',
      error
    );
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FEATURE_DISCOVERY_CHANGE_EVENT));
  }
}

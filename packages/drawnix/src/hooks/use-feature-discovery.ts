import { useCallback, useEffect, useState } from 'react';
import {
  acknowledgeFeature,
  FEATURE_DISCOVERY_CHANGE_EVENT,
  hasUnseenFeature,
  type FeatureDiscoveryEntry,
} from '../utils/feature-discovery';

export function useFeatureDiscovery(entry: FeatureDiscoveryEntry) {
  const [hasNewFeature, setHasNewFeature] = useState(() =>
    hasUnseenFeature(entry)
  );
  useEffect(() => {
    const sync = () => setHasNewFeature(hasUnseenFeature(entry));
    sync();
    window.addEventListener(FEATURE_DISCOVERY_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(FEATURE_DISCOVERY_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [entry]);
  const markSeen = useCallback(() => acknowledgeFeature(entry), [entry]);
  return { hasNewFeature, markSeen };
}

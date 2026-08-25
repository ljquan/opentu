/**
 * Tracking Plugin Exports
 * Feature: 005-declarative-tracking
 */

// Plugin
export { withTracking } from './withTracking';
export type { TrackingPluginContext } from './withTracking';

// Hooks
export { useTracking } from './hooks/useTracking';

// Services (for advanced usage)
export {
  TrackingService,
  getTrackingService,
  resetTrackingService,
} from '../../services/tracking/tracking-service';
export { TrackingBatchService } from '../../services/tracking/tracking-batch-service';
export { TrackingStorageService } from '../../services/tracking/tracking-storage-service';
export { umamiAdapter } from '../../services/tracking/umami-adapter';

// Configuration
export {
  DEFAULT_TRACK_CONFIG,
  getVersion,
  mergeConfig,
} from '../../services/tracking/tracking-config';

// Types
export type {
  TrackEvent,
  TrackEventType,
  TrackEventMetadata,
  TrackConfig,
  TrackingState,
  TrackingStats,
  TrackedElement,
  CachedEvent,
  RetryPolicy,
  CacheConfig,
  BatchConfig,
} from '../../types/tracking.types';

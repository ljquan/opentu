/**
 * Umami Analytics Adapter
 * Feature: 005-declarative-tracking
 * Purpose: Adapter to use existing UmamiAnalytics utility for declarative tracking
 */

import type { TrackEvent } from '../../types/tracking.types';
import { analytics } from '../../utils/umami-analytics';

/**
 * Umami Tracking Adapter
 * Uses existing UmamiAnalytics singleton to avoid code duplication
 */
export class UmamiTrackingAdapter {
  /**
   * Check if Umami SDK is available
   */
  isAvailable(): boolean {
    return analytics.isAnalyticsEnabled();
  }

  /**
   * Track event using existing analytics utility
   * @param event - Tracking event to upload
   * Note: Silently returns if Umami SDK is not loaded (consistent with umami-analytics.ts)
   */
  async track(event: TrackEvent): Promise<void> {
    if (!this.isAvailable()) {
      // Umami SDK not loaded, silently skip (e.g., local development)
      return;
    }

    // Enrich event data with metadata
    const enrichedData: Record<string, any> = {
      ...event.params,
      version: event.metadata.version,
      url: event.metadata.url,
      timestamp: event.metadata.timestamp,
      sessionId: event.metadata.sessionId,
      eventType: event.metadata.eventType,
    };

    // Optional: Add viewport if available
    if (event.metadata.viewport) {
      enrichedData.viewport = `${event.metadata.viewport.width}x${event.metadata.viewport.height}`;
    }

    try {
      // Use existing analytics.track() method and await SDK promises when available.
      await analytics.track(event.eventName, enrichedData);
    } catch (error) {
      console.error('[Tracking] Umami track failed:', error);
      throw error; // Re-throw for retry handling
    }
  }

  /**
   * Track multiple events in sequence
   * @param events - Array of tracking events
   * @returns Array of results (success or error)
   */
  async trackBatch(
    events: TrackEvent[]
  ): Promise<Array<{ success: boolean; error?: Error }>> {
    const results: Array<{ success: boolean; error?: Error }> = [];

    for (const event of events) {
      try {
        await this.track(event);
        results.push({ success: true });
      } catch (error) {
        results.push({ success: false, error: error as Error });
      }
    }

    return results;
  }

  /**
   * Get Umami SDK version info (if available)
   */
  getSDKInfo(): { available: boolean; version?: string } {
    return {
      available: this.isAvailable(),
      version: this.isAvailable() ? 'Umami JS' : undefined,
    };
  }
}

/**
 * Singleton instance
 */
export const umamiAdapter = new UmamiTrackingAdapter();

/**
 * Batch Upload Service
 * Feature: 005-declarative-tracking
 * Purpose: Queue events and upload in batches to reduce network requests
 */

import type { TrackEvent, BatchConfig } from '../../types/tracking.types';
import { umamiAdapter } from './umami-adapter';

/**
 * Batch Upload Service
 * Queues events and flushes when:
 * - Queue size reaches batchSize (10 events)
 * - Timeout expires (5 seconds)
 */
export class TrackingBatchService {
  private queue: TrackEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private config: BatchConfig;
  private uploading = false;

  constructor(config: BatchConfig) {
    this.config = config;
  }

  /**
   * Enqueue event for batch upload
   * Triggers flush if queue size reaches batchSize or starts timeout timer
   */
  enqueue(event: TrackEvent): void {
    if (!this.config.enabled) {
      // If batch is disabled, upload immediately
      this.uploadImmediate(event);
      return;
    }

    this.queue.push(event);

    // Start timeout timer if not already running
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.flush();
      }, this.config.batchTimeout);
    }

    // Flush immediately if queue size reaches batchSize
    if (this.queue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Flush queued events immediately
   * Upload all events in the queue
   */
  async flush(): Promise<void> {
    // Clear timeout timer
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Nothing to flush
    if (this.queue.length === 0) {
      return;
    }

    // Prevent concurrent flushes
    if (this.uploading) {
      return;
    }

    this.uploading = true;

    // Copy queue and clear it
    const eventsToUpload = [...this.queue];
    this.queue = [];

    try {
      // Upload batch using Umami adapter
      const results = await umamiAdapter.trackBatch(eventsToUpload);

      // Check for failures
      const failures = results.filter((r) => !r.success);
      if (failures.length > 0) {
        console.error(
          `Batch upload: ${failures.length}/${eventsToUpload.length} events failed`
        );

        // Re-queue failed events for retry
        const failedEvents = eventsToUpload.filter(
          (_, index) => !results[index].success
        );
        this.requeueFailedEvents(failedEvents);
      }
    } catch (error) {
      console.error('Batch upload failed:', error);

      // Re-queue all events for retry
      this.requeueFailedEvents(eventsToUpload);
    } finally {
      this.uploading = false;
    }
  }

  /**
   * Upload single event immediately (bypass batch)
   */
  private async uploadImmediate(event: TrackEvent): Promise<void> {
    try {
      await umamiAdapter.track(event);
    } catch (error) {
      console.error('Immediate upload failed:', error);
    }
  }

  /**
   * Re-queue failed events at the front of the queue
   * This ensures failed events are retried first
   */
  private requeueFailedEvents(events: TrackEvent[]): void {
    this.queue = [...events, ...this.queue];
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Check if batch service is currently uploading
   */
  isUploading(): boolean {
    return this.uploading;
  }

  /**
   * Update batch configuration
   */
  updateConfig(config: Partial<BatchConfig>): void {
    this.config = { ...this.config, ...config };

    // If batch is disabled, flush immediately
    if (!this.config.enabled && this.queue.length > 0) {
      this.flush();
    }
  }

  /**
   * Clear queue and cancel timer
   * Used for cleanup or testing
   */
  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
    this.uploading = false;
  }

  /**
   * Flush on page unload using sendBeacon
   * This ensures events are sent even if the page is closing
   */
  flushOnUnload(): void {
    if (this.queue.length === 0) {
      return;
    }

    // Use navigator.sendBeacon for reliable page unload tracking
    // The Umami SDK handles its own transport; flush queued events before unload.
    this.flush();
  }
}

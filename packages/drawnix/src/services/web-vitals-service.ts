/**
 * Web Vitals Monitoring Service
 *
 * Monitors Core Web Vitals metrics and reports them to Umami:
 * - LCP (Largest Contentful Paint): Loading performance
 * - FID (First Input Delay): Interactivity
 * - CLS (Cumulative Layout Shift): Visual stability
 * - FCP (First Contentful Paint): First paint time
 * - TTFB (Time to First Byte): Server response time
 * - INP (Interaction to Next Paint): New responsiveness metric
 */

import type { Metric } from 'web-vitals';
import { analytics } from '../utils/umami-analytics';

/**
 * Report Web Vitals metric to Umami
 *
 * The event keeps the existing $web_vitals property names for dashboard compatibility:
 * - $web_vitals_<METRIC>_value: numeric value
 * - $web_vitals_<METRIC>_event: event details object
 */
function reportWebVitals(metric: Metric): void {
  if (!analytics.isAnalyticsEnabled()) {
    // console.debug('[Web Vitals] Umami not available, skipping metric:', metric.name);
    return;
  }

  const rating = getMetricRating(metric.name, metric.value);

  // 精简 metadata 减小 payload（只传 pathname，referrer 截断）
  const ref = document.referrer;
  const eventProperties: Record<string, any> = {
    [`$web_vitals_${metric.name}_value`]: metric.value,
    [`$web_vitals_${metric.name}_event`]: {
      id: metric.id,
      delta: metric.delta,
      rating: rating,
      navigationType: metric.navigationType,
    },
    page_path: window.location.pathname,
    referrer: ref.length > 200 ? ref.slice(0, 200) : ref,
    timestamp: Date.now(),
  };

  // 延后上报，不阻塞 CWV 回调栈（analytics.track 内部也会在空闲时执行）
  setTimeout(() => {
    analytics.track('$web_vitals', eventProperties);
  }, 0);
}

/**
 * Get metric rating based on Web Vitals thresholds
 * Thresholds from: https://web.dev/articles/vitals
 */
function getMetricRating(
  name: string,
  value: number
): 'good' | 'needs-improvement' | 'poor' {
  const thresholds: Record<string, { good: number; poor: number }> = {
    // LCP: < 2.5s (good), < 4s (needs improvement), >= 4s (poor)
    LCP: { good: 2500, poor: 4000 },
    // FID: < 100ms (good), < 300ms (needs improvement), >= 300ms (poor)
    FID: { good: 100, poor: 300 },
    // CLS: < 0.1 (good), < 0.25 (needs improvement), >= 0.25 (poor)
    CLS: { good: 0.1, poor: 0.25 },
    // FCP: < 1.8s (good), < 3s (needs improvement), >= 3s (poor)
    FCP: { good: 1800, poor: 3000 },
    // TTFB: < 800ms (good), < 1800ms (needs improvement), >= 1800ms (poor)
    TTFB: { good: 800, poor: 1800 },
    // INP: < 200ms (good), < 500ms (needs improvement), >= 500ms (poor)
    INP: { good: 200, poor: 500 },
  };

  const threshold = thresholds[name];
  if (!threshold) {
    return 'needs-improvement'; // Unknown metric
  }

  if (value <= threshold.good) {
    return 'good';
  }
  if (value <= threshold.poor) {
    return 'needs-improvement';
  }
  return 'poor';
}

/**
 * Initialize Web Vitals monitoring
 * Dynamically imports web-vitals library and starts monitoring
 */
export async function initWebVitals(): Promise<void> {
  try {
    // Dynamically import web-vitals to avoid bundling if not used
    const webVitals = await import('web-vitals');
    const { onCLS, onFCP, onLCP, onTTFB, onINP } = webVitals;

    // Monitor all Core Web Vitals
    onCLS(reportWebVitals); // Cumulative Layout Shift
    onFCP(reportWebVitals); // First Contentful Paint
    onLCP(reportWebVitals); // Largest Contentful Paint
    onTTFB(reportWebVitals); // Time to First Byte
    onINP(reportWebVitals); // Interaction to Next Paint (replaces FID)

    // console.log('[Web Vitals] Monitoring initialized successfully');
  } catch (error) {
    console.error('[Web Vitals] Failed to initialize monitoring:', error);
  }
}

/**
 * Stop Web Vitals monitoring (for cleanup if needed)
 * Note: web-vitals library doesn't provide a direct stop method,
 * but observers will be garbage collected when page unloads
 */
export function stopWebVitals(): void {
  // console.log('[Web Vitals] Monitoring stopped (observers will be garbage collected)');
}

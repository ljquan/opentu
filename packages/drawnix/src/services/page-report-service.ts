/**
 * Page Report Monitoring Service
 *
 * Monitors page lifecycle and performance metrics:
 * - Umami owns standard page views
 * - Page load time and performance
 * - Visibility and unload events
 */

import { analytics } from '../utils/umami-analytics';

/**
 * Page report event category
 */
const PAGE_REPORT_CATEGORY = 'page_report';

let pageReportInitialized = false;

/**
 * Page performance data interface
 */
interface PagePerformanceData {
  page_url: string;
  page_path: string;
  // Navigation Timing API metrics
  dns_time?: number; // DNS lookup time
  tcp_time?: number; // TCP connection time
  request_time?: number; // Request time
  response_time?: number; // Response time
  dom_processing_time?: number; // DOM processing time
  dom_interactive_time?: number; // DOM interactive time
  dom_complete_time?: number; // DOM complete time
  load_time?: number; // Total page load time
  // Resource Timing
  total_resources?: number;
  total_size?: number; // Total resource size in bytes
  timestamp: number;
}

/**
 * Collect page performance data using Navigation Timing API Level 2
 */
function collectPagePerformanceData(): PagePerformanceData | null {
  // Check if Performance API is available
  if (!window.performance) {
    return null;
  }

  const data: PagePerformanceData = {
    page_url: window.location.pathname,
    page_path: window.location.pathname,
    timestamp: Date.now(),
  };

  // Use modern Performance Navigation Timing API (Level 2) if available
  if (window.performance.getEntriesByType) {
    const navEntries = window.performance.getEntriesByType(
      'navigation'
    ) as PerformanceNavigationTiming[];

    if (navEntries && navEntries.length > 0) {
      const navEntry = navEntries[0];

      // DNS lookup time
      if (navEntry.domainLookupEnd && navEntry.domainLookupStart) {
        data.dns_time = navEntry.domainLookupEnd - navEntry.domainLookupStart;
      }

      // TCP connection time
      if (navEntry.connectEnd && navEntry.connectStart) {
        data.tcp_time = navEntry.connectEnd - navEntry.connectStart;
      }

      // Request time
      if (navEntry.responseStart && navEntry.requestStart) {
        data.request_time = navEntry.responseStart - navEntry.requestStart;
      }

      // Response time
      if (navEntry.responseEnd && navEntry.responseStart) {
        data.response_time = navEntry.responseEnd - navEntry.responseStart;
      }

      // DOM processing time
      if (navEntry.domComplete && navEntry.domInteractive) {
        data.dom_processing_time =
          navEntry.domComplete - navEntry.domInteractive;
      }

      // DOM interactive time
      if (navEntry.domInteractive && navEntry.fetchStart) {
        data.dom_interactive_time =
          navEntry.domInteractive - navEntry.fetchStart;
      }

      // DOM complete time
      if (navEntry.domComplete && navEntry.fetchStart) {
        data.dom_complete_time = navEntry.domComplete - navEntry.fetchStart;
      }

      // Total page load time
      if (navEntry.loadEventEnd && navEntry.fetchStart) {
        data.load_time = navEntry.loadEventEnd - navEntry.fetchStart;
      }
    }
  }

  // Resource timing (if available)
  if (window.performance.getEntriesByType) {
    const resources = window.performance.getEntriesByType('resource');
    data.total_resources = resources.length;

    // Calculate total resource size
    data.total_size = resources.reduce((total, resource: any) => {
      return total + (resource.transferSize || 0);
    }, 0);
  }

  return data;
}

/**
 * Track page performance event
 * Should be called after page load is complete
 */
export function trackPagePerformance(): void {
  if (!analytics.isAnalyticsEnabled()) {
    // console.debug('[Page Report] Umami not available, skipping performance');
    return;
  }

  const performanceData = collectPagePerformanceData();
  if (!performanceData) {
    console.warn('[Page Report] Performance data not available');
    return;
  }

  analytics.track('page_performance', {
    category: PAGE_REPORT_CATEGORY,
    ...performanceData,
  });

  // console.log('[Page Report] Page performance tracked:', {
  //   load_time: performanceData.load_time,
  //   dom_complete_time: performanceData.dom_complete_time,
  //   total_resources: performanceData.total_resources,
  // });
}

/**
 * Track page unload event (when user leaves the page)
 */
export function trackPageUnload(): void {
  if (!analytics.isAnalyticsEnabled()) {
    return;
  }

  // Calculate time on page using performance.now() for better accuracy
  const timeOnPage = Math.round(performance.now());

  analytics.track('page_unload', {
    category: PAGE_REPORT_CATEGORY,
    page_url: window.location.href,
    page_path: window.location.pathname,
    time_on_page: timeOnPage,
    timestamp: Date.now(),
  });
}

/**
 * Initialize Page Report monitoring
 */
export function initPageReport(): void {
  try {
    if (pageReportInitialized) {
      return;
    }
    pageReportInitialized = true;

    // Track page performance after load
    if (document.readyState === 'complete') {
      // Page already loaded
      trackPagePerformance();
    } else {
      // Wait for page to load
      window.addEventListener('load', () => {
        // Delay to ensure all timing data is available
        setTimeout(() => {
          trackPagePerformance();
        }, 0);
      });
    }

    // Track page unload (use beforeunload for better reliability)
    window.addEventListener('beforeunload', () => {
      trackPageUnload();
    });

    // Track page visibility changes (tab switching)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        analytics.track('page_hidden', {
          category: PAGE_REPORT_CATEGORY,
          page_url: window.location.href,
          page_path: window.location.pathname,
          timestamp: Date.now(),
        });
      } else if (document.visibilityState === 'visible') {
        analytics.track('page_visible', {
          category: PAGE_REPORT_CATEGORY,
          page_url: window.location.href,
          page_path: window.location.pathname,
          timestamp: Date.now(),
        });
      }
    });

    // console.log('[Page Report] Monitoring initialized successfully');
  } catch (error) {
    console.error('[Page Report] Failed to initialize monitoring:', error);
  }
}

/**
 * Stop Page Report monitoring (for cleanup if needed)
 */
export function stopPageReport(): void {
  // console.log('[Page Report] Monitoring stopped');
  // Note: Event listeners will be removed when page unloads
  // If you need explicit cleanup, you would need to store listener references
}

/**
 * Crash Logger - 崩溃日志记录系统
 *
 * 在页面崩溃前记录关键状态信息，持久化到 SW/IndexedDB，
 * 便于用户在 sw-debug.html 导出分析。
 *
 * 功能：
 * 1. 页面启动时记录初始快照
 * 2. 定期内存快照（仅在内存使用较高时）
 * 3. 全局错误捕获
 * 4. beforeunload 事件记录最后状态
 */

import { sanitizeUrl } from '@aitu/utils';
import { swChannelClient } from '@drawnix/drawnix/runtime';

// ==================== 类型定义 ====================

export interface CrashSnapshot {
  id: string;
  timestamp: number;
  type:
    | 'startup'
    | 'periodic'
    | 'error'
    | 'beforeunload'
    | 'freeze'
    | 'whitescreen'
    | 'longtask';
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  // 页面状态分析（仅在连续高内存时收集）
  pageStats?: {
    // DOM 统计
    domNodeCount: number;
    canvasCount: number;
    imageCount: number;
    videoCount: number;
    iframeCount: number;
    // 事件监听器（仅 Chrome）
    eventListenerCount?: number;
    // 定时器
    // 画布相关
    plaitBoardExists: boolean;
    plaitElementCount?: number;
  };
  // 性能指标（卡死/长任务检测）
  performance?: {
    fps?: number; // 当前帧率
    longTaskDuration?: number; // 长任务持续时间（毫秒）
    freezeDuration?: number; // 卡死持续时间（毫秒）
    lastHeartbeat?: number; // 上次心跳时间戳
  };
  userAgent: string;
  url: string;
  error?: {
    message: string;
    stack?: string;
    type: string;
  };
  customData?: Record<string, unknown>;
}

// ==================== 配置常量 ====================

/** 定期快照间隔（毫秒）- 降低频率减少开销 */
const PERIODIC_SNAPSHOT_INTERVAL = 30000; // 30 秒

/** 内存使用阈值（MB），超过此值才记录定期快照 */
const MEMORY_THRESHOLD_MB = 800; // 提高阈值，减少不必要的日志

/** 内存使用比例阈值，超过此比例才记录定期快照 */
const MEMORY_RATIO_THRESHOLD = 0.6; // 60%

/** 连续高内存次数阈值，超过才收集详细页面统计 */
const HIGH_MEMORY_COUNT_FOR_DETAILS = 3;

/** localStorage 中保存最后快照的 key */
const LAST_SNAPSHOT_KEY = 'aitu_last_snapshot';

/** 操作监控：内存变化超过此阈值才记录（MB） */
const OPERATION_MEMORY_DELTA_THRESHOLD = 50;

/** 待发送的快照队列（在 swChannelClient 未初始化时缓存） */
const pendingSnapshots: CrashSnapshot[] = [];

/** 最大待发送快照数量（防止内存溢出） */
const MAX_PENDING_SNAPSHOTS = 20;

/** 队列检查间隔（毫秒） */
const QUEUE_CHECK_INTERVAL = 2000;

/** 队列检查定时器 */
let queueCheckInterval: ReturnType<typeof setInterval> | null = null;

/** 心跳间隔（毫秒）- 用于检测主线程卡死 */
const HEARTBEAT_INTERVAL = 3000; // 3 秒

/** 心跳超时阈值（毫秒）- 超过此时间没有心跳认为卡死 */
const HEARTBEAT_TIMEOUT = 10000; // 10 秒

/** 长任务阈值（毫秒）- 超过此时间的任务被记录 */
const LONG_TASK_THRESHOLD = 200; // 200ms（比默认的 50ms 高，减少噪音）

/** FPS 检测间隔（毫秒） */
const FPS_CHECK_INTERVAL = 5000; // 5 秒

/** FPS 警告阈值 */
const FPS_WARNING_THRESHOLD = 10; // 低于 10 FPS 时警告

/** 白屏检测延迟（毫秒）- 页面加载后多久开始检测 */
const WHITESCREEN_CHECK_DELAY = 5000; // 5 秒

/** 用户操作轨迹最大记录数 */
const MAX_USER_ACTIONS = 30;

/** 控制台错误最大记录数 */
const MAX_CONSOLE_ERRORS = 20;

/** 网络错误最大记录数 */
const MAX_NETWORK_ERRORS = 20;

/** 点击事件节流间隔 (ms) */
const CLICK_THROTTLE_INTERVAL = 100;

/** FPS 采样帧数（每 N 帧计算一次，减少计算频率）*/
const FPS_SAMPLE_FRAMES = 30;

/** 错误上下文中保留的资源摘要数量 */
const MAX_RESOURCE_SUMMARY_ITEMS = 8;

/** 错误上下文中的字符串最大长度 */
const MAX_CONTEXT_STRING_LENGTH = 240;

function getErrorName(value: unknown): string {
  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === 'string' ? name : '';
  }
  return '';
}

function getErrorMessage(value: unknown, fallback = ''): string {
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return typeof value === 'string' ? value : fallback;
}

function isExpectedBrowserCapabilityError(
  value: unknown,
  fallbackMessage = ''
): boolean {
  const name = getErrorName(value);
  const message = getErrorMessage(value, fallbackMessage);
  const isAbortError =
    name === 'AbortError' ||
    message.startsWith('AbortError:') ||
    message.includes('AbortError');
  const isNotAllowedError =
    name === 'NotAllowedError' || message.startsWith('NotAllowedError:');
  const isDataError = name === 'DataError' || message.startsWith('DataError:');

  if (
    message.includes(
      'ResizeObserver loop completed with undelivered notifications'
    ) ||
    message.includes('ResizeObserver loop limit exceeded')
  ) {
    return true;
  }

  if (
    message.includes('WebCodecs API') &&
    (message.includes('Chrome 94+') || message.includes('Edge 94+'))
  ) {
    return true;
  }

  if (
    isAbortError &&
    (message.includes('The user aborted a request') ||
      message.includes("Failed to execute 'showOpenFilePicker'") ||
      message.includes("Failed to execute 'showSaveFilePicker'"))
  ) {
    return true;
  }

  if (
    isNotAllowedError &&
    message.includes("Failed to execute 'write' on 'Clipboard'") &&
    message.includes('permissions policy')
  ) {
    return true;
  }

  return isDataError && message.includes('No key or key range specified');
}

// ==================== 内部状态 ====================

let snapshotInterval: number | null = null;
let initialized = false;
let heartbeatInterval: number | null = null;
let fpsCheckInterval: number | null = null;
let longTaskObserver: PerformanceObserver | null = null;
let lastFrameTime = 0;
const frameCount = 0;
let currentFps = 60;
let whitescreenReported = false;
let pageWasHidden = false; // 跟踪页面是否曾在后台

// 用户操作轨迹
const userActions: Array<{
  time: number;
  action: string;
  target?: string;
  detail?: string;
}> = [];

// 控制台错误收集
const consoleErrors: Array<{
  time: number;
  message: string;
  stack?: string;
}> = [];

// 网络错误收集
const networkErrors: Array<{
  time: number;
  url: string;
  method?: string;
  status?: number;
  statusText?: string;
  error?: string;
  duration?: number;
}> = [];

// ==================== 操作监控 API ====================

/**
 * 轻量级操作监控
 * 只在操作导致内存变化超过阈值时才记录日志
 *
 * @example
 * const end = trackOperation('图片合并');
 * await mergeImages();
 * end(); // 只在内存变化 > 50MB 时输出日志
 */
export function trackOperation(label: string): () => void {
  const startMem = getMemoryInfo();
  const startTime = Date.now();

  return () => {
    const endMem = getMemoryInfo();
    if (!startMem || !endMem) return;

    const deltaMB =
      (endMem.usedJSHeapSize - startMem.usedJSHeapSize) / (1024 * 1024);
    const duration = Date.now() - startTime;

    // 只在内存变化超过阈值时记录
    if (Math.abs(deltaMB) >= OPERATION_MEMORY_DELTA_THRESHOLD) {
      const sign = deltaMB >= 0 ? '+' : '';
      console.warn(
        `[MemoryLog] ${label}: ${sign}${deltaMB.toFixed(0)} MB (${duration}ms)`
      );
    }
  };
}

/**
 * 异步操作监控包装器
 *
 * @example
 * const result = await withMemoryTracking('AI生成', async () => {
 *   return await generateImage(params);
 * });
 */
export async function withMemoryTracking<T>(
  label: string,
  operation: () => Promise<T>
): Promise<T> {
  const end = trackOperation(label);
  try {
    return await operation();
  } finally {
    end();
  }
}

declare const __APP_VERSION__: string;

function truncateContextValue(
  value: string | null | undefined
): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.slice(0, MAX_CONTEXT_STRING_LENGTH);
}

function getAppVersion(): string {
  if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
    return __APP_VERSION__;
  }

  return (
    document
      .querySelector('meta[name="app-version"]')
      ?.getAttribute('content') || '0.0.0'
  );
}

function getServiceWorkerContext(): Record<string, unknown> {
  if (
    typeof navigator === 'undefined' ||
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return {
      supported: false,
      readyState: document.readyState,
      visibilityState: document.visibilityState,
    };
  }

  const controller = navigator.serviceWorker.controller;

  return {
    supported: true,
    controller: controller
      ? {
          scriptURL: truncateContextValue(controller.scriptURL),
          state: controller.state,
        }
      : null,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
  };
}

function getLoadedResourceSummary(): Record<string, unknown> {
  const scriptUrls = Array.from(document.scripts)
    .map((script) => truncateContextValue(sanitizeUrl(script.src)))
    .filter(Boolean)
    .slice(-MAX_RESOURCE_SUMMARY_ITEMS);

  const stylesheetUrls = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  )
    .map((link) => truncateContextValue(sanitizeUrl(link.href)))
    .filter(Boolean)
    .slice(-MAX_RESOURCE_SUMMARY_ITEMS);

  const modulePreloadUrls = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')
  )
    .map((link) => truncateContextValue(sanitizeUrl(link.href)))
    .filter(Boolean)
    .slice(-MAX_RESOURCE_SUMMARY_ITEMS);

  return {
    scripts: scriptUrls,
    stylesheets: stylesheetUrls,
    modulePreloads: modulePreloadUrls,
  };
}

function getEventTargetContext(
  target: EventTarget | null
): Record<string, unknown> | undefined {
  if (!(target instanceof HTMLElement)) {
    return undefined;
  }

  const assetTarget = target as HTMLElement & {
    src?: string;
    currentSrc?: string;
    href?: string;
    rel?: string;
    crossOrigin?: string | null;
  };

  return {
    tagName: target.tagName.toLowerCase(),
    id: truncateContextValue(target.id || undefined),
    className:
      typeof target.className === 'string'
        ? truncateContextValue(target.className)
        : undefined,
    src: truncateContextValue(
      assetTarget.currentSrc || assetTarget.src
        ? sanitizeUrl(assetTarget.currentSrc || assetTarget.src || '')
        : undefined
    ),
    href: truncateContextValue(
      assetTarget.href ? sanitizeUrl(assetTarget.href) : undefined
    ),
    rel: truncateContextValue(assetTarget.rel),
    crossOrigin: truncateContextValue(assetTarget.crossOrigin || undefined),
  };
}

function buildErrorDiagnosticContext(
  overrides?: Record<string, unknown>
): Record<string, unknown> {
  return {
    appVersion: getAppVersion(),
    recentActions: userActions.slice(-10),
    recentErrors: consoleErrors.slice(-5),
    recentNetworkErrors: networkErrors.slice(-5),
    serviceWorker: getServiceWorkerContext(),
    loadedResources: getLoadedResourceSummary(),
    ...overrides,
  };
}

// ==================== 工具函数 ====================

/**
 * 获取当前内存信息（Chrome 专有）
 */
function getMemoryInfo(): CrashSnapshot['memory'] | undefined {
  if (typeof performance !== 'undefined' && 'memory' in performance) {
    const mem = (performance as any).memory;
    return {
      usedJSHeapSize: mem.usedJSHeapSize,
      totalJSHeapSize: mem.totalJSHeapSize,
      jsHeapSizeLimit: mem.jsHeapSizeLimit,
    };
  }
  return undefined;
}

/**
 * 格式化内存大小为 MB
 */
function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

/** 页面统计信息类型（非空） */
interface PageStats {
  domNodeCount: number;
  canvasCount: number;
  imageCount: number;
  videoCount: number;
  iframeCount: number;
  plaitBoardExists: boolean;
  plaitElementCount?: number;
  eventListenerCount?: number;
}

/**
 * 收集页面状态统计信息
 * 用于分析内存占用的具体来源
 */
function collectPageStats(): PageStats {
  try {
    const stats: PageStats = {
      domNodeCount: document.getElementsByTagName('*').length,
      canvasCount: document.getElementsByTagName('canvas').length,
      imageCount: document.getElementsByTagName('img').length,
      videoCount: document.getElementsByTagName('video').length,
      iframeCount: document.getElementsByTagName('iframe').length,
      plaitBoardExists: !!document.querySelector('.plait-board-container'),
    };

    // 尝试获取 Plait 元素数量
    const boardContainer = document.querySelector('.plait-board-container');
    if (boardContainer) {
      // SVG 中的 g 元素通常代表画布元素
      const svgGroups = boardContainer.querySelectorAll('svg > g > g');
      stats.plaitElementCount = svgGroups.length;
    }

    // Chrome DevTools 特有的 API（仅开发时可用）
    if (typeof (window as any).getEventListeners === 'function') {
      // 这个 API 仅在 DevTools 控制台中可用，正常代码无法调用
      // 留作参考
    }

    return stats;
  } catch {
    return {
      domNodeCount: 0,
      canvasCount: 0,
      imageCount: 0,
      videoCount: 0,
      iframeCount: 0,
      plaitBoardExists: false,
    };
  }
}

/**
 * 刷新待发送队列 - 将缓存的快照发送到 SW
 */
function flushPendingSnapshots(): void {
  if (!swChannelClient.isInitialized() || pendingSnapshots.length === 0) {
    return;
  }

  // 发送所有待发送的快照
  const snapshots = pendingSnapshots.splice(0, pendingSnapshots.length);
  for (const snapshot of snapshots) {
    swChannelClient.reportCrashSnapshot(snapshot).catch(() => {
      // 忽略发送错误
    });
  }

  // 队列已清空，停止检查
  if (queueCheckInterval) {
    clearInterval(queueCheckInterval);
    queueCheckInterval = null;
  }
}

/**
 * 启动队列检查定时器
 */
function startQueueCheck(): void {
  if (queueCheckInterval) {
    return; // 已经在运行
  }

  queueCheckInterval = setInterval(() => {
    if (swChannelClient.isInitialized()) {
      flushPendingSnapshots();
    }
  }, QUEUE_CHECK_INTERVAL);
}

/**
 * 发送快照到 Service Worker 持久化
 * 如果 SW 通道未初始化，会将快照加入队列等待发送
 */
function sendSnapshotToSW(snapshot: CrashSnapshot): void {
  try {
    // 使用 swChannelClient 发送崩溃快照
    if (swChannelClient.isInitialized()) {
      // 先发送任何待发送的快照
      flushPendingSnapshots();
      // 然后发送当前快照
      swChannelClient.reportCrashSnapshot(snapshot).catch(() => {
        // 忽略发送错误，避免影响主流程
      });
    } else {
      // SW 通道未初始化，加入队列等待
      if (pendingSnapshots.length < MAX_PENDING_SNAPSHOTS) {
        pendingSnapshots.push(snapshot);
        // 启动队列检查
        startQueueCheck();
      }
      // 队列已满时静默丢弃，避免内存问题
    }
  } catch (error) {
    // 忽略发送错误，避免影响主流程
    console.warn('[MemoryLog] Failed to send snapshot to SW:', error);
  }
}

/**
 * 保存快照到 localStorage（作为 beforeunload 的备份）
 */
function saveSnapshotToLocalStorage(snapshot: CrashSnapshot): void {
  try {
    localStorage.setItem(LAST_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // 忽略存储错误
  }
}

/**
 * 从 localStorage 读取上次的快照
 */
export function getLastSnapshotFromLocalStorage(): CrashSnapshot | null {
  try {
    const data = localStorage.getItem(LAST_SNAPSHOT_KEY);
    if (data) {
      return JSON.parse(data) as CrashSnapshot;
    }
  } catch {
    // 忽略解析错误
  }
  return null;
}

/**
 * 清除 localStorage 中的快照
 */
export function clearLastSnapshotFromLocalStorage(): void {
  try {
    localStorage.removeItem(LAST_SNAPSHOT_KEY);
  } catch {
    // 忽略删除错误
  }
}

// ==================== 核心功能 ====================

/**
 * 记录启动快照
 * 优化：启动时不收集 pageStats（此时内存通常较低，无需详细信息）
 */
export function recordStartupSnapshot(): void {
  const snapshot: CrashSnapshot = {
    id: `startup-${Date.now()}`,
    timestamp: Date.now(),
    type: 'startup',
    userAgent: navigator.userAgent,
    url: location.href,
    memory: getMemoryInfo(),
    // 启动时不收集 pageStats 和 storage，减少初始化开销
    // 注：storage.estimate() 返回的是浏览器配额，不是实际磁盘空间，意义不大
  };

  sendSnapshotToSW(snapshot);
}

/**
 * 开始定期内存快照
 * 优化策略：
 * 1. 只在内存超过阈值时才记录
 * 2. 只有连续多次高内存才收集详细页面统计（避免 DOM 查询开销）
 * 3. 日志精简，减少控制台输出
 */
export function startPeriodicSnapshots(): void {
  if (snapshotInterval !== null) {
    return; // 已经在运行
  }

  // 追踪状态
  let lastUsedMB = 0;
  let highMemoryCount = 0; // 连续高内存次数

  snapshotInterval = window.setInterval(() => {
    const memory = getMemoryInfo();
    if (!memory) return;

    const usedMB = memory.usedJSHeapSize / (1024 * 1024);
    const limitMB = memory.jsHeapSizeLimit / (1024 * 1024);
    const ratio = usedMB / limitMB;

    // 检查是否超过阈值
    const isHighMemory =
      usedMB > MEMORY_THRESHOLD_MB || ratio > MEMORY_RATIO_THRESHOLD;

    if (isHighMemory) {
      highMemoryCount++;

      // 只有连续多次高内存才收集详细信息（减少 DOM 查询开销）
      const shouldCollectDetails =
        highMemoryCount >= HIGH_MEMORY_COUNT_FOR_DETAILS;
      const pageStats = shouldCollectDetails ? collectPageStats() : undefined;

      const snapshot: CrashSnapshot = {
        id: `periodic-${Date.now()}`,
        timestamp: Date.now(),
        type: 'periodic',
        memory,
        pageStats,
        userAgent: navigator.userAgent,
        url: location.href,
      };

      sendSnapshotToSW(snapshot);

      // 日志已发送到 SW，不再在控制台输出
    } else {
      // 内存恢复正常，重置计数
      highMemoryCount = 0;
    }

    lastUsedMB = usedMB;
  }, PERIODIC_SNAPSHOT_INTERVAL);
}

/**
 * 停止定期快照
 */
export function stopPeriodicSnapshots(): void {
  if (snapshotInterval !== null) {
    window.clearInterval(snapshotInterval);
    snapshotInterval = null;
  }
}

/**
 * 设置全局错误捕获
 */
export function setupErrorCapture(): void {
  // JavaScript 未捕获错误
  window.addEventListener('error', (event) => {
    if (isExpectedBrowserCapabilityError(event.error, event.message)) {
      return;
    }

    const snapshot: CrashSnapshot = {
      id: `error-${Date.now()}`,
      timestamp: Date.now(),
      type: 'error',
      error: {
        message: event.message || 'Unknown error',
        stack: event.error?.stack,
        type: 'uncaughtError',
      },
      memory: getMemoryInfo(),
      userAgent: navigator.userAgent,
      url: location.href,
      customData: buildErrorDiagnosticContext({
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        eventTarget: getEventTargetContext(event.target),
      }),
    };

    sendSnapshotToSW(snapshot);
    console.error('[MemoryLog] Uncaught error captured:', event.message);
  });

  // 未处理的 Promise rejection
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const errorMessage = reason?.message || String(reason) || '';
    const errorStack = reason?.stack || '';

    if (isExpectedBrowserCapabilityError(reason, errorMessage)) {
      return;
    }

    // 过滤监控服务相关的错误（Umami）
    if (
      errorMessage.includes('umami.tu-zi.com') ||
      errorStack.includes('umami')
    ) {
      return; // 静默忽略监控服务的网络错误
    }

    const snapshot: CrashSnapshot = {
      id: `rejection-${Date.now()}`,
      timestamp: Date.now(),
      type: 'error',
      error: {
        message: errorMessage || 'Unhandled Promise rejection',
        stack: errorStack,
        type: 'unhandledRejection',
      },
      memory: getMemoryInfo(),
      userAgent: navigator.userAgent,
      url: location.href,
      customData: buildErrorDiagnosticContext(),
    };

    sendSnapshotToSW(snapshot);
    console.error('[MemoryLog] Unhandled rejection captured:', reason);
  });

  // 页面即将关闭/崩溃 - 最后的机会记录状态
  window.addEventListener('beforeunload', () => {
    const memory = getMemoryInfo();
    if (memory) {
      const snapshot: CrashSnapshot = {
        id: `beforeunload-${Date.now()}`,
        timestamp: Date.now(),
        type: 'beforeunload',
        memory,
        userAgent: navigator.userAgent,
        url: location.href,
      };

      // 同时保存到 localStorage 和发送到 SW
      // localStorage 作为备份，因为 postMessage 可能不可靠
      saveSnapshotToLocalStorage(snapshot);
      sendSnapshotToSW(snapshot);
    }
  });
}

// ==================== 卡死/白屏监控 ====================

/**
 * 设置心跳检测 - 检测主线程卡死
 * 通过向 Service Worker 发送心跳，如果心跳超时说明主线程被阻塞
 */
export function setupHeartbeat(): void {
  if (heartbeatInterval !== null) return;

  let lastHeartbeatTime = Date.now();

  // 监听页面可见性变化，标记页面是否进入过后台
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pageWasHidden = true;
    } else {
      // 页面恢复可见时，重置心跳时间，避免误报
      lastHeartbeatTime = Date.now();
      // 延迟重置标记，确保下一次心跳不会误判
      setTimeout(() => {
        pageWasHidden = false;
      }, HEARTBEAT_INTERVAL + 100);
    }
  });

  // 定期发送心跳到 SW
  heartbeatInterval = window.setInterval(() => {
    const now = Date.now();
    const gap = now - lastHeartbeatTime;

    // 如果两次心跳间隔超过阈值，说明之前发生了卡死
    // 但如果页面曾在后台，则不是真正的卡死，跳过
    if (gap > HEARTBEAT_TIMEOUT && !pageWasHidden && !document.hidden) {
      const snapshot: CrashSnapshot = {
        id: `freeze-${Date.now()}`,
        timestamp: Date.now(),
        type: 'freeze',
        memory: getMemoryInfo(),
        pageStats: collectPageStats(),
        performance: {
          freezeDuration: gap,
          lastHeartbeat: lastHeartbeatTime,
          fps: currentFps,
        },
        userAgent: navigator.userAgent,
        url: location.href,
        customData: {
          recentActions: userActions.slice(-10),
          recentErrors: consoleErrors.slice(-5),
          recentNetworkErrors: networkErrors.slice(-5),
        },
      };

      sendSnapshotToSW(snapshot);
      // 日志已发送到 SW，不再在控制台输出
    }

    lastHeartbeatTime = now;

    // 发送心跳到 SW（用于 SW 端检测页面是否响应）
    if (swChannelClient.isInitialized()) {
      swChannelClient.sendHeartbeat(now).catch(() => {
        // 忽略心跳发送错误
      });
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * 设置长任务监控 - 使用 PerformanceObserver API
 * 监控超过阈值的长任务
 */
export function setupLongTaskMonitoring(): void {
  if (longTaskObserver !== null) return;

  // 检查浏览器是否支持 PerformanceObserver 和 longtask
  if (typeof PerformanceObserver === 'undefined') return;

  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // 只记录超过阈值的长任务
        if (entry.duration > LONG_TASK_THRESHOLD) {
          // 提取 attribution 信息（如果有的话）
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const longTaskEntry = entry as any;
          const attribution = longTaskEntry.attribution;
          let attributionInfo: Record<string, unknown> | undefined;

          if (attribution && attribution.length > 0) {
            const attr = attribution[0];
            attributionInfo = {
              name: attr.name,
              containerType: attr.containerType,
              containerSrc: attr.containerSrc,
              containerId: attr.containerId,
              containerName: attr.containerName,
            };
          }

          const snapshot: CrashSnapshot = {
            id: `longtask-${Date.now()}`,
            timestamp: Date.now(),
            type: 'longtask',
            memory: getMemoryInfo(),
            performance: {
              longTaskDuration: entry.duration,
              fps: currentFps,
            },
            userAgent: navigator.userAgent,
            url: location.href,
            customData: {
              taskName: entry.name,
              startTime: entry.startTime,
              attribution: attributionInfo,
              // 提示：Long Task API 无法获取调用栈，需要使用 DevTools Performance 面板
              debugTip:
                'Use Chrome DevTools Performance panel to record and analyze the call stack',
            },
          };

          sendSnapshotToSW(snapshot);
          // 日志已发送到 SW，不再在控制台输出
        }
      }
    });

    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch {
    // longtask 可能不被支持
  }
}

/**
 * 设置 FPS 监控 - 检测页面流畅度
 * 优化：减少采样频率，降低性能开销
 */
export function setupFpsMonitoring(): void {
  if (fpsCheckInterval !== null) return;

  // 优化：使用采样帧数而非每帧计算，降低 RAF 回调频率
  let sampleCount = 0;

  const measureFps = () => {
    sampleCount++;

    // 每 N 帧才计算一次 FPS（减少计算频率）
    if (sampleCount >= FPS_SAMPLE_FRAMES) {
      const now = performance.now();
      const elapsed = now - lastFrameTime;

      if (elapsed > 0) {
        currentFps = Math.round((sampleCount * 1000) / elapsed);
      }

      sampleCount = 0;
      lastFrameTime = now;
    }

    requestAnimationFrame(measureFps);
  };

  lastFrameTime = performance.now();
  requestAnimationFrame(measureFps);

  // 定期检查 FPS 并在过低时记录
  fpsCheckInterval = window.setInterval(() => {
    if (currentFps < FPS_WARNING_THRESHOLD && currentFps > 0) {
      const snapshot: CrashSnapshot = {
        id: `lowfps-${Date.now()}`,
        timestamp: Date.now(),
        type: 'freeze',
        memory: getMemoryInfo(),
        performance: {
          fps: currentFps,
        },
        userAgent: navigator.userAgent,
        url: location.href,
      };

      sendSnapshotToSW(snapshot);
      // 日志已发送到 SW，不再在控制台输出
    }
  }, FPS_CHECK_INTERVAL);
}

/**
 * 设置白屏检测 - 检查关键 DOM 元素是否存在
 */
export function setupWhitescreenDetection(): void {
  // 延迟检测，给页面加载时间
  setTimeout(() => {
    checkForWhitescreen();
  }, WHITESCREEN_CHECK_DELAY);

  // 监听页面可见性变化，切回页面时也检测
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !whitescreenReported) {
      setTimeout(checkForWhitescreen, 1000);
    }
  });
}

/**
 * 检测白屏
 */
function checkForWhitescreen(): void {
  if (whitescreenReported) return;

  // 检查关键 DOM 元素
  const root = document.getElementById('root');
  const hasContent = root && root.children.length > 0;
  const plaitBoard = document.querySelector('.plait-board-container');
  const hasPlaitBoard = !!plaitBoard;

  // 检查是否有可见内容
  const bodyHasContent = document.body.children.length > 1; // 至少有 root 以外的元素

  // 如果 root 存在但没有子元素，可能是白屏
  if (root && !hasContent) {
    whitescreenReported = true;

    const snapshot: CrashSnapshot = {
      id: `whitescreen-${Date.now()}`,
      timestamp: Date.now(),
      type: 'whitescreen',
      memory: getMemoryInfo(),
      pageStats: {
        domNodeCount: document.getElementsByTagName('*').length,
        canvasCount: 0,
        imageCount: 0,
        videoCount: 0,
        iframeCount: 0,
        plaitBoardExists: hasPlaitBoard,
      },
      userAgent: navigator.userAgent,
      url: location.href,
      customData: {
        rootExists: !!root,
        rootChildCount: root?.children.length || 0,
        bodyChildCount: document.body.children.length,
        hasPlaitBoard,
      },
    };

    sendSnapshotToSW(snapshot);
    console.error('[MemoryLog] 白屏检测: React 未渲染内容');
  }

  // 如果应用已加载但画板不存在（且不是首页等非画板页面）
  if (hasContent && !hasPlaitBoard && location.pathname === '/') {
    // 给更多时间，画板可能还在加载
    setTimeout(() => {
      if (
        !document.querySelector('.plait-board-container') &&
        !whitescreenReported
      ) {
        whitescreenReported = true;

        const snapshot: CrashSnapshot = {
          id: `whitescreen-noboard-${Date.now()}`,
          timestamp: Date.now(),
          type: 'whitescreen',
          memory: getMemoryInfo(),
          pageStats: collectPageStats(),
          userAgent: navigator.userAgent,
          url: location.href,
          customData: {
            reason: '画板未加载',
            rootChildCount: root?.children.length || 0,
          },
        };

        sendSnapshotToSW(snapshot);
        console.error('[MemoryLog] 白屏检测: 画板组件未加载');
      }
    }, 5000);
  }
}

// ==================== 用户操作轨迹 ====================

/**
 * 记录用户操作
 * 用于问题重现和分析
 */
function recordUserAction(
  action: string,
  target?: string,
  detail?: string
): void {
  userActions.push({
    time: Date.now(),
    action,
    target,
    detail,
  });

  // 保持数组大小在限制内
  if (userActions.length > MAX_USER_ACTIONS) {
    userActions.shift();
  }
}

/**
 * 设置用户操作轨迹监控
 */
export function setupUserActionTracking(): void {
  let lastClickTime = 0;

  // 监听点击事件（节流处理）
  document.addEventListener(
    'click',
    (event) => {
      const now = Date.now();
      // 节流：100ms 内只记录一次点击
      if (now - lastClickTime < CLICK_THROTTLE_INTERVAL) return;
      lastClickTime = now;

      const target = event.target as HTMLElement;
      if (!target) return;

      // 使用 requestIdleCallback 延迟处理，不阻塞主线程
      const processClick = () => {
        let targetDesc = '';

        // 1. 优先使用 data-track 属性
        const trackAttr = target
          .closest?.('[data-track]')
          ?.getAttribute('data-track');
        if (trackAttr) {
          targetDesc = trackAttr;
        } else if (target.tagName === 'BUTTON' || target.closest?.('button')) {
          // 2. 按钮：获取文字或类名
          const btn = (target.closest?.('button') ||
            target) as HTMLButtonElement;
          const text = btn.textContent?.trim().slice(0, 20);
          const cls = btn.className?.split?.(' ')?.[0]?.slice(0, 20);
          targetDesc = `btn:${text || cls || 'unknown'}`;
        } else if (target.tagName === 'A') {
          // 3. 链接
          targetDesc = `link:${
            (target as HTMLAnchorElement).pathname?.slice(0, 30) || ''
          }`;
        } else if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA'
        ) {
          // 4. 输入框
          const input = target as HTMLInputElement;
          targetDesc = `input:${
            input.name || input.type || input.placeholder?.slice(0, 15) || ''
          }`;
        } else if (target.id) {
          // 5. 有 ID
          targetDesc = `#${target.id}`;
        } else {
          // 6. 使用标签和类名
          const cls = target.className?.split?.(' ')?.[0];
          targetDesc = cls
            ? `.${cls.slice(0, 20)}`
            : target.tagName?.toLowerCase() || 'unknown';
        }

        recordUserAction('click', targetDesc);
      };

      // 使用 requestIdleCallback 或 setTimeout 延迟处理
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(processClick, { timeout: 100 });
      } else {
        setTimeout(processClick, 0);
      }
    },
    { capture: true, passive: true }
  );

  // 监听键盘快捷键
  document.addEventListener(
    'keydown',
    (event) => {
      // 只记录快捷键组合
      if (event.ctrlKey || event.metaKey || event.altKey) {
        const keys = [];
        if (event.ctrlKey || event.metaKey) keys.push('Cmd');
        if (event.altKey) keys.push('Alt');
        if (event.shiftKey) keys.push('Shift');
        keys.push(event.key);
        recordUserAction('shortcut', keys.join('+'));
      }
    },
    { capture: true, passive: true }
  );

  // 监听路由变化
  window.addEventListener('popstate', () => {
    recordUserAction('navigate', location.pathname);
  });

  // 监听 hash 变化
  window.addEventListener('hashchange', () => {
    recordUserAction('navigate', location.hash);
  });
}

// ==================== 网络错误监控 ====================

/**
 * 设置网络请求失败监控
 * 优化：只在错误时处理，正常请求零开销
 */
export function setupNetworkErrorTracking(): void {
  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const startTime = Date.now();

    try {
      const response = await originalFetch.call(this, input, init);

      // 只在失败时才处理（正常请求零开销）
      if (!response.ok) {
        const rawUrl =
          typeof input === 'string' ? input : (input as Request).url;
        const duration = Date.now() - startTime;

        // 对 URL 进行脱敏处理，移除敏感参数
        const url = sanitizeUrl(rawUrl).slice(0, 300);

        // 提取更多有用信息
        networkErrors.push({
          time: Date.now(),
          url,
          method: init?.method || 'GET',
          status: response.status,
          statusText: response.statusText,
          duration,
        } as (typeof networkErrors)[0]);

        if (networkErrors.length > MAX_NETWORK_ERRORS) {
          networkErrors.shift();
        }
      }

      return response;
    } catch (error) {
      const rawUrl = typeof input === 'string' ? input : (input as Request).url;
      const duration = Date.now() - startTime;

      // 对 URL 进行脱敏处理，移除敏感参数
      const url = sanitizeUrl(rawUrl).slice(0, 300);

      networkErrors.push({
        time: Date.now(),
        url,
        method: init?.method || 'GET',
        error: (error as Error).message,
        duration,
      } as (typeof networkErrors)[0]);

      if (networkErrors.length > MAX_NETWORK_ERRORS) {
        networkErrors.shift();
      }

      throw error;
    }
  };
}

// ==================== 资源加载失败监控 ====================

/**
 * 设置资源加载失败监控
 */
export function setupResourceErrorTracking(): void {
  // 监听资源加载失败
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target;

      // 只处理资源加载错误（img, script, link 等），排除 window 级别的错误
      if (target && target !== window && target instanceof HTMLElement) {
        if ('src' in target || 'href' in target) {
          const url =
            (target as HTMLImageElement).src ||
            (target as HTMLLinkElement).href;
          const tagName = target.tagName?.toLowerCase();

          recordUserAction('resource_error', tagName, url?.slice(0, 100));

          const snapshot: CrashSnapshot = {
            id: `resource-error-${Date.now()}`,
            timestamp: Date.now(),
            type: 'error',
            error: {
              message: `Resource load failed: ${tagName || 'unknown'}`,
              type: 'resourceError',
            },
            memory: getMemoryInfo(),
            userAgent: navigator.userAgent,
            url: location.href,
            customData: buildErrorDiagnosticContext({
              resourceUrl: truncateContextValue(
                url ? sanitizeUrl(url) : undefined
              ),
              eventTarget: getEventTargetContext(target),
            }),
          };

          sendSnapshotToSW(snapshot);
        }
      }
    },
    { capture: true }
  );
}

// ==================== 控制台错误收集 ====================

/**
 * 设置控制台错误收集
 * 优化：延迟处理，不阻塞主线程
 */
export function setupConsoleErrorTracking(): void {
  const originalError = console.error;

  console.error = function (...args) {
    // 先调用原始方法，确保不影响正常错误输出
    originalError.apply(this, args);

    // 快速检查：排除自己的日志
    const firstArg = args[0];
    if (typeof firstArg === 'string' && firstArg.includes('[MemoryLog]')) {
      return;
    }

    // 捕获 args 快照用于延迟处理
    const argsCopy = [...args];

    // 延迟处理，不阻塞主线程
    setTimeout(() => {
      let message = '';
      let stack: string | undefined;

      for (let i = 0; i < Math.min(argsCopy.length, 5); i++) {
        const arg = argsCopy[i];
        if (typeof arg === 'string') {
          message += arg + ' ';
        } else if (typeof arg === 'number' || typeof arg === 'boolean') {
          message += String(arg) + ' ';
        } else if (arg instanceof Error) {
          message += `Error: ${arg.message} `;
          stack = arg.stack;
        } else if (arg && typeof arg === 'object') {
          // 安全的浅层序列化
          try {
            const keys = Object.keys(arg).slice(0, 5);
            const preview = keys
              .map((k) => {
                const v = (arg as Record<string, unknown>)[k];
                return `${k}:${
                  typeof v === 'string' ? v.slice(0, 20) : typeof v
                }`;
              })
              .join(',');
            message += `{${preview}} `;
          } catch {
            message += `[${arg.constructor?.name || 'Object'}] `;
          }
        }
      }

      consoleErrors.push({
        time: Date.now(),
        message: message.trim().slice(0, 500),
        stack,
      });

      if (consoleErrors.length > MAX_CONSOLE_ERRORS) {
        consoleErrors.shift();
      }
    }, 0);
  };
}

// ==================== 诊断数据导出 ====================

/**
 * 获取完整诊断数据
 * 用于用户导出和问题分析
 */
export function getDiagnosticData(): {
  userActions: typeof userActions;
  consoleErrors: typeof consoleErrors;
  networkErrors: typeof networkErrors;
  memory: ReturnType<typeof getMemoryInfo>;
  pageStats: ReturnType<typeof collectPageStats>;
  fps: number;
} {
  return {
    userActions: [...userActions],
    consoleErrors: [...consoleErrors],
    networkErrors: [...networkErrors],
    memory: getMemoryInfo(),
    pageStats: collectPageStats(),
    fps: currentFps,
  };
}

/**
 * 手动记录自定义快照
 * 用于在关键操作时记录状态
 */
export function recordCustomSnapshot(
  label: string,
  customData?: Record<string, unknown>
): void {
  const snapshot: CrashSnapshot = {
    id: `custom-${label}-${Date.now()}`,
    timestamp: Date.now(),
    type: 'periodic', // 使用 periodic 类型，便于统一处理
    memory: getMemoryInfo(),
    userAgent: navigator.userAgent,
    url: location.href,
    customData: {
      label,
      ...customData,
    },
  };

  sendSnapshotToSW(snapshot);
}

/**
 * 暴露调试工具到 window 对象
 * 这些工具只在用户主动调用时才执行，不会自动运行
 */
function exposeDebugTools(): void {
  if (typeof window === 'undefined') return;

  (window as any).__memoryLog = {
    // 获取当前内存快照（轻量级）
    getMemory: () => {
      const mem = getMemoryInfo();
      if (!mem) return null;
      return {
        usedMB: (mem.usedJSHeapSize / 1024 / 1024).toFixed(1),
        limitMB: (mem.jsHeapSizeLimit / 1024 / 1024).toFixed(0),
        percent: ((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100).toFixed(1),
      };
    },

    // 操作追踪（供代码调用）
    track: trackOperation,

    // 完整诊断（会触发 DOM 查询，仅手动调用）
    diagnose: () => {
      const mem = getMemoryInfo();
      const stats = collectPageStats();

      // 简化的建议
      if (stats.imageCount > 50) console.warn('图片较多，考虑懒加载');
      if (stats.domNodeCount > 5000) console.warn('DOM 节点较多');
      return { memory: mem, pageStats: stats };
    },

    // 手动记录快照到 SW
    snapshot: () => {
      const snapshot: CrashSnapshot = {
        id: `manual-${Date.now()}`,
        timestamp: Date.now(),
        type: 'periodic',
        memory: getMemoryInfo(),
        pageStats: collectPageStats(),
        userAgent: navigator.userAgent,
        url: location.href,
      };
      sendSnapshotToSW(snapshot);
    },

    // 获取诊断数据
    getDiagnostics: getDiagnosticData,

    // 查看用户操作轨迹
    getActions: () => {
      return userActions;
    },

    // 查看网络错误
    getNetworkErrors: () => {
      return networkErrors;
    },

    // 查看控制台错误
    getConsoleErrors: () => {
      return consoleErrors;
    },
  };
}

/**
 * 初始化崩溃日志系统
 * 在应用入口处调用
 */
export function initCrashLogger(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  // 1. 记录启动快照
  recordStartupSnapshot();

  // 2. 设置错误捕获
  setupErrorCapture();

  // 3. 开始定期快照
  startPeriodicSnapshots();

  // 4. 设置卡死/白屏监控
  setupHeartbeat();
  setupLongTaskMonitoring();
  setupFpsMonitoring();
  setupWhitescreenDetection();

  // 5. 设置用户操作和错误追踪
  setupUserActionTracking();
  setupNetworkErrorTracking();
  setupResourceErrorTracking();
  setupConsoleErrorTracking();

  // 6. 暴露调试工具
  exposeDebugTools();

  // 6. 检查并发送上次的 localStorage 快照（如果存在）
  const lastSnapshot = getLastSnapshotFromLocalStorage();
  if (lastSnapshot) {
    // 添加标记表示这是恢复的快照
    lastSnapshot.customData = {
      ...lastSnapshot.customData,
      recovered: true,
      recoveredAt: Date.now(),
    };
    sendSnapshotToSW(lastSnapshot);
    clearLastSnapshotFromLocalStorage();
  }
}

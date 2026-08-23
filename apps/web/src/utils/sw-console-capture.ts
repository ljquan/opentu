/**
 * Service Worker Console Log Capture
 *
 * 捕获控制台日志发送给 Service Worker 供调试面板显示。
 * - warn/error: 始终捕获（用于错误追踪）
 * - log/info: 仅在调试模式开启时捕获（用于调试分析）
 */

import { swChannelClient } from '@drawnix/drawnix/runtime';

let isInitialized = false;

// 调试模式：sessionStorage 关掉浏览器自动清除
const DEBUG_STORAGE_KEY = 'sw-debug-enabled';
function getDebugModeFromStorage(): boolean {
  try {
    return sessionStorage.getItem(DEBUG_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}
function setDebugModeToStorage(enabled: boolean | undefined): void {
  try {
    sessionStorage.setItem(
      DEBUG_STORAGE_KEY,
      enabled === true ? 'true' : 'false'
    );
  } catch {
    // 忽略
  }
}
let debugModeEnabled = getDebugModeFromStorage();

// 日志队列：channel 未就绪时暂存，就绪后批量发送
interface QueuedLog {
  level: string;
  message: string;
  stack?: string;
}
const logQueue: QueuedLog[] = [];
let initPromise: Promise<void> | null = null;
let nextInitRetryAt = 0;
const INIT_RETRY_COOLDOWN_MS = 15000;
const MAX_LOG_QUEUE_SIZE = 200;

// 保存原始的 console 方法
const originalConsole = {
  error: console.error,
  warn: console.warn,
  info: console.info,
  log: console.log,
  debug: console.debug,
};

function isExpectedFilePickerAbortMessage(message: string): boolean {
  return (
    (message.includes('AbortError') ||
      message.includes('The user aborted a request')) &&
    (message.includes("Failed to execute 'showOpenFilePicker'") ||
      message.includes("Failed to execute 'showSaveFilePicker'") ||
      message.includes('The user aborted a request'))
  );
}

/**
 * 发送日志到 Service Worker
 */
function sendToSW(level: string, message: string, stack?: string) {
  // 防止循环：不转发来自 SW 的日志
  if (
    message.includes('[SW]') ||
    message.includes('[SWTaskQueue]') ||
    message.includes('[SWChannelManager]') ||
    message.includes('[SWChannelClient]') ||
    message.includes('[ServiceWorkerChannel]') ||
    message.includes('Invalid message structure')
  ) {
    return;
  }

  // 过滤监控服务相关的错误（Umami）
  if (
    message.includes('umami.tu-zi.com') ||
    (stack && stack.includes('umami'))
  ) {
    return;
  }

  if (isExpectedFilePickerAbortMessage(message)) {
    return;
  }

  if (
    message.includes(
      'ResizeObserver loop completed with undelivered notifications'
    ) ||
    message.includes('ResizeObserver loop limit exceeded')
  ) {
    return;
  }

  // 发送单条日志
  const doSend = () => {
    if (!swChannelClient.isInitialized()) return;
    swChannelClient
      .reportConsoleLog(
        level,
        [{ message, stack: stack || '', source: window.location.href }],
        Date.now()
      )
      .catch(() => {
        // 忽略发送错误
      });
  };

  // 清空队列中的日志
  const flushQueue = () => {
    while (logQueue.length > 0 && swChannelClient.isInitialized()) {
      const item = logQueue.shift();
      if (!item) {
        continue;
      }
      swChannelClient
        .reportConsoleLog(
          item.level,
          [
            {
              message: item.message,
              stack: item.stack || '',
              source: window.location.href,
            },
          ],
          Date.now()
        )
        .catch(() => undefined);
    }
  };

  const ensureSWChannelReady = () => {
    const now = Date.now();
    if (initPromise || now < nextInitRetryAt) {
      return;
    }

    initPromise = swChannelClient
      .initialize()
      .then((success) => {
        if (!success) {
          nextInitRetryAt = Date.now() + INIT_RETRY_COOLDOWN_MS;
          return;
        }

        nextInitRetryAt = 0;
        flushQueue();
      })
      .catch(() => {
        nextInitRetryAt = Date.now() + INIT_RETRY_COOLDOWN_MS;
      })
      .finally(() => {
        initPromise = null;
      });
  };

  if (swChannelClient.isInitialized()) {
    doSend();
  } else {
    if (logQueue.length >= MAX_LOG_QUEUE_SIZE) {
      logQueue.shift();
    }
    logQueue.push({ level, message, stack });
    ensureSWChannelReady();
  }
}

/**
 * 格式化日志参数为字符串
 */
function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.message;
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
}

/**
 * 获取 Error 的堆栈信息
 */
function getStack(args: unknown[]): string {
  for (const arg of args) {
    if (arg instanceof Error && arg.stack) {
      return arg.stack;
    }
  }
  return '';
}

/**
 * 初始化控制台日志捕获
 * 只在有 Service Worker 的环境中生效
 */
export function initSWConsoleCapture(): void {
  if (isInitialized) {
    return;
  }

  if (!('serviceWorker' in navigator)) {
    return;
  }

  isInitialized = true;

  // 订阅调试状态变更事件 + 主动触发 channel 连接（否则早期日志会因 channel 未就绪而丢失）
  const setupDebugStatusListener = () => {
    if (swChannelClient.isInitialized()) {
      swChannelClient.subscribeToEvent('debug:statusChanged', (data) => {
        const event = data as { enabled?: boolean; debugModeEnabled?: boolean };
        const enabled = event.enabled ?? event.debugModeEnabled ?? false;
        debugModeEnabled = enabled;
        setDebugModeToStorage(enabled);
      });
      swChannelClient
        .getDebugStatus()
        .then((status: { enabled?: boolean; debugModeEnabled?: boolean }) => {
          const enabled = status.enabled ?? status.debugModeEnabled ?? false;
          debugModeEnabled = enabled;
          setDebugModeToStorage(enabled);
        });
    } else {
      const now = Date.now();
      if (!initPromise && now >= nextInitRetryAt) {
        initPromise = swChannelClient
          .initialize()
          .then((success) => {
            if (!success) {
              nextInitRetryAt = Date.now() + INIT_RETRY_COOLDOWN_MS;
              return;
            }

            nextInitRetryAt = 0;
            while (logQueue.length > 0 && swChannelClient.isInitialized()) {
              const item = logQueue.shift();
              if (!item) {
                continue;
              }
              swChannelClient
                .reportConsoleLog(
                  item.level,
                  [
                    {
                      message: item.message,
                      stack: item.stack || '',
                      source: window.location.href,
                    },
                  ],
                  Date.now()
                )
                .catch(() => undefined);
            }
          })
          .catch(() => {
            nextInitRetryAt = Date.now() + INIT_RETRY_COOLDOWN_MS;
          })
          .finally(() => {
            initPromise = null;
          });
      }
      setTimeout(setupDebugStatusListener, 500);
    }
  };

  setupDebugStatusListener();

  // 拦截 console.error（始终捕获）
  console.error = function (...args: unknown[]) {
    originalConsole.error.apply(console, args);
    sendToSW('error', formatArgs(args), getStack(args));
  };

  // 拦截 console.warn（始终捕获）
  console.warn = function (...args: unknown[]) {
    originalConsole.warn.apply(console, args);
    sendToSW('warn', formatArgs(args), getStack(args));
  };

  // 拦截 console.log（仅调试模式）
  console.log = function (...args: unknown[]) {
    originalConsole.log.apply(console, args);
    if (debugModeEnabled) {
      sendToSW('log', formatArgs(args), '');
    }
  };

  // 拦截 console.info（仅调试模式）
  console.info = function (...args: unknown[]) {
    originalConsole.info.apply(console, args);
    if (debugModeEnabled) {
      sendToSW('info', formatArgs(args), '');
    }
  };

  // 拦截 console.debug（仅调试模式）
  console.debug = function (...args: unknown[]) {
    originalConsole.debug.apply(console, args);
    if (debugModeEnabled) {
      sendToSW('debug', formatArgs(args), '');
    }
  };

  // 监听全局错误
  window.addEventListener('error', (event) => {
    const message = `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
    if (isExpectedFilePickerAbortMessage(message)) {
      return;
    }
    sendToSW('error', message, event.error?.stack || '');
  });

  // 监听未捕获的 Promise 错误
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : `Unhandled Promise: ${String(reason)}`;
    const stack = reason instanceof Error ? reason.stack || '' : '';
    if (isExpectedFilePickerAbortMessage(message)) {
      return;
    }
    sendToSW('error', message, stack);
  });

  // sessionStorage 不跨 tab 共享，storage 事件仅对 localStorage 有效，故不监听
}

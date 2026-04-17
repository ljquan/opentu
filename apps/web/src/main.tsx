import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './app/app';
import { ErrorBoundary } from './app/ErrorBoundary';
import { initCrashLogger } from './crash-logger';
import './utils/permissions-policy-fix';
import {
  initWebVitals,
  initPageReport,
  initPreventPinchZoom,
  runDatabaseCleanup,
  storageMigrationService,
  initPromptStorageCache,
  toolbarConfigService,
  memoryMonitorService,
  crashRecoveryService,
  swChannelClient,
  safeReload,
} from '@drawnix/drawnix';
import { sanitizeObject, sanitizeUrl } from '@aitu/utils';
import { initSWConsoleCapture } from './utils/sw-console-capture';

// ===== 控制台日志捕获（尽早初始化，确保默认 console 被改写） =====
// 必须在其他业务代码之前执行，否则后续工具（如 rrweb）可能先改写 console 导致捕获失效
if ('serviceWorker' in navigator) {
  initSWConsoleCapture();
}

// ===== 崩溃恢复检测 =====
// 必须最先执行，检测上次是否因内存不足等原因崩溃
crashRecoveryService.markLoadingStart();
crashRecoveryService.checkUrlSafeMode();

// ===== 初始化崩溃日志系统 =====
// 必须尽早初始化，以捕获启动阶段的内存状态和错误
initCrashLogger();

// ===== 初始化 Sentry 错误监控 =====
// 必须在其他代码之前初始化，以捕获所有错误

// 判断是否应该启用上报：
// - 本地开发环境（localhost/127.0.0.1）默认不上报，除非 URL 带 report=1 参数
// - 生产环境始终上报
const isLocalDev = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const forceReport = typeof window !== 'undefined' && 
  new URLSearchParams(window.location.search).get('report') === '1';
const shouldEnableReporting = forceReport || (!isLocalDev && import.meta.env.PROD);

Sentry.init({
  dsn: "https://a18e755345995baaa0e1972c4cf24497@o4510700882296832.ingest.us.sentry.io/4510700883869696",
  // 本地开发环境默认不启用，除非 URL 带 report=1 参数
  enabled: shouldEnableReporting,
  // 禁用自动 PII 收集，保护用户隐私
  sendDefaultPii: false,
  // 性能监控采样率（降低以减少数据量）
  tracesSampleRate: 0.1,
  // beforeSend 钩子：过滤敏感数据
  beforeSend(event) {
    // 过滤 extra 数据中的敏感信息
    if (event.extra) {
      event.extra = sanitizeObject(event.extra) as Record<string, unknown>;
    }
    
    // 过滤 contexts 中的敏感信息
    if (event.contexts) {
      event.contexts = sanitizeObject(event.contexts) as typeof event.contexts;
    }
    
    // 过滤 breadcrumbs 中的敏感信息
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map(breadcrumb => ({
        ...breadcrumb,
        data: breadcrumb.data ? sanitizeObject(breadcrumb.data) as Record<string, unknown> : undefined,
        message: breadcrumb.message ? String(sanitizeObject(breadcrumb.message)) : undefined,
      }));
    }
    
    // 过滤请求数据中的敏感信息
    if (event.request) {
      if (event.request.headers) {
        event.request.headers = sanitizeObject(event.request.headers) as Record<string, string>;
      }
      if (event.request.data) {
        event.request.data = sanitizeObject(event.request.data);
      }
      // 清理 URL 中可能的敏感参数
      if (event.request.url) {
        event.request.url = sanitizeUrl(event.request.url);
      }
    }
    
    return event;
  },
});

// ===== 立即初始化防止双指缩放 =====
// 必须在任何其他代码之前执行，确保事件监听器最先注册
if (typeof window !== 'undefined') {
  initPreventPinchZoom();
  // console.log('[Main] Pinch zoom prevention initialized immediately');

  // 清理旧的冗余数据库（异步执行，不阻塞启动）
  runDatabaseCleanup().catch(error => {
    console.warn('[Main] Database cleanup failed:', error);
  });

  // 执行 LocalStorage 到 IndexedDB 的数据迁移（异步执行，不阻塞启动）
  storageMigrationService.runMigration().then(() => {
    // 迁移完成后初始化各服务的缓存
    return Promise.all([
      initPromptStorageCache(),
      toolbarConfigService.initializeAsync(),
    ]);
  }).catch(error => {
    console.warn('[Main] Storage migration/init failed:', error);
  });
}

// 初始化性能监控
if (typeof window !== 'undefined') {
  // 启动内存监控（延迟启动，避免影响首屏加载）
  setTimeout(() => {
    memoryMonitorService.start();
    // 打印初始内存状态
    memoryMonitorService.logMemoryStatus();
  }, 5000);

  // 统计上报为旁路逻辑：在空闲时初始化，不占首屏主流程
  const initMonitoring = () => {
    if (window.posthog) {
      initWebVitals();
      initPageReport();
    } else {
      setTimeout(initMonitoring, 500);
    }
  };

  const scheduleMonitoring = () => {
    if (typeof (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback === 'function') {
      (window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(initMonitoring, { timeout: 3000 });
    } else {
      setTimeout(initMonitoring, 3000);
    }
  };
  scheduleMonitoring();
}

// 注册Service Worker来处理CORS问题和PWA功能
if ('serviceWorker' in navigator) {
  const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  // 新版本是否已准备好
  let newVersionReady = false;
  // 等待中的新 Worker
  let pendingWorker: ServiceWorker | null = null;
  // 用户是否已确认升级（只有用户确认后才触发刷新）
  let userConfirmedUpgrade = false;
  
  // Global reference to service worker registration
  let swRegistration: ServiceWorkerRegistration | null = null;

  // Register immediately for faster activation
  navigator.serviceWorker.register('/sw.js')
    .then(registration => {
      swRegistration = registration;

      // 在开发模式下，强制检查更新并处理等待中的Worker
      if (isDevelopment) {
        registration.update().catch(err => console.warn('Forced update check failed:', err));
        
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
      
      // 监听Service Worker更新
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              pendingWorker = newWorker;
              
              // 在开发模式下自动激活新的Service Worker
              if (isDevelopment) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              } else {
                // 生产模式：新版本已安装，通知 UI 显示升级提示
                newVersionReady = true;
                // 尝试获取新版本号，用于更新提示
                fetch(`/version.json?t=${Date.now()}`)
                  .then(res => res.ok ? res.json() : null)
                  .then(data => {
                    window.dispatchEvent(new CustomEvent('sw-update-available', { 
                      detail: { version: data?.version || 'new' } 
                    }));
                  })
                  .catch(() => {
                    window.dispatchEvent(new CustomEvent('sw-update-available', { 
                      detail: { version: 'new' } 
                    }));
                  });
              }
            }
          });
        }
      });
      
      // 定期检查更新（每 5 分钟检查一次）
      setInterval(() => {
        registration.update().catch(error => {
          console.warn('Update check failed:', error);
        });
      }, 5 * 60 * 1000);
      
    })
    .catch(error => {
      // console.log('Service Worker registration failed:', error);
    });
  
  // 设置 SW 事件处理器（通过 postmessage-duplex）
  const setupSWEventHandlers = () => {
    if (!swChannelClient.isInitialized()) {
      setTimeout(setupSWEventHandlers, 500);
      return;
    }
    
    swChannelClient.setEventHandlers({
      onSWUpdated: (event) => {
        // 只有用户主动确认升级后才刷新页面
        if (!userConfirmedUpgrade) {
          return;
        }
        // 等待一小段时间，确保新的Service Worker已经完全接管
        setTimeout(() => {
          safeReload();
        }, 1000);
      },
      onSWNewVersionReady: (event) => {
        newVersionReady = true;
        window.dispatchEvent(new CustomEvent('sw-update-available', { 
          detail: { version: event.version } 
        }));
      },
      onSWActivated: (event) => {
        // 新 SW 已自动激活并接管页面
        window.dispatchEvent(new CustomEvent('sw-update-available', { 
          detail: { version: event.version, autoActivated: true } 
        }));
      },
    });
  };
  
  // 延迟初始化 SW 事件处理器，等待 swChannelClient 就绪
  setTimeout(setupSWEventHandlers, 1000);
  
  // 注册视频缩略图生成处理器（使用 postmessage-duplex 双工通讯）
  // SW 通过 publish('thumbnail:generate', { url }) 请求，主线程处理并直接返回结果
  const setupVideoThumbnailHandler = async () => {
    // 等待 swChannelClient 初始化
    if (!swChannelClient.isInitialized()) {
      setTimeout(setupVideoThumbnailHandler, 500);
      return;
    }
    
    swChannelClient.registerVideoThumbnailHandler(async (url, maxSize) => {
      try {
        const { generateVideoThumbnailFromBlob } = await import('@aitu/utils');
        
        let videoBlob: Blob | null = null;
        
        // 1. 尝试从缓存获取视频 blob
        const cache = await caches.open('drawnix-images');
        const cachedResponse = await cache.match(url);
        if (cachedResponse) {
          videoBlob = await cachedResponse.blob();
        }
        
        // 2. 如果缓存中没有，尝试从网络获取（支持远程视频）
        if (!videoBlob && (url.startsWith('http://') || url.startsWith('https://'))) {
          try {
            const networkResponse = await fetch(url);
            if (networkResponse.ok) {
              videoBlob = await networkResponse.blob();
            }
          } catch {
            videoBlob = null;
          }
        }
        
        if (!videoBlob) {
          return { error: 'Video not found in cache or network' };
        }
        
        // 生成预览图
        const thumbnailBlob = await generateVideoThumbnailFromBlob(videoBlob, maxSize || 400);
        
        // 将 Blob 转换为 Data URL
        const thumbnailUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(thumbnailBlob);
        });
        
        return { thumbnailUrl };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    });
  };
  
  setupVideoThumbnailHandler();
  
  // 监听controller变化（新的Service Worker接管）
  // 只有用户主动确认升级后才刷新页面
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 只有用户主动确认升级后才刷新页面
    if (!userConfirmedUpgrade) {
      return;
    }

    // 延迟刷新，确保新Service Worker的缓存已准备好
    setTimeout(() => {
      safeReload();
    }, 1000);
  });
  
  // 监听用户确认升级事件
  window.addEventListener('user-confirmed-upgrade', () => {
    // 标记用户已确认升级，允许后续的 reload
    userConfirmedUpgrade = true;

    // 优先使用 pendingWorker
    if (pendingWorker) {
      pendingWorker.postMessage({ type: 'SKIP_WAITING' });
      return;
    }

    // 如果没有 pendingWorker，尝试查找 waiting 状态的 worker
    if (swRegistration && swRegistration.waiting) {
      swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }

    // 如果都没有 waiting worker，说明 SW 已经是最新的 active 状态
    // 这种情况通常发生在首次安装后，SW 直接 activate 了
    // 清除缓存并强制刷新

    // 清除旧的静态资源缓存以确保获取最新资源
    caches.keys().then(cacheNames => {
      const staticCaches = cacheNames.filter(name => name.startsWith('drawnix-static-v'));
      return Promise.all(staticCaches.map(name => caches.delete(name)));
    }).finally(() => {
      // 强制硬刷新（绕过缓存）
      window.location.href = window.location.href.split('?')[0] + '?_t=' + Date.now();
    });
  });
  
  // 页面卸载前，不再自动触发升级，必须用户手动确认
  // window.addEventListener('beforeunload', () => {
  //   if (newVersionReady && pendingWorker) {
  //     console.log('Main: Page unloading, triggering pending upgrade');
  //     pendingWorker.postMessage({ type: 'SKIP_WAITING' });
  //   }
  // });
  
  // 页面隐藏时，不再自动触发升级
  // document.addEventListener('visibilitychange', () => {
  //   if (document.visibilityState === 'hidden' && newVersionReady && pendingWorker) {
  //     console.log('Main: Page hidden, triggering pending upgrade');
  //     pendingWorker.postMessage({ type: 'SKIP_WAITING' });
  //   }
  // });
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

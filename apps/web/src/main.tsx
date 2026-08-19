import './utils/permissions-policy-fix';
import { tryRecoverDynamicImportError } from './utils/lazy-asset-recovery';

interface BootProgressOptions {
  title?: string;
  tip?: string;
  note?: string;
  source?: 'phase' | 'sw';
  progress?: number;
}

interface BootController {
  markReady: () => void;
  markError: (message?: string) => void;
  setProgress?: (progress?: number, options?: BootProgressOptions) => void;
}

function getBootController(): BootController | null {
  return (
    (window as Window & { __OPENTU_BOOT__?: BootController }).__OPENTU_BOOT__ ||
    null
  );
}

function updateBootStatus(options?: BootProgressOptions): void {
  getBootController()?.setProgress?.(options?.progress, options);
}

function setupLazyAssetRecoveryListeners(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const stopRecoveredEvent = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener(
    'vite:preloadError',
    (event) => {
      if (tryRecoverDynamicImportError(event)) {
        stopRecoveredEvent(event);
      }
    },
    true
  );

  window.addEventListener(
    'unhandledrejection',
    (event) => {
      if (tryRecoverDynamicImportError(event)) {
        stopRecoveredEvent(event);
      }
    },
    true
  );

  window.addEventListener(
    'error',
    (event) => {
      if (tryRecoverDynamicImportError(event)) {
        stopRecoveredEvent(event);
      }
    },
    true
  );
}

setupLazyAssetRecoveryListeners();

updateBootStatus({
  tip: '正在加载工作台...',
  source: 'phase',
  progress: 20,
});

import('./app/bootstrap').catch((error) => {
  if (tryRecoverDynamicImportError(error)) {
    return;
  }

  console.error('[Main] Failed to load app bootstrap:', error);
  getBootController()?.markError?.('工作台加载失败，请刷新后重试');
});

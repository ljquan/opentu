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

async function loadApplication(): Promise<void> {
  const startupParameters = new URLSearchParams(window.location.search);
  const bindingRequested = startupParameters.get('opentu_bind') === '1';
  let verifiedCredentialId: string | null = null;
  let verifiedUserId: number | null = null;

  try {
    // Dedicated leaf entrypoint avoids loading content storage before binding.
    // eslint-disable-next-line @nx/enforce-module-boundaries
    const { initializeOpenTuBindingBridge } = await import(
      '@drawnix/drawnix/opentu-binding'
    );
    const binding = await initializeOpenTuBindingBridge();
    if (bindingRequested && !binding.handled) {
      throw new Error('OpenTu binding mode was not handled');
    }
    if (binding.handled) {
      if (!binding.credentialId) {
        throw new Error('OpenTu binding did not return a credential identity');
      }
      verifiedCredentialId = binding.credentialId;
      verifiedUserId = binding.userId || null;
    }
  } catch (error) {
    console.warn('[Main] OpenTu device binding failed:', error);
    if (bindingRequested) throw error;
  }

  try {
    // Dedicated leaf entrypoint selects the namespace before content DBs open.
    // eslint-disable-next-line @nx/enforce-module-boundaries
    const { initializeStorageNamespaceForStartup } = await import(
      '@drawnix/drawnix/storage-bootstrap'
    );
    await initializeStorageNamespaceForStartup(
      verifiedCredentialId
        ? { handled: true, credentialId: verifiedCredentialId }
        : { handled: false }
    );
  } catch (error) {
    // A missing/corrupt vault must not expose another credential's content.
    // The storage context remains in its explicit anonymous default.
    console.warn('[Main] Credential storage namespace unavailable:', error);
    if (bindingRequested) throw error;
  }

  // Keep account UI mode explicit. A credential left in the local vault does
  // not turn a normal standalone launch into an embedded Tuzi session.
  // eslint-disable-next-line @nx/enforce-module-boundaries
  const accountRuntime = await import(
    '@drawnix/drawnix/opentu-account-runtime'
  );
  if (verifiedCredentialId && verifiedUserId) {
    accountRuntime.setOpenTuAccountRuntimeSession({
      mode: 'embedded',
      credentialId: verifiedCredentialId,
      userId: verifiedUserId,
      parentOrigin: startupParameters.get('opentu_parent_origin') || '',
      channel: startupParameters.get('opentu_channel') || '',
    });
  } else {
    accountRuntime.clearOpenTuAccountRuntimeSession();
  }

  await import('./app/bootstrap');
}

loadApplication().catch((error) => {
  if (tryRecoverDynamicImportError(error)) return;
  console.error('[Main] Failed to load app bootstrap:', error);
  getBootController()?.markError?.('工作台加载失败，请刷新后重试');
});

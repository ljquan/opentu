export {
  WorkspaceService,
  workspaceService,
} from './services/workspace-service';
export {
  migrateToWorkspace,
  isWorkspaceMigrationCompleted,
} from './services/workspace-migration';
export type { Board, BoardChangeData, TreeNode } from './types/workspace.types';
export { crashRecoveryService } from './services/crash-recovery-service';
export type {
  CrashRecoveryState,
  CrashInfo,
} from './services/crash-recovery-service';
export { safeReload } from './utils/active-tasks';
export { useDocumentTitle } from './hooks/useDocumentTitle';
export { markTabSyncVersion } from './hooks/useTabSync';

export { initWebVitals } from './services/web-vitals-service';
export { initPageReport } from './services/page-report-service';
export { initPreventPinchZoom } from './services/prevent-pinch-zoom-service';
export { runDatabaseCleanup } from './services/db-cleanup-service';
export { storageMigrationService } from './services/storage-migration-service';
export { initPromptStorageCache } from './services/prompt-storage-service';
export { toolbarConfigService } from './services/toolbar-config-service';
export { memoryMonitorService } from './services/memory-monitor-service';
export { swChannelClient } from './services/sw-channel/client';
export { unifiedLogService } from './services/unified-log-service';
export { MessagePlugin } from './utils/message-plugin';
export {
  hasTuziSystemToken,
  wasTuziCredentialsProvidedByUrl,
} from './services/tuzi-token-auth';
export { isTuziEmbeddedMode } from './services/tuzi-embedded-config';
export async function syncTuziSessionProvidersOnStartup(): Promise<boolean> {
  const { syncTuziSessionProviders } = await import(
    './services/tuzi-session-provider-sync'
  );
  return syncTuziSessionProviders();
}
export {
  requestServiceWorkerIdlePrefetch,
  type IdlePrefetchGroup,
} from './utils/startup-prefetch';

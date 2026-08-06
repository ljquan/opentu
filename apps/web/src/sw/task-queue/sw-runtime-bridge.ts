export interface SwRuntimeBridge {
  saveCrashSnapshot(snapshot: unknown): Promise<void> | void;
  addConsoleLog(entry: Record<string, unknown>): void;
  getDebugStatus(): Record<string, unknown>;
  getCacheStats(): Promise<unknown>;
  enableDebugMode(): Promise<void> | void;
  disableDebugMode(): Promise<void> | void;
  getDebugLogs(): unknown[];
  getInternalFetchLogs(): unknown[];
  clearDebugLogs(): void;
  loadConsoleLogsFromDB(): Promise<unknown[]>;
  clearConsoleLogs(): void;
  clearAllConsoleLogs(): Promise<void> | void;
  getCrashSnapshots(): Promise<unknown[]>;
  clearCrashSnapshots(): Promise<void> | void;
  getAppVersion(): string;
  getImageCacheName(): string;
  deleteCacheByUrl(url: string): Promise<void>;
  clearImageCache(): Promise<void>;
  requestVideoThumbnail(
    url: string,
    timeoutMs: number,
    maxSize: number
  ): Promise<string | null>;
}

let runtimeBridge: Partial<SwRuntimeBridge> = {};

export function setSwRuntimeBridge(bridge: Partial<SwRuntimeBridge>): void {
  runtimeBridge = {
    ...runtimeBridge,
    ...bridge,
  };
}

export function getSwRuntimeBridge(): Partial<SwRuntimeBridge> {
  return runtimeBridge;
}

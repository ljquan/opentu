let mediaCacheEpoch = 0;
let mediaCacheWritesPaused = false;
let activeMediaCacheOperations = 0;
const mediaCacheDrainWaiters = new Set<() => void>();

export function getMediaCacheEpoch(): number {
  return mediaCacheEpoch;
}

export function advanceMediaCacheEpoch(): number {
  mediaCacheEpoch += 1;
  return mediaCacheEpoch;
}

export function isMediaCacheEpochCurrent(expectedEpoch: number): boolean {
  return !mediaCacheWritesPaused && expectedEpoch === mediaCacheEpoch;
}

export function pauseMediaCacheWrites(): void {
  mediaCacheWritesPaused = true;
  advanceMediaCacheEpoch();
}

export function resumeMediaCacheWrites(): void {
  mediaCacheWritesPaused = false;
}

export function beginMediaCacheOperation(
  expectedEpoch: number
): (() => void) | null {
  if (!isMediaCacheEpochCurrent(expectedEpoch)) {
    return null;
  }

  activeMediaCacheOperations += 1;
  let finished = false;
  return () => {
    if (finished) {
      return;
    }
    finished = true;
    activeMediaCacheOperations = Math.max(0, activeMediaCacheOperations - 1);
    if (activeMediaCacheOperations === 0) {
      for (const resolve of mediaCacheDrainWaiters) {
        resolve();
      }
      mediaCacheDrainWaiters.clear();
    }
  };
}

export function waitForMediaCacheOperations(): Promise<void> {
  if (activeMediaCacheOperations === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    mediaCacheDrainWaiters.add(resolve);
  });
}

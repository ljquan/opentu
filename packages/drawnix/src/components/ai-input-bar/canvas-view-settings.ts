import { LS_KEYS } from '../../constants/storage-keys';

export const CANVAS_VIEW_SETTINGS_CHANGE_EVENT =
  'aitu:canvas-view-settings-change';

let sessionEnabled: boolean | undefined;

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCenterImageOnClickEnabled(
  storage?: Pick<Storage, 'getItem'> | null
): boolean {
  if (storage === undefined) {
    if (sessionEnabled !== undefined) return sessionEnabled;
    storage = getBrowserStorage();
  }
  if (!storage) return true;
  try {
    return (
      storage.getItem(LS_KEYS.AI_CENTER_IMAGE_ON_CLICK_ENABLED) !== 'false'
    );
  } catch {
    return true;
  }
}

export function persistCenterImageOnClickEnabled(enabled: boolean): boolean {
  sessionEnabled = enabled;
  const storage = getBrowserStorage();
  try {
    storage?.setItem(LS_KEYS.AI_CENTER_IMAGE_ON_CLICK_ENABLED, String(enabled));
  } catch {
    // Retain the session setting even when localStorage rejects writes.
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(CANVAS_VIEW_SETTINGS_CHANGE_EVENT));
    } catch {
      // Keep the current page state when CustomEvent is unavailable.
    }
  }
  return enabled;
}

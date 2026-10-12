import { LS_KEYS } from '../constants/storage-keys';

export const REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT =
  'aitu:reference-image-settings-change';

let sessionEnabled: boolean | undefined;

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readKeepOriginalImageEnabled(
  storage?: Pick<Storage, 'getItem'> | null
): boolean {
  if (storage === undefined) {
    if (sessionEnabled !== undefined) return sessionEnabled;
    storage = browserStorage();
  }
  try {
    return storage?.getItem(LS_KEYS.AI_KEEP_ORIGINAL_IMAGE_ENABLED) === 'true';
  } catch {
    return false;
  }
}

export function persistKeepOriginalImageEnabled(enabled: boolean): boolean {
  sessionEnabled = enabled;
  try {
    browserStorage()?.setItem(
      LS_KEYS.AI_KEEP_ORIGINAL_IMAGE_ENABLED,
      String(enabled)
    );
  } catch {
    // Retain the user's choice for this session if storage is unavailable.
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent(REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT)
      );
    } catch {
      // Keep the current page state when CustomEvent is unavailable.
    }
  }
  return enabled;
}

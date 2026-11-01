import { LS_KEYS } from '../constants/storage-keys';

export const REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT =
  'aitu:reference-image-settings-change';

let sessionEnabled: boolean | undefined;
let sessionAutoInsertEnabled: boolean | undefined;

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
  notifySettingsChange();
  return enabled;
}

export function readAutoInsertReferenceImagesEnabled(
  storage?: Pick<Storage, 'getItem'> | null
): boolean {
  if (storage === undefined) {
    if (sessionAutoInsertEnabled !== undefined) return sessionAutoInsertEnabled;
    storage = browserStorage();
  }
  try {
    return storage?.getItem(LS_KEYS.AI_REFERENCE_IMAGE_AUTO_INSERT) !== 'false';
  } catch {
    return true;
  }
}

export function persistAutoInsertReferenceImagesEnabled(
  enabled: boolean
): boolean {
  sessionAutoInsertEnabled = enabled;
  try {
    browserStorage()?.setItem(
      LS_KEYS.AI_REFERENCE_IMAGE_AUTO_INSERT,
      String(enabled)
    );
  } catch {
    // Retain the user's choice for this session if storage is unavailable.
  }
  notifySettingsChange();
  return enabled;
}

function notifySettingsChange(): void {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent(REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT)
      );
    } catch {
      // Keep the current page state when CustomEvent is unavailable.
    }
  }
}

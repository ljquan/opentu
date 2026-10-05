import { LS_KEYS } from '../../../constants/storage-keys';

let sessionEnabled: boolean | undefined;

export function readImageDetailsOnClickEnabled(): boolean {
  if (sessionEnabled !== undefined) return sessionEnabled;
  try {
    return (
      window.localStorage.getItem(LS_KEYS.AI_IMAGE_DETAILS_ON_CLICK_ENABLED) !==
      'false'
    );
  } catch {
    return true;
  }
}

export function persistImageDetailsOnClickEnabled(enabled: boolean): void {
  sessionEnabled = enabled;
  try {
    window.localStorage.setItem(
      LS_KEYS.AI_IMAGE_DETAILS_ON_CLICK_ENABLED,
      String(enabled)
    );
  } catch {
    // Keep the preference for this session when storage is unavailable.
  }
}

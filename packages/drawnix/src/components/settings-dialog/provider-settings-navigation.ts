export const SETTINGS_PROVIDER_NAV_EVENT = 'aitu:settings:provider-nav';
export const TUZI_GROUPS_ADDED_EVENT = 'opentu:tuzi-groups-added';

export type ProviderNavigationIntent =
  | { action: 'select'; profileId: string }
  | { action: 'create' }
  | { action: 'tuzi-groups'; returnTo?: string };

export function queueProviderSettingsNavigation(
  intent: ProviderNavigationIntent
): void {
  if (typeof window === 'undefined') {
    return;
  }

  (
    window as typeof window & {
      __aituPendingProviderNavigationIntent?: ProviderNavigationIntent;
    }
  ).__aituPendingProviderNavigationIntent = intent;
  window.dispatchEvent(
    new CustomEvent<ProviderNavigationIntent>(SETTINGS_PROVIDER_NAV_EVENT, {
      detail: intent,
    })
  );
}

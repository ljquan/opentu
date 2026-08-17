let clearManagedProfiles: (() => void) | null = null;

/** Register the settings runtime without making namespace switching import it. */
export function registerManagedProviderProfileClearer(
  clearer: () => void
): void {
  clearManagedProfiles = clearer;
}

/** Clear credentials synchronously before an account namespace can change. */
export function clearManagedProviderProfileOverlay(): void {
  clearManagedProfiles?.();
}

import { OpenTuCredentialVault } from './opentu-credential/credential-vault';
import {
  activateStorageNamespace,
  createStorageNamespace,
  type StorageNamespace,
} from './storage-context';

interface CredentialIdentitySource {
  load(): Promise<{ credentialId: string } | null>;
}

interface BindingStartupResult {
  handled: boolean;
  credentialId?: string;
}

/** Resolve only the non-secret credential identity before content DBs open. */
export async function initializeStorageNamespaceFromVault(
  vault: CredentialIdentitySource = new OpenTuCredentialVault()
): Promise<StorageNamespace> {
  const credential = await vault.load();
  const namespace = createStorageNamespace(credential?.credentialId ?? null);
  activateStorageNamespace(namespace);
  return namespace;
}

/** Select a verified binding identity without consulting a stale vault pointer. */
export async function initializeStorageNamespaceForStartup(
  binding: BindingStartupResult,
  vault: CredentialIdentitySource = new OpenTuCredentialVault()
): Promise<StorageNamespace> {
  if (!binding.handled) {
    return initializeStorageNamespaceFromVault(vault);
  }
  if (!binding.credentialId?.trim()) {
    throw new Error('Verified OpenTu binding credential ID is required');
  }

  const namespace = createStorageNamespace(binding.credentialId);
  activateStorageNamespace(namespace);
  return namespace;
}

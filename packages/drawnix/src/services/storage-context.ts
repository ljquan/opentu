export const ANONYMOUS_STORAGE_NAMESPACE = 'anonymous' as const;

export type StorageNamespace =
  | { kind: 'anonymous'; key: typeof ANONYMOUS_STORAGE_NAMESPACE }
  | { kind: 'credential'; credentialId: string; key: string };

const MAX_CREDENTIAL_ID_LENGTH = 256;
let activeNamespace: StorageNamespace = {
  kind: 'anonymous',
  key: ANONYMOUS_STORAGE_NAMESPACE,
};

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function createStorageNamespace(
  credentialId?: string | null
): StorageNamespace {
  if (credentialId == null) {
    return { kind: 'anonymous', key: ANONYMOUS_STORAGE_NAMESPACE };
  }

  const normalized = credentialId.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_CREDENTIAL_ID_LENGTH ||
    hasControlCharacter(normalized)
  ) {
    throw new Error('Invalid credential ID for storage namespace');
  }

  return {
    kind: 'credential',
    credentialId: normalized,
    key: `credential-${encodeBase64Url(normalized)}`,
  };
}

export function getActiveStorageNamespace(): StorageNamespace {
  return activeNamespace;
}

export function getNamespacedDatabaseName(
  baseName: string,
  namespace = activeNamespace
): string {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(baseName)) {
    throw new Error('Invalid storage database base name');
  }
  return `${baseName}--${namespace.key}`;
}

/**
 * Low-level activation primitive. Callers must close old handles first; normal
 * account/session code should use switchStorageNamespace instead.
 */
export function activateStorageNamespace(namespace: StorageNamespace): void {
  activeNamespace = namespace;
}

export function generateUUID(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const timestamp = Date.now().toString(16).padStart(12, '0');
  const random = Math.random().toString(16).slice(2).padEnd(20, '0');
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8, 12)}-4${random.slice(0, 3)}-8${random.slice(3, 6)}-${random.slice(6, 18)}`;
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    if (canUseClipboardWrite() && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Permission policy or browser restrictions can block Clipboard API; fallback below.
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard copy failed');
    }
  } finally {
    textArea.remove();
  }
}

function canUseClipboardWrite(): boolean {
  const policyDocument = document as Document & {
    permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
    featurePolicy?: { allowsFeature?: (feature: string) => boolean };
  };
  const policy = policyDocument.permissionsPolicy || policyDocument.featurePolicy;

  try {
    return policy?.allowsFeature?.('clipboard-write') !== false;
  } catch {
    return true;
  }
}

function canUseFullscreen(): boolean {
  if (document.fullscreenEnabled === false) {
    return false;
  }

  const policyDocument = document as Document & {
    permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
    featurePolicy?: { allowsFeature?: (feature: string) => boolean };
  };
  const policy = policyDocument.permissionsPolicy || policyDocument.featurePolicy;

  try {
    return policy?.allowsFeature?.('fullscreen') !== false;
  } catch {
    return true;
  }
}

export function requestFullscreenIfAllowed(
  element: Element | null | undefined
): Promise<void> | undefined {
  if (!element || !canUseFullscreen()) {
    return undefined;
  }

  try {
    return element.requestFullscreen?.();
  } catch {
    return undefined;
  }
}

export function exitFullscreenIfActive(): Promise<void> | undefined {
  if (!document.fullscreenElement) {
    return undefined;
  }

  try {
    return document.exitFullscreen?.();
  } catch {
    return undefined;
  }
}

export async function readFromClipboard(): Promise<string> {
  if (navigator.clipboard && navigator.clipboard.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message
          ? error.message
          : 'Clipboard read failed'
      );
    }
  }
  throw new Error('Clipboard API not supported');
}

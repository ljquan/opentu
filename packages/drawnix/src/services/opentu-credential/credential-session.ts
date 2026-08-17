import type {
  OpenTuAccessToken,
  OpenTuRefreshHandler,
  OpenTuRefreshResult,
} from './types';
import { OpenTuCredentialVault } from './credential-vault';

interface CachedNonce {
  value: string;
  expiresAt: number;
}

export class OpenTuCredentialSession {
  private accessToken: OpenTuAccessToken | null = null;
  private readonly nonces = new Map<string, CachedNonce>();
  private refreshPromise: Promise<OpenTuRefreshResult> | null = null;

  constructor(private readonly vault: OpenTuCredentialVault) {}

  setAccessToken(token: string, expiresAt: number): void {
    if (!token || !Number.isFinite(expiresAt)) {
      throw new Error('A token and finite expiry are required');
    }
    this.accessToken = { token, expiresAt };
  }

  getAccessToken(now = Date.now(), minimumValidityMs = 0): string | null {
    if (
      !this.accessToken ||
      this.accessToken.expiresAt <= now + Math.max(0, minimumValidityMs)
    ) {
      return null;
    }
    return this.accessToken.token;
  }

  setNonce(context: string, nonce: string, expiresAt: number): void {
    if (!context || !nonce || !Number.isFinite(expiresAt)) {
      throw new Error('Nonce context, value, and finite expiry are required');
    }
    this.nonces.set(context, { value: nonce, expiresAt });
  }

  consumeNonce(context: string, now = Date.now()): string | null {
    const cached = this.nonces.get(context);
    this.nonces.delete(context);
    if (!cached || cached.expiresAt <= now) return null;
    return cached.value;
  }

  clearMemory(): void {
    this.accessToken = null;
    this.nonces.clear();
  }

  refresh(handler: OpenTuRefreshHandler): Promise<OpenTuRefreshResult> {
    if (this.refreshPromise) return this.refreshPromise;

    this.accessToken = null;
    const operation = this.performRefresh(handler);
    this.refreshPromise = operation;
    const clearRefresh = () => {
      if (this.refreshPromise === operation) {
        this.refreshPromise = null;
      }
    };
    void operation.then(clearRefresh, clearRefresh);
    return operation;
  }

  private async performRefresh(
    handler: OpenTuRefreshHandler
  ): Promise<OpenTuRefreshResult> {
    const current = await this.vault.load();
    if (!current) {
      throw new Error('No bound OpenTu credential is available');
    }

    const result = await handler(current);
    if (
      !result.accessToken ||
      !result.refreshToken ||
      !Number.isFinite(result.accessTokenExpiresAt)
    ) {
      throw new Error('Refresh returned an invalid credential result');
    }

    await this.vault.save({
      credentialId: result.credentialId || current.credentialId,
      userId: current.userId,
      deviceId: result.deviceId || current.deviceId,
      refreshToken: result.refreshToken,
      publicJwk: current.publicJwk,
      privateKey: current.privateKey,
    });
    this.setAccessToken(result.accessToken, result.accessTokenExpiresAt);
    return result;
  }
}

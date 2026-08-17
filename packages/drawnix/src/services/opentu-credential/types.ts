export interface P256PublicJwk extends JsonWebKey {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface StoredOpenTuCredential {
  credentialId: string;
  userId?: number;
  deviceId?: string;
  refreshToken: string;
  publicJwk: P256PublicJwk;
  jkt: string;
  privateKey: CryptoKey;
  updatedAt: number;
}

export interface OpenTuCredentialInput {
  credentialId: string;
  userId?: number;
  deviceId?: string;
  refreshToken: string;
  publicJwk: JsonWebKey;
  privateKey: CryptoKey;
}

export interface DpopProofInput {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
  method: string;
  url: string | URL;
  accessToken?: string;
  nonce?: string;
  issuedAt?: number;
  jti?: string;
}

export interface OpenTuAccessToken {
  token: string;
  expiresAt: number;
}

export interface OpenTuRefreshResult {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  credentialId?: string;
  deviceId?: string;
}

export type OpenTuRefreshHandler = (
  credential: StoredOpenTuCredential
) => Promise<OpenTuRefreshResult>;

export type CredentialVaultProbeResult =
  | { supported: true }
  | { supported: false; reason: string };

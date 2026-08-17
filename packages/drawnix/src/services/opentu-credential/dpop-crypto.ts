import type { DpopProofInput, P256PublicJwk } from './types';

const textEncoder = new TextEncoder();
const UNRESERVED_PERCENT_ENCODING = /%([0-9a-fA-F]{2})/g;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeJson(value: unknown): string {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)));
}

function normalizePercentEncoding(pathname: string): string {
  return pathname.replace(
    UNRESERVED_PERCENT_ENCODING,
    (_encoded, hex: string) => {
      const code = Number.parseInt(hex, 16);
      const character = String.fromCharCode(code);
      return /[A-Za-z0-9\-._~]/.test(character)
        ? character
        : `%${hex.toUpperCase()}`;
    }
  );
}

export function normalizeP256PublicJwk(jwk: JsonWebKey): P256PublicJwk {
  if (
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    jwk.x.length === 0 ||
    typeof jwk.y !== 'string' ||
    jwk.y.length === 0 ||
    typeof jwk.d === 'string'
  ) {
    throw new Error('Expected a public P-256 JWK');
  }

  return {
    kty: 'EC',
    crv: 'P-256',
    x: jwk.x,
    y: jwk.y,
  };
}

export async function calculateJwkThumbprint(
  jwk: JsonWebKey,
  subtle: SubtleCrypto = crypto.subtle
): Promise<string> {
  const publicJwk = normalizeP256PublicJwk(jwk);
  const canonical = JSON.stringify({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y,
  });
  const digest = await subtle.digest('SHA-256', textEncoder.encode(canonical));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function normalizeDpopHtu(input: string | URL): string {
  const url = input instanceof URL ? new URL(input.href) : new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('DPoP htu must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('DPoP htu must not contain user information');
  }

  const pathname = normalizePercentEncoding(url.pathname || '/');
  return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${pathname}`;
}

function createJti(cryptoProvider: Crypto): string {
  if (typeof cryptoProvider.randomUUID === 'function') {
    return cryptoProvider.randomUUID();
  }

  const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export async function createDpopProof(
  input: DpopProofInput,
  cryptoProvider: Crypto = crypto
): Promise<string> {
  if (input.privateKey.type !== 'private' || input.privateKey.extractable) {
    throw new Error('DPoP signing requires a non-exportable private key');
  }
  const algorithm = input.privateKey.algorithm as EcKeyAlgorithm;
  if (
    algorithm.name !== 'ECDSA' ||
    algorithm.namedCurve !== 'P-256' ||
    !input.privateKey.usages.includes('sign')
  ) {
    throw new Error('DPoP signing requires a P-256 ECDSA signing key');
  }

  const method = input.method.trim().toUpperCase();
  if (!method) {
    throw new Error('DPoP request method is required');
  }

  const publicJwk = normalizeP256PublicJwk(input.publicJwk);
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk };
  const payload: Record<string, string | number> = {
    jti: input.jti || createJti(cryptoProvider),
    htm: method,
    htu: normalizeDpopHtu(input.url),
    iat: input.issuedAt ?? Math.floor(Date.now() / 1000),
  };

  if (input.accessToken) {
    const digest = await cryptoProvider.subtle.digest(
      'SHA-256',
      textEncoder.encode(input.accessToken)
    );
    payload.ath = bytesToBase64Url(new Uint8Array(digest));
  }
  if (input.nonce) {
    payload.nonce = input.nonce;
  }

  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = await cryptoProvider.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    input.privateKey,
    textEncoder.encode(signingInput)
  );
  const signatureBytes = new Uint8Array(signature);
  if (signatureBytes.byteLength !== 64) {
    throw new Error('WebCrypto returned an invalid ES256 signature');
  }

  return `${signingInput}.${bytesToBase64Url(signatureBytes)}`;
}

export async function generateCredentialKeyMaterial(
  cryptoProvider: Crypto = crypto
): Promise<{
  privateKey: CryptoKey;
  publicJwk: P256PublicJwk;
  jkt: string;
}> {
  const keyPair = (await cryptoProvider.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  if (keyPair.privateKey.extractable) {
    throw new Error('Browser generated an exportable private key');
  }

  const publicJwk = normalizeP256PublicJwk(
    await cryptoProvider.subtle.exportKey('jwk', keyPair.publicKey)
  );
  const jkt = await calculateJwkThumbprint(publicJwk, cryptoProvider.subtle);
  return { privateKey: keyPair.privateKey, publicJwk, jkt };
}

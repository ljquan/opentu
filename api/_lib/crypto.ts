import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function encryptionKey(): Buffer {
  const raw = process.env.OPENTU_PROVIDER_ENCRYPTION_KEY || '';
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'OPENTU_PROVIDER_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex value'
    );
  }
  return key;
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext]
    .map((part) => part.toString('base64url'))
    .join('.');
}

export function decryptSecret(payload: string): string {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = payload.split('.');
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error('Invalid encrypted provider secret');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivEncoded, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

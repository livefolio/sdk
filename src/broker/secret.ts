import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 'v1';

function deriveKey(key: string): Buffer {
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      `Encryption key must be 32 bytes (got ${buf.length})`,
    );
  }
  return buf;
}

export function encryptSecret(plaintext: string, key: string): string {
  const keyBuf = deriveKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuf, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptSecret(ciphertext: string, key: string): string {
  const keyBuf = deriveKey(key);
  const parts = ciphertext.split(':');

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed ciphertext payload');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const encrypted = Buffer.from(parts[3], 'base64');

  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error('Malformed ciphertext payload');
  }

  const decipher = createDecipheriv(ALGORITHM, keyBuf, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8',
  );
}

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 'v1';

function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error(`secretEncryptionKey must be 32 bytes (got ${key.length})`);
  }
  return key;
}

export function encryptUserSecret(plaintext: string, base64Key: string): string {
  const key = parseKey(base64Key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptUserSecret(ciphertext: string, base64Key: string): string {
  const key = parseKey(base64Key);
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

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

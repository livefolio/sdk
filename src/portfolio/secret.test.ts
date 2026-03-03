import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { encryptUserSecret, decryptUserSecret } from './secret';

// Generate a valid 32-byte AES key for testing
const TEST_KEY = randomBytes(32).toString('base64');

describe('encryptUserSecret / decryptUserSecret', () => {
  it('round-trips a plaintext string', () => {
    const plaintext = 'my-super-secret-snaptrade-token';
    const ciphertext = encryptUserSecret(plaintext, TEST_KEY);
    const decrypted = decryptUserSecret(ciphertext, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it('produces v1 format ciphertext', () => {
    const ciphertext = encryptUserSecret('test', TEST_KEY);
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const a = encryptUserSecret('same', TEST_KEY);
    const b = encryptUserSecret('same', TEST_KEY);
    expect(a).not.toBe(b);
    // But both decrypt to the same value
    expect(decryptUserSecret(a, TEST_KEY)).toBe('same');
    expect(decryptUserSecret(b, TEST_KEY)).toBe('same');
  });

  it('throws on malformed ciphertext', () => {
    expect(() => decryptUserSecret('bad-data', TEST_KEY)).toThrow('Malformed ciphertext payload');
    expect(() => decryptUserSecret('v2:a:b:c', TEST_KEY)).toThrow('Malformed ciphertext payload');
  });

  it('throws on wrong key', () => {
    const otherKey = randomBytes(32).toString('base64');
    const ciphertext = encryptUserSecret('secret', TEST_KEY);
    expect(() => decryptUserSecret(ciphertext, otherKey)).toThrow();
  });

  it('throws on invalid key length', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => encryptUserSecret('test', shortKey)).toThrow('secretEncryptionKey must be 32 bytes');
  });
});

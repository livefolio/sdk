import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret } from './secret';

const TEST_KEY = randomBytes(32).toString('base64');

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a plaintext string', () => {
    const plaintext = 'my-super-secret-user-secret-12345';
    const ciphertext = encryptSecret(plaintext, TEST_KEY);
    expect(ciphertext).not.toBe(plaintext);
    expect(decryptSecret(ciphertext, TEST_KEY)).toBe(plaintext);
  });

  it('handles empty string', () => {
    const ciphertext = encryptSecret('', TEST_KEY);
    expect(decryptSecret(ciphertext, TEST_KEY)).toBe('');
  });

  it('handles unicode content', () => {
    const plaintext = 'secret-with-emoji-\u{1F511}-and-kanji-\u{79D8}\u{5BC6}';
    const ciphertext = encryptSecret(plaintext, TEST_KEY);
    expect(decryptSecret(ciphertext, TEST_KEY)).toBe(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'same-input';
    const a = encryptSecret(plaintext, TEST_KEY);
    const b = encryptSecret(plaintext, TEST_KEY);
    expect(a).not.toBe(b);
    // Both should still decrypt to the same value
    expect(decryptSecret(a, TEST_KEY)).toBe(plaintext);
    expect(decryptSecret(b, TEST_KEY)).toBe(plaintext);
  });

  it('different keys produce different ciphertexts', () => {
    const key2 = randomBytes(32).toString('base64');
    const plaintext = 'test-value';
    const a = encryptSecret(plaintext, TEST_KEY);
    const b = encryptSecret(plaintext, key2);
    // Ciphertexts differ
    expect(a).not.toBe(b);
  });

  it('throws on malformed payload (wrong format)', () => {
    expect(() => decryptSecret('garbage', TEST_KEY)).toThrow(
      'Malformed ciphertext payload',
    );
  });

  it('throws on malformed payload (wrong version)', () => {
    expect(() => decryptSecret('v2:aaa:bbb:ccc', TEST_KEY)).toThrow(
      'Malformed ciphertext payload',
    );
  });

  it('throws on malformed payload (invalid IV length)', () => {
    // Correct version but IV is wrong length
    const badIv = Buffer.from('short').toString('base64');
    const tag = randomBytes(16).toString('base64');
    const data = randomBytes(10).toString('base64');
    expect(() => decryptSecret(`v1:${badIv}:${tag}:${data}`, TEST_KEY)).toThrow(
      'Malformed ciphertext payload',
    );
  });

  it('throws on malformed payload (invalid tag length)', () => {
    const iv = randomBytes(12).toString('base64');
    const badTag = Buffer.from('short').toString('base64');
    const data = randomBytes(10).toString('base64');
    expect(() =>
      decryptSecret(`v1:${iv}:${badTag}:${data}`, TEST_KEY),
    ).toThrow('Malformed ciphertext payload');
  });

  it('detects tampering (wrong key)', () => {
    const ciphertext = encryptSecret('test', TEST_KEY);
    const wrongKey = randomBytes(32).toString('base64');
    expect(() => decryptSecret(ciphertext, wrongKey)).toThrow();
  });

  it('detects tampering (modified ciphertext data)', () => {
    const ciphertext = encryptSecret('test', TEST_KEY);
    const parts = ciphertext.split(':');
    // Flip a byte in the encrypted data
    const buf = Buffer.from(parts[3], 'base64');
    buf[0] ^= 0xff;
    parts[3] = buf.toString('base64');
    expect(() => decryptSecret(parts.join(':'), TEST_KEY)).toThrow();
  });

  it('throws on key that is too short', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => encryptSecret('test', shortKey)).toThrow('must be 32 bytes');
  });

  it('throws on key that is too long', () => {
    const longKey = randomBytes(48).toString('base64');
    expect(() => encryptSecret('test', longKey)).toThrow('must be 32 bytes');
  });

  it('throws on decrypt with wrong-length key', () => {
    const ciphertext = encryptSecret('test', TEST_KEY);
    const shortKey = randomBytes(16).toString('base64');
    expect(() => decryptSecret(ciphertext, shortKey)).toThrow(
      'must be 32 bytes',
    );
  });
});

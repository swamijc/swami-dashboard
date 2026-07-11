import { describe, expect, it, beforeEach } from 'vitest';
import { decrypt, encrypt } from '../src/crypto/encrypt';

describe('secret encryption', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
  });

  it('round-trips encrypted values without returning plaintext', () => {
    const plaintext = 'session-cookie-value';
    const ciphertext = encrypt(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).toContain(':');
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('returns empty strings for empty inputs', () => {
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });

  it('rejects invalid encryption key lengths', () => {
    process.env.ENCRYPTION_KEY = 'short-key';
    expect(() => encrypt('secret')).toThrow('ENCRYPTION_KEY must be exactly 32 characters');
  });
});
import crypto from 'crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const TAG_LENGTH = 16;

// Derive 32-byte key from JWT_SECRET or dedicated key
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || env.JWT_SECRET;
  return crypto.scryptSync(secret, 'zyper_credential_salt', 32);
}

/**
 * Encrypts plain text using AES-256-GCM authenticated encryption.
 * Output format: base64(iv + tag + ciphertext)
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypts AES-256-GCM encrypted payload.
 */
export function decrypt(encryptedBase64: string): string {
  const combined = Buffer.from(encryptedBase64, 'base64');

  if (combined.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted payload: insufficient length');
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

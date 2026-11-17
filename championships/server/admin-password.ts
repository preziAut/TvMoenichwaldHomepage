import { timingSafeEqual } from 'node:crypto';

// Generated passwords have 192 random bits. Keep PBKDF2 within the Workers Web Crypto limit.
export async function adminPasswordHash(password: string, salt: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = Uint8Array.from(salt.match(/../g)!, pair => Number.parseInt(pair, 16));
  const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes, iterations: 100000 }, key, 256);
  return new Uint8Array(result);
}

export async function validateAdminPassword(password: string, record?: { salt: string; password_hash: string }) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(password)) return false;
  const derived = await adminPasswordHash(password, record?.salt ?? '0'.repeat(32));
  const expected = Uint8Array.from((record?.password_hash ?? '0'.repeat(64)).match(/../g)!, pair => Number.parseInt(pair, 16));
  const matches = timingSafeEqual(derived, expected);
  return Boolean(record && matches);
}

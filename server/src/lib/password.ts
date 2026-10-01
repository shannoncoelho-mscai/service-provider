import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';

/**
 * Password hashing — scrypt (Node.js built-in, memory-hard KDF).
 *
 * WHY: passwords are NEVER stored or compared as plaintext (docs/SECURITY.md).
 * scrypt avoids native build dependencies (bcrypt) while staying a recognized,
 * tunable password KDF. The same module will verify logins in the auth step.
 *
 * Stored format:  scrypt$N$r$p$<salt base64>$<hash base64>
 * Never log or expose password_hash columns.
 */

// Parameters (RFC 7914). N=16384, r=8 ≈ 16 MiB per hash.
const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAXMEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N, r: R, p: P, maxmem: MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const salt = randomBytes(16);
  const key = await derive(plain, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  // Re-derive with the stored parameters so old hashes keep verifying.
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      plain.normalize('NFKC'),
      salt,
      expected.length,
      { N: Number(nStr), r: Number(rStr), p: Number(pStr), maxmem: MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

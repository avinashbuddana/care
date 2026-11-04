import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
function derive(password: string, salt: string, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, length, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    }),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [algorithm, salt, key] = hash.split(':');
  if (algorithm !== 'scrypt' || !salt || !key) return false;
  const actual = await derive(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

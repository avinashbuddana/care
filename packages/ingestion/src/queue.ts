/** Shared by API (producer) and worker (consumer) so both always address the same Redis queue. */
export function redisConnection(url: string): {
  host: string;
  port: number;
  db: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
} {
  const redisUrl = new URL(url);
  if (!['redis:', 'rediss:'].includes(redisUrl.protocol))
    throw new Error('REDIS_URL must use redis:// or rediss://');
  const db = Number(redisUrl.pathname.slice(1) || 0);
  if (!Number.isInteger(db) || db < 0)
    throw new Error('REDIS_URL database index must be an integer');
  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    db,
    ...(redisUrl.username ? { username: decodeURIComponent(redisUrl.username) } : {}),
    ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
    ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

import 'dotenv/config';
import { z } from 'zod';
import { redisConnection } from '@platform/ingestion';
const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  STORAGE_ROOT: z.string().default('./var/uploads'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  WORKER_POOL_MAX: z.coerce.number().int().min(2).max(20).default(5),
  QUERY_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300000),
});
export const config = schema.parse(process.env);
if (config.WORKER_POOL_MAX < config.WORKER_CONCURRENCY + 1)
  throw new Error('WORKER_POOL_MAX must exceed concurrency to leave room for reconciliation.');
export const redis = redisConnection(config.REDIS_URL);

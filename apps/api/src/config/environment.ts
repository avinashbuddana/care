import 'dotenv/config';
import { z } from 'zod';
export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  STORAGE_ROOT: z.string().min(1).default('../../var/uploads'),
  SECRET_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(2147483648).default(104857600),
  PROFILE_SAMPLE_ROWS: z.coerce.number().int().min(10).max(10000).default(1000),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  SUPERSET_URL: z.string().url().default('http://localhost:8088'),
});
export type Environment = z.infer<typeof environmentSchema>;
export function loadEnvironment(): Environment {
  const env = environmentSchema.parse(process.env);
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE !== 'true')
    throw new Error('Production requires COOKIE_SECURE=true behind HTTPS');
  return env;
}

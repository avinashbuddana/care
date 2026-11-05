import 'dotenv/config';
import { Pool } from 'pg';
import { z } from 'zod';
import { hashPassword } from '../modules/auth/password';
import { conventionsSchema } from '@platform/contracts';
export async function seed(): Promise<void> {
  const env = z
    .object({
      DATABASE_URL: z.string().url(),
      ADMIN_EMAIL: z.string().email(),
      ADMIN_PASSWORD: z.string().min(8).max(200),
    })
    .parse(process.env);
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  try {
    await pool.query(
      "INSERT INTO platform.users(email,password_hash,role) VALUES($1,$2,'admin') ON CONFLICT(email) DO NOTHING",
      [env.ADMIN_EMAIL.toLowerCase(), await hashPassword(env.ADMIN_PASSWORD)],
    );
    await pool.query(
      "INSERT INTO platform.settings(key,value) VALUES('repository',$1) ON CONFLICT(key) DO NOTHING",
      [JSON.stringify(conventionsSchema.parse({}))],
    );
    console.log(JSON.stringify({ event: 'seed_complete' }));
  } finally {
    await pool.end();
  }
}
if (require.main === module)
  void seed().catch(() => {
    console.error(
      'Seed failed. Check database and ADMIN_EMAIL / ADMIN_PASSWORD (minimum 8 characters).',
    );
    process.exitCode = 1;
  });

import 'dotenv/config';
import { Pool } from 'pg';
import { resolve, sep } from 'node:path';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    STORAGE_ROOT: z.string().min(1),
    RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  })
  .parse(process.env);
const apply = process.argv.includes('--apply');
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, statement_timeout: 30000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(731612342)');
    const eligible = z
      .array(
        z.object({ id: z.string().uuid(), storage_key: z.string().regex(/^[a-zA-Z0-9_.-]+$/) }),
      )
      .parse(
        (
          await client.query(
            `SELECT u.id,u.storage_key FROM platform.uploads u WHERE u.created_at < now()-($1::int*interval '1 day') AND NOT EXISTS (SELECT 1 FROM platform.import_jobs j WHERE j.upload_id=u.id) AND NOT EXISTS (SELECT 1 FROM platform.schema_proposals p WHERE p.upload_id=u.id) FOR UPDATE`,
            [env.RETENTION_DAYS],
          )
        ).rows,
      );
    const count = z
      .object({ count: z.coerce.number() })
      .parse(
        (
          await client.query(
            `SELECT count(*) AS count FROM platform.import_row_errors e JOIN platform.import_jobs j ON j.id=e.job_id WHERE j.status IN ('completed','invalid','failed') AND j.created_at < now()-($1::int*interval '1 day')`,
            [env.RETENTION_DAYS],
          )
        ).rows[0],
      ).count;
    if (apply) {
      for (const upload of eligible) {
        const root = resolve(env.STORAGE_ROOT);
        const path = resolve(root, upload.storage_key);
        if (!path.startsWith(root + sep)) throw new Error('Invalid storage path');
        // Delete bytes before metadata; a crash can be retried because ENOENT is idempotent.
        await unlink(path).catch((error: unknown) => {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        });
        await client.query('DELETE FROM platform.uploads WHERE id=$1', [upload.id]);
      }
      await client.query(
        `DELETE FROM platform.import_row_errors e USING platform.import_jobs j WHERE j.id=e.job_id AND j.status IN ('completed','invalid','failed') AND j.created_at < now()-($1::int*interval '1 day')`,
        [env.RETENTION_DAYS],
      );
      await client.query(
        `UPDATE platform.import_jobs SET errors='[]'::jsonb WHERE status IN ('completed','invalid','failed') AND created_at < now()-($1::int*interval '1 day')`,
        [env.RETENTION_DAYS],
      );
    }
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        event: 'retention',
        dryRun: !apply,
        unreferencedUploads: eligible.length,
        rowErrors: count,
        retentionDays: env.RETENTION_DAYS,
      }),
    );
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
void main().catch(() => {
  console.error('Retention failed; inspect database and storage permissions.');
  process.exitCode = 1;
});

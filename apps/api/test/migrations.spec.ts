import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { z } from 'zod';

const run = promisify(execFile);
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const api = join(__dirname, '..');
const compiled = join(api, 'dist/database/migrate.js');

/** Exercises the exact compiled command the release job runs (migration:run:prod). */
suite('compiled deployment migrations (real PostgreSQL)', () => {
  const database = `migration_probe_${process.pid}`;
  let admin: Pool;
  let probeUrl: string;
  beforeAll(async () => {
    if (!existsSync(compiled))
      throw new Error('Build first: pnpm --filter @platform/api build (pretest does this).');
    admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${database}`);
    const probe = new URL(url ?? '');
    probe.pathname = `/${database}`;
    probeUrl = probe.toString();
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.end();
  });
  async function migrate(command: 'run' | 'show'): Promise<unknown> {
    const { stdout } = await run('node', [compiled, command], {
      cwd: api,
      env: { ...process.env, DATABASE_URL: probeUrl },
    });
    return JSON.parse(stdout.trim().split('\n').at(-1) ?? 'null');
  }
  const applied = z.object({ applied: z.array(z.string()) });

  it('applies each migration exactly once under concurrent release jobs, then nothing on rerun', async () => {
    const [a, b] = await Promise.all([migrate('run'), migrate('run')]);
    const names = [...applied.parse(a).applied, ...applied.parse(b).applied].sort();
    expect(names).toEqual([
      'Departments1760000001000',
      'Platform1760000000000',
      'Reporting1760000002000',
    ]);
    expect(applied.parse(await migrate('run')).applied).toEqual([]);
    expect(await migrate('show')).toEqual({ pending: false });
    const history = new Pool({ connectionString: probeUrl, max: 1 });
    try {
      const count = await history.query('SELECT count(*)::int AS n FROM public.typeorm_migrations');
      expect(z.object({ n: z.number() }).parse(count.rows[0]).n).toBe(3);
    } finally {
      await history.end();
    }
  });
});

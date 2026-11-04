import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, platform, arch, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { z } from 'zod';
import { contractSchema, mappingSchema } from '@platform/contracts';
import { quote, runImport } from './index';

async function main(): Promise<void> {
  const url = z.string().url().parse(process.env['TEST_DATABASE_URL']);
  const rows = z.coerce
    .number()
    .int()
    .min(1)
    .max(1000000)
    .parse(process.argv[2] ?? 100000);
  const pool = new Pool({
    connectionString: url,
    max: 3,
    application_name: 'powerbridge-synthetic-benchmark',
  });
  const storage = await mkdtemp(join(tmpdir(), 'powerbridge-benchmark-'));
  const user = randomUUID(),
    dataset = randomUUID(),
    upload = randomUUID(),
    job = randomUUID();
  const table = `bench_${dataset.slice(0, 8)}`;
  const contract = contractSchema.parse({
    version: 1,
    table,
    columns: [
      { name: 'code', source: 'code', type: 'bigint', nullable: false },
      { name: 'name', source: 'name', type: 'text', nullable: false },
      {
        name: 'amount',
        source: 'amount',
        type: 'numeric',
        precision: 12,
        scale: 2,
        nullable: false,
      },
    ],
    uniqueKey: ['code'],
    references: [],
    reportingColumns: [],
  });
  let created = false;
  try {
    const path = join(storage, `${upload}.csv`);
    function* csv(): Generator<string> {
      yield 'code,name,amount\n';
      for (let i = 1; i <= rows; i++) yield `${i},Synthetic record ${i},${i % 10000}.25\n`;
    }
    await pipeline(Readable.from(csv()), createWriteStream(path));
    await pool.query(
      'INSERT INTO platform.users(id,email,password_hash,role) VALUES($1,$2,$3,$4)',
      [user, `benchmark-${user}@example.test`, 'disabled-synthetic', 'admin'],
    );
    created = true;
    await pool.query(
      `CREATE TABLE app.${quote(table)}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),code bigint NOT NULL UNIQUE,name text NOT NULL,amount numeric(12,2) NOT NULL)`,
    );
    await pool.query(
      "INSERT INTO platform.datasets(id,name,status,contract) VALUES($1,'Synthetic benchmark','ready',$2)",
      [dataset, JSON.stringify(contract)],
    );
    await pool.query(
      'INSERT INTO platform.uploads(id,original_name,storage_key,bytes,uploaded_by) VALUES($1,$2,$3,0,$4)',
      [upload, 'synthetic.csv', `${upload}.csv`, user],
    );
    const mapping = mappingSchema.parse({
      columns: { code: 'code', name: 'name', amount: 'amount' },
      mode: 'upsert',
    });
    await pool.query(
      "INSERT INTO platform.import_jobs(id,dataset_id,upload_id,status,mapping,mapping_version,contract,created_by) VALUES($1,$2,$3,'queued_publish',$4,1,$5,$6)",
      [job, dataset, upload, JSON.stringify(mapping), JSON.stringify(contract), user],
    );
    let peakRss = process.memoryUsage().rss;
    const timer = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 10);
    const start = performance.now();
    try {
      await runImport(pool, job, storage);
    } finally {
      clearInterval(timer);
    }
    const elapsedMs = performance.now() - start;
    const result = z
      .object({ status: z.string(), counts: z.unknown() })
      .parse(
        (await pool.query('SELECT status,counts FROM platform.import_jobs WHERE id=$1', [job]))
          .rows[0],
      );
    const postgres = z
      .object({ version: z.string() })
      .parse((await pool.query('SELECT version()')).rows[0]).version;
    process.stdout.write(
      JSON.stringify(
        {
          benchmark: 'synthetic COPY + strict validation + transaction publication',
          rows,
          elapsedMs: Math.round(elapsedMs),
          peakRssMiB: Math.round(peakRss / 1024 / 1024),
          environment: {
            node: process.version,
            os: platform(),
            arch: arch(),
            cpu: cpus()[0]?.model,
            totalMemoryGiB: Math.round(totalmem() / 1024 ** 3),
            postgres,
          },
          result,
          limitations:
            'Local synthetic three-column dataset without references or competing writers; includes catalog verification and staging. 10ms RSS sampling can miss brief spikes. Not a throughput guarantee.',
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    if (created) {
      await pool.query('DELETE FROM platform.import_jobs WHERE id=$1', [job]);
      await pool.query('DELETE FROM platform.uploads WHERE id=$1', [upload]);
      await pool.query('DELETE FROM platform.datasets WHERE id=$1', [dataset]);
      await pool.query('DELETE FROM platform.audit_events WHERE actor_id=$1', [user]);
      await pool.query('DELETE FROM platform.users WHERE id=$1', [user]);
      await pool.query(`DROP TABLE IF EXISTS app.${quote(table)}`);
    }
    await pool.end();
    await rm(storage, { recursive: true, force: true });
  }
}
void main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : 'Benchmark failed') + '\n');
  process.exitCode = 1;
});

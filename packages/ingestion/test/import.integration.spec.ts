import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { z } from 'zod';
import { contractSchema, mappingSchema, type Contract } from '@platform/contracts';
import { runImport, verifyContract } from '../src';
const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;
suite('COPY staging and transactional publication (real PostgreSQL)', () => {
  let pool: Pool;
  let storage: string;
  let user: string;
  let dataset: string;
  let contract: Contract;
  const jobs: string[] = [];
  const uploads: string[] = [];
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 3 });
    storage = await mkdtemp(join(tmpdir(), 'import-integration-'));
    user = randomUUID();
    dataset = randomUUID();
    await pool.query(
      "INSERT INTO platform.users(id,email,password_hash,role) VALUES($1,$2,'not-a-login','admin')",
      [user, `ingestion-${user}@example.test`],
    );
    await pool.query(`CREATE TABLE app.ingestion_test_parents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE);
   INSERT INTO app.ingestion_test_parents(code) VALUES('HR');
   CREATE TABLE app.ingestion_test_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),code text NOT NULL UNIQUE,name text NOT NULL,amount numeric(10,2) NOT NULL,source_updated_at timestamptz,parent_id uuid NOT NULL REFERENCES app.ingestion_test_parents(id) ON DELETE RESTRICT ON UPDATE RESTRICT);`);
    contract = contractSchema.parse({
      version: 1,
      table: 'ingestion_test_records',
      columns: [
        { name: 'code', source: 'code', type: 'text', nullable: false },
        { name: 'name', source: 'name', type: 'text', nullable: false },
        {
          name: 'amount',
          source: 'amount',
          type: 'numeric',
          nullable: false,
          precision: 10,
          scale: 2,
        },
        { name: 'parent_id', source: 'department', type: 'text', nullable: false },
        {
          name: 'source_updated_at',
          source: 'source_updated_at',
          type: 'timestamptz',
          nullable: true,
        },
      ],
      uniqueKey: ['code'],
      references: [
        {
          column: 'parent_id',
          targetTable: 'ingestion_test_parents',
          targetColumn: 'code',
          targetDatasetId: randomUUID(),
          nullable: false,
          resolveToId: true,
          onDelete: 'RESTRICT',
          onUpdate: 'RESTRICT',
        },
      ],
    });
    await pool.query(
      "INSERT INTO platform.datasets(id,name,status,contract) VALUES($1,'ingestion integration','ready',$2)",
      [dataset, JSON.stringify(contract)],
    );
  });
  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM platform.import_jobs WHERE dataset_id=$1', [dataset]);
      await pool.query('DELETE FROM platform.datasets WHERE id=$1', [dataset]);
      await pool.query('DELETE FROM platform.uploads WHERE uploaded_by=$1', [user]);
      await pool.query('DELETE FROM platform.audit_events WHERE actor_id=$1', [user]);
      await pool.query('DELETE FROM platform.users WHERE id=$1', [user]);
      await pool.query(
        'DROP TABLE IF EXISTS app.ingestion_test_records;DROP TABLE IF EXISTS app.ingestion_test_parents',
      );
      await pool.end();
    }
    if (storage) await rm(storage, { recursive: true, force: true });
  });
  async function makeJob(csv: string, publish = true): Promise<string> {
    const upload = randomUUID();
    uploads.push(upload);
    const id = randomUUID();
    jobs.push(id);
    await writeFile(join(storage, `${upload}.csv`), csv);
    await pool.query(
      'INSERT INTO platform.uploads(id,original_name,storage_key,bytes,uploaded_by) VALUES($1,$2,$3,$4,$5)',
      [upload, 'test.csv', `${upload}.csv`, Buffer.byteLength(csv), user],
    );
    const mapping = mappingSchema.parse({
      columns: {
        code: 'code',
        name: 'name',
        amount: 'amount',
        parent_id: 'department',
        ...(csv.split('\n')[0]?.includes('source_updated_at')
          ? { source_updated_at: 'source_updated_at' }
          : {}),
      },
      mode: 'upsert',
    });
    await pool.query(
      'INSERT INTO platform.import_jobs(id,dataset_id,upload_id,status,mapping,mapping_version,contract,created_by) VALUES($1,$2,$3,$4,$5,1,$6,$7)',
      [
        id,
        dataset,
        upload,
        publish ? 'queued_publish' : 'queued_validation',
        JSON.stringify(mapping),
        JSON.stringify(contract),
        user,
      ],
    );
    return id;
  }
  async function status(id: string): Promise<{
    status: string;
    counts: Record<string, number>;
    errors: { row: number; field: string; reason: string }[];
  }> {
    return z
      .object({
        status: z.string(),
        counts: z.record(z.number()),
        errors: z.array(z.object({ row: z.number(), field: z.string(), reason: z.string() })),
      })
      .parse(
        (
          await pool.query('SELECT status,counts,errors FROM platform.import_jobs WHERE id=$1', [
            id,
          ])
        ).rows[0],
      );
  }
  const record = z.object({
    id: z.string(),
    created_at: z.date(),
    updated_at: z.date(),
    name: z.string(),
  });
  test('schema availability blocks execution before staging or target changes', async () => {
    const id = await makeJob('code,name,amount,department\nA,Alice,10.25,HR\n');
    await pool.query("UPDATE platform.datasets SET status='awaiting_deployment' WHERE id=$1", [
      dataset,
    ]);
    await expect(runImport(pool, id, storage)).rejects.toThrow('not import-ready');
    expect((await pool.query('SELECT 1 FROM app.ingestion_test_records')).rowCount).toBe(0);
    await pool.query("UPDATE platform.datasets SET status='ready' WHERE id=$1", [dataset]);
  });
  test('validation previews do not publish; changed and unchanged reimports preserve UUID and created timestamp', async () => {
    const preview = await makeJob('code,name,amount,department\nA,Alice,10.25,HR\n', false);
    await runImport(pool, preview, storage);
    expect((await status(preview)).status).toBe('validated');
    expect((await pool.query('SELECT 1 FROM app.ingestion_test_records')).rowCount).toBe(0);
    const first = await makeJob('code,name,amount,department\nA,Alice,10.25,HR\n');
    await runImport(pool, first, storage);
    const before = record.parse(
      (await pool.query("SELECT * FROM app.ingestion_test_records WHERE code='A'")).rows[0],
    );
    await runImport(pool, first, storage);
    expect((await pool.query('SELECT 1 FROM app.ingestion_test_records')).rowCount).toBe(1);
    const same = await makeJob('code,name,amount,department\nA,Alice,10.25,HR\n');
    await runImport(pool, same, storage);
    const unchanged = record.parse(
      (await pool.query("SELECT * FROM app.ingestion_test_records WHERE code='A'")).rows[0],
    );
    expect(unchanged).toEqual(before);
    expect((await status(same)).counts['unchanged']).toBe(1);
    const changed = await makeJob('code,name,amount,department\nA,Alicia,10.25,HR\n');
    await runImport(pool, changed, storage);
    const after = record.parse(
      (await pool.query("SELECT * FROM app.ingestion_test_records WHERE code='A'")).rows[0],
    );
    expect(after.id).toBe(before.id);
    expect(after.created_at).toEqual(before.created_at);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    expect(after.name).toBe('Alicia');
    expect((await status(changed)).counts['updated']).toBe(1);
  });
  test('source timestamp-only updates preserve internal updated_at', async () => {
    const before = record.parse(
      (await pool.query("SELECT * FROM app.ingestion_test_records WHERE code='A'")).rows[0],
    );
    const id = await makeJob(
      'code,name,amount,department,source_updated_at\nA,Alicia,10.25,HR,2025-01-01T12:00:00Z\n',
    );
    await runImport(pool, id, storage);
    const after = record.parse(
      (await pool.query("SELECT * FROM app.ingestion_test_records WHERE code='A'")).rows[0],
    );
    expect(after.updated_at).toEqual(before.updated_at);
    expect(
      z
        .object({ source_updated_at: z.date() })
        .parse(
          (
            await pool.query(
              "SELECT source_updated_at FROM app.ingestion_test_records WHERE code='A'",
            )
          ).rows[0],
        )
        .source_updated_at.toISOString(),
    ).toBe('2025-01-01T12:00:00.000Z');
  });
  test('duplicate keys, invalid decimals, missing references leave all target values unchanged with source row errors', async () => {
    const before = (await pool.query('SELECT * FROM app.ingestion_test_records ORDER BY code'))
      .rows;
    const id = await makeJob(
      'code,name,amount,department\nB,Bob,1.00,HR\nB,Betty,2.00,HR\nC,Cara,1.999,HR\nA,Corrupt,5.00,MISSING\n',
    );
    await runImport(pool, id, storage);
    const job = await status(id);
    expect(job.status).toBe('invalid');
    expect(job.counts['received']).toBe(4);
    expect(job.counts['rejected']).toBe(4);
    expect(job.errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    expect(job.errors.some((e) => e.reason.includes('matching parent'))).toBe(true);
    expect(
      (await pool.query('SELECT * FROM app.ingestion_test_records ORDER BY code')).rows,
    ).toEqual(before);
  });
  test('concurrent redelivery of one job (worker retry) commits rows exactly once', async () => {
    const id = await makeJob('code,name,amount,department\nR1,Retry,3.00,HR\n');
    await Promise.all([runImport(pool, id, storage), runImport(pool, id, storage)]);
    await runImport(pool, id, storage);
    expect(
      (await pool.query("SELECT 1 FROM app.ingestion_test_records WHERE code='R1'")).rowCount,
    ).toBe(1);
    const job = await status(id);
    expect(job.status).toBe('completed');
    expect(job.counts['inserted']).toBe(1);
  });
  test('catalog drift is detected even for a previously ready dataset', async () => {
    const client = await pool.connect();
    try {
      expect(await verifyContract(client, contract)).toEqual([]);
      await client.query('ALTER TABLE app.ingestion_test_records ADD COLUMN unapproved text');
      expect(await verifyContract(client, contract)).toContain(
        'Unapproved column unapproved; reconcile the contract.',
      );
      await client.query('ALTER TABLE app.ingestion_test_records DROP COLUMN unapproved');
    } finally {
      client.release();
    }
  });
});

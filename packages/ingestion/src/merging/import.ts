import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Pool, PoolClient } from 'pg';
import { from } from 'pg-copy-streams';
import { z } from 'zod';
import {
  contractSchema,
  mappingSchema,
  sourceFields,
  type Contract,
  type Counts,
  type Mapping,
  type RowError,
} from '@platform/contracts';
import { csvRows, detectCsv, uploadPath, validateHeaders } from '../parsing/csv';
import { defaultValue, valueError } from '../validation/values';
import { quote, sqlType, verifyContract } from '../validation/schema';

const jobSchema = z.object({
  id: z.string().uuid(),
  dataset_id: z.string().uuid(),
  upload_id: z.string().uuid(),
  status: z.string(),
  mapping: mappingSchema,
  contract: contractSchema,
});
const errorSchema = z.object({
  row: z.number(),
  field: z.string(),
  value: z.string().nullable(),
  reason: z.string(),
});
const countsSchema = z.object({ received: z.coerce.number(), rejected: z.coerce.number() });
const numberSchema = z.object({ count: z.coerce.number() });
function cell(value: string | null): string {
  return value === null ? '\\N' : `"${value.replace(/"/g, '""')}"`;
}
function emptyCounts(): Counts {
  return { received: 0, valid: 0, rejected: 0, inserted: 0, updated: 0, unchanged: 0 };
}
function errorExpr(field: string, reason: string): string {
  return `jsonb_build_array(jsonb_build_object('row',_row,'field','${field}','value',${quote(field)},'reason','${reason}'))`;
}
async function stageFile(
  client: PoolClient,
  path: string,
  table: string,
  contract: Contract,
  mapping: Mapping,
): Promise<void> {
  const detected = await detectCsv(path);
  const columns = contract.columns.map((c) => c.name);
  let headers: string[] | undefined;
  async function* chunks(): AsyncGenerator<string> {
    for await (const record of csvRows(path, detected.delimiter)) {
      if (!headers) {
        headers = record.values;
        validateHeaders(headers);
        const sources = Object.values(mapping.columns);
        if (sources.some((s) => !headers?.includes(s)))
          throw new Error('Mapping refers to a missing source header.');
        if (Object.keys(mapping.columns).some((s) => !columns.includes(s)))
          throw new Error('Mapping refers to an unapproved target column.');
        if (headers.some((h) => !sources.includes(h) && !mapping.ignored.includes(h)))
          throw new Error('Every unused CSV header must be explicitly ignored.');
        if (mapping.ignored.some((h) => !headers?.includes(h) || sources.includes(h)))
          throw new Error('Ignored columns must exist and must not also be mapped.');
        continue;
      }
      const errors: RowError[] = [];
      if (record.values.length !== headers.length)
        errors.push({
          row: record.row,
          field: '_row',
          value: null,
          reason: `Expected ${headers.length} values, received ${record.values.length}`,
        });
      const rowHeaders = headers;
      const values = contract.columns.map((column) => {
        const source = mapping.columns[column.name];
        const raw = source === undefined ? undefined : record.values[rowHeaders.indexOf(source)];
        const value =
          raw === undefined
            ? defaultValue(column)
            : raw === '' && mapping.emptyAsNull
              ? defaultValue(column)
              : raw;
        const problem = valueError(value, column);
        if (problem)
          errors.push({
            row: record.row,
            field: column.name,
            value: value?.slice(0, 200) ?? null,
            reason: problem,
          });
        return value;
      });
      yield [String(record.row), ...values.map(cell), cell(JSON.stringify(errors))].join(',') +
        '\n';
    }
    if (!headers) throw new Error('CSV has no header.');
  }
  const copy = client.query(
    from(
      `COPY staging.${quote(table)} (_row,${columns.map(quote).join(',')},_errors) FROM STDIN WITH (FORMAT csv,NULL '\\N')`,
    ),
  );
  await pipeline(Readable.from(chunks()), copy);
}

/** Revalidates on publication; the job row and completion marker commit with all target changes. */
export async function runImport(pool: Pool, jobId: string, storageRoot: string): Promise<void> {
  z.string().uuid().parse(jobId);
  const client = await pool.connect();
  const stage = `batch_${jobId.replace(/-/g, '')}`;
  const stageName = `staging.${quote(stage)}`;
  let transaction = false;
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [jobId]);
    locked = true;
    const initial = jobSchema.parse(
      (
        await client.query(
          'SELECT id,dataset_id,upload_id,status,mapping,contract FROM platform.import_jobs WHERE id=$1',
          [jobId],
        )
      ).rows[0],
    );
    if (['completed', 'validated', 'invalid'].includes(initial.status)) return;
    const publish = ['queued_publish', 'publishing'].includes(initial.status);
    if (
      !['queued_validation', 'validating', 'queued_publish', 'publishing', 'failed'].includes(
        initial.status,
      )
    )
      throw new Error('Job is not queued for processing.');
    if (initial.status === 'failed')
      throw new Error('Failed jobs must be explicitly requeued before processing.');
    await client.query('UPDATE platform.import_jobs SET status=$2,failure=NULL WHERE id=$1', [
      jobId,
      publish ? 'publishing' : 'validating',
    ]);
    await client.query('BEGIN');
    transaction = true;
    const job = jobSchema.parse(
      (
        await client.query(
          'SELECT id,dataset_id,upload_id,status,mapping,contract FROM platform.import_jobs WHERE id=$1 FOR UPDATE',
          [jobId],
        )
      ).rows[0],
    );
    const dataset = z
      .object({ status: z.string(), contract: contractSchema })
      .parse(
        (
          await client.query(
            'SELECT status,contract FROM platform.datasets WHERE id=$1 FOR SHARE',
            [job.dataset_id],
          )
        ).rows[0],
      );
    if (
      dataset.status !== 'ready' ||
      JSON.stringify(dataset.contract) !== JSON.stringify(job.contract)
    )
      throw new Error('Dataset is not import-ready or approved contract has changed.');
    // Serialize publication for a dataset and hold DDL/DML-compatible locks until commit.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [job.dataset_id]);
    const contract = job.contract;
    const target = `app.${quote(contract.table)}`;
    const verification = await verifyContract(client, contract);
    if (verification.length)
      throw new Error(`Schema verification failed: ${verification.join('; ')}`);
    await client.query(
      `LOCK TABLE ${target} IN ${publish ? 'SHARE ROW EXCLUSIVE' : 'ACCESS SHARE'} MODE`,
    );
    for (const ref of contract.references)
      await client.query(`LOCK TABLE app.${quote(ref.targetTable)} IN SHARE MODE`);
    const upload = z
      .object({ storage_key: z.string().regex(/^[a-zA-Z0-9_.-]+$/) })
      .parse(
        (
          await client.query('SELECT storage_key FROM platform.uploads WHERE id=$1', [
            job.upload_id,
          ])
        ).rows[0],
      );
    const path = uploadPath(storageRoot, upload.storage_key);
    await client.query(
      `CREATE TABLE ${stageName} (_row bigint NOT NULL, ${contract.columns.map((c) => `${quote(c.name)} text`).join(',')},_errors jsonb NOT NULL)`,
    );
    await stageFile(client, path, stage, contract, job.mapping);
    for (const ref of contract.references) {
      const source = quote(ref.column);
      const parent = `app.${quote(ref.targetTable)}`;
      const parentKey = quote(ref.targetColumn);
      // Error rows are retained with the source value before any UUID resolution.
      await client.query(
        `UPDATE ${stageName} s SET _errors=_errors || ${errorExpr(ref.column, 'Reference has no matching parent; import the parent dataset first')} WHERE ${source} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${parent} p WHERE p.${parentKey}::text=s.${source})`,
      );
      if (ref.resolveToId)
        await client.query(
          `UPDATE ${stageName} s SET ${source}=p.id::text FROM ${parent} p WHERE p.${parentKey}::text=s.${source} AND s._errors='[]'::jsonb`,
        );
    }
    const typed = `typed_${jobId.replace(/-/g, '')}`;
    const typedName = quote(typed);
    await client.query(
      `CREATE TEMP TABLE ${typedName} ON COMMIT DROP AS SELECT _row,${contract.columns.map((c) => `${quote(c.name)}::${sqlType(c, contract)} AS ${quote(c.name)}`).join(',')} FROM ${stageName} WHERE _errors='[]'::jsonb`,
    );
    const keys = contract.uniqueKey.map(quote);
    const keyJoin = keys.map((k) => `t.${k}=s.${k}`).join(' AND ');
    const duplicateRows = `SELECT _row FROM (SELECT _row,count(*) OVER(PARTITION BY ${keys.join(',')}) AS n FROM ${typedName}) d WHERE n>1`;
    await client.query(
      `UPDATE ${stageName} SET _errors=_errors||jsonb_build_array(jsonb_build_object('row',_row,'field',$1::text,'value',NULL,'reason','Duplicate key within CSV')) WHERE _row IN (${duplicateRows})`,
      [contract.uniqueKey.join(',')],
    );
    if (job.mapping.mode === 'insert')
      await client.query(
        `UPDATE ${stageName} SET _errors=_errors||jsonb_build_array(jsonb_build_object('row',_row,'field',$1::text,'value',NULL,'reason','Key already exists; use upsert')) WHERE _row IN (SELECT s._row FROM ${typedName} s JOIN ${target} t ON ${keyJoin})`,
        [contract.uniqueKey.join(',')],
      );
    const totals = countsSchema.parse(
      (
        await client.query(
          `SELECT count(*) AS received,count(*) FILTER(WHERE _errors<>'[]'::jsonb) AS rejected FROM ${stageName}`,
        )
      ).rows[0],
    );
    const counts: Counts = {
      ...emptyCounts(),
      ...totals,
      valid: totals.received - totals.rejected,
    };
    await client.query('DELETE FROM platform.import_row_errors WHERE job_id=$1', [jobId]);
    await client.query(
      `INSERT INTO platform.import_row_errors(job_id,row,field,value,reason) SELECT $1,(e->>'row')::int,e->>'field',left(e->>'value',200),e->>'reason' FROM ${stageName} CROSS JOIN LATERAL jsonb_array_elements(_errors) e`,
      [jobId],
    );
    const errors = z
      .array(errorSchema)
      .parse(
        (
          await client.query(
            `SELECT (e->>'row')::int AS row,e->>'field' AS field,e->>'value' AS value,e->>'reason' AS reason FROM ${stageName} CROSS JOIN LATERAL jsonb_array_elements(_errors) e ORDER BY _row LIMIT 1000`,
          )
        ).rows,
      );
    if (totals.rejected === 0 && publish) {
      // Repeat catalog check under table lock to close the verification/DDL race.
      const finalCheck = await verifyContract(client, contract);
      if (finalCheck.length) throw new Error(finalCheck.join('; '));
      const existing = numberSchema.parse(
        (
          await client.query(
            `SELECT count(*) AS count FROM ${typedName} s JOIN ${target} t ON ${keyJoin}`,
          )
        ).rows[0],
      ).count;
      const changed = contract.columns.filter((c) => !contract.uniqueKey.includes(c.name));
      const businessChanged = changed.filter(
        (c) => !(sourceFields as readonly string[]).includes(c.name),
      );
      const timestampDiff = businessChanged.length
        ? businessChanged
            .map((c) => `t.${quote(c.name)} IS DISTINCT FROM EXCLUDED.${quote(c.name)}`)
            .join(' OR ')
        : 'FALSE';
      const diff = changed.length
        ? changed.map((c) => `t.${quote(c.name)} IS DISTINCT FROM s.${quote(c.name)}`).join(' OR ')
        : 'FALSE';
      counts.updated =
        job.mapping.mode === 'upsert'
          ? numberSchema.parse(
              (
                await client.query(
                  `SELECT count(*) AS count FROM ${typedName} s JOIN ${target} t ON ${keyJoin} WHERE ${diff}`,
                )
              ).rows[0],
            ).count
          : 0;
      counts.unchanged = existing - counts.updated;
      counts.inserted = counts.received - existing;
      const columns = contract.columns.map((c) => quote(c.name));
      const onConflict =
        job.mapping.mode === 'upsert'
          ? changed.length
            ? `ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${changed.map((c) => `${quote(c.name)}=EXCLUDED.${quote(c.name)}`).join(',')},updated_at=CASE WHEN ${timestampDiff} THEN clock_timestamp() ELSE t.updated_at END WHERE ${changed.map((c) => `t.${quote(c.name)} IS DISTINCT FROM EXCLUDED.${quote(c.name)}`).join(' OR ')}`
            : `ON CONFLICT (${keys.join(',')}) DO NOTHING`
          : '';
      await client.query(
        `INSERT INTO ${target} AS t (${columns.join(',')}) SELECT ${columns.join(',')} FROM ${typedName} WHERE TRUE ${onConflict}`,
      );
    }
    await client.query(
      "UPDATE platform.import_jobs SET status=$2,counts=$3,errors=$4,finished_at=CASE WHEN $2 IN ('completed','invalid') THEN now() ELSE NULL END WHERE id=$1",
      [
        jobId,
        totals.rejected ? 'invalid' : publish ? 'completed' : 'validated',
        JSON.stringify(counts),
        JSON.stringify(errors),
      ],
    );
    await client.query(
      'INSERT INTO platform.audit_events(actor_id,action,resource_id,details) SELECT created_by,$2,$1::uuid::text,$3 FROM platform.import_jobs WHERE id=$1::uuid',
      [
        jobId,
        totals.rejected ? 'import.invalid' : publish ? 'import.published' : 'import.validated',
        JSON.stringify({ counts }),
      ],
    );
    await client.query(`DROP TABLE ${stageName}`);
    await client.query('COMMIT');
    transaction = false;
    process.stdout.write(
      JSON.stringify({
        event: publish ? 'import.publication' : 'import.validation',
        jobId,
        status: totals.rejected ? 'invalid' : publish ? 'completed' : 'validated',
        counts,
      }) + '\n',
    );
  } catch (error: unknown) {
    if (transaction) {
      await client.query('ROLLBACK');
      transaction = false;
    }
    // Never log raw database errors, SQL, row values, or credentials.
    const failure =
      error instanceof Error &&
      /^(Dataset is|Schema verification|Mapping|Every unused|Ignored columns|CSV |Invalid upload|Failed jobs|Job is)/.test(
        error.message,
      )
        ? error.message.slice(0, 2000)
        : 'Import failed. Check CSV types, deployed constraints, and service availability; retry validation after correcting the cause.';
    await client.query(
      "UPDATE platform.import_jobs SET status=CASE WHEN status='publishing' THEN 'queued_publish' WHEN status='validating' THEN 'queued_validation' ELSE status END,failure=$2 WHERE id=$1 AND status<>'completed'",
      [jobId, failure],
    );
    process.stderr.write(
      JSON.stringify({ event: 'import.failure', jobId, reason: failure }) + '\n',
    );
    throw new Error(failure);
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [jobId]);
    client.release();
  }
}

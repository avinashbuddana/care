import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Pool, PoolClient } from 'pg';
import { from } from 'pg-copy-streams';
import { z } from 'zod';
import { csvRows, detectCsv, validateHeaders } from '../parsing/csv';
import { quote } from '../validation/schema';

export interface ReferenceTarget {
  table: string;
  column: string;
}
export interface ReferenceAnalysis {
  sourceHeader: string;
  target: ReferenceTarget;
  targetType: string;
  targetUnique: boolean;
  targetDuplicateKeys: number;
  rows: number;
  emptyRows: number;
  distinctValues: number;
  matchedRows: number;
  missingRows: number;
  /** matchedRows / non-empty rows, 0..1. */
  matchRate: number;
  incompatibleValues: number;
  missingSamples: string[];
  /** Values with no exact parent match that do match after trimming/case folding. */
  ambiguousSamples: string[];
  sampled: false;
}
export interface ReferenceSuggestion {
  sourceHeader: string;
  target: ReferenceTarget;
  sampledDistinct: number;
  sampledMatched: number;
  matchRate: number;
  sampled: true;
}

const count = z.object({ n: z.coerce.number() });
const values = z.array(z.object({ value: z.string() }));

async function targetType(client: PoolClient, target: ReferenceTarget): Promise<string> {
  const rows = z.array(z.object({ type: z.string() })).parse(
    (
      await client.query(
        `SELECT format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a
         JOIN pg_class t ON t.oid = a.attrelid JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'app' AND t.relname = $1 AND a.attname = $2 AND NOT a.attisdropped`,
        [target.table, target.column],
      )
    ).rows,
  );
  const type = rows[0]?.type;
  if (!type) throw new Error(`app.${target.table}.${target.column} is not deployed.`);
  return type;
}

/**
 * Full-file reference check. Streams one CSV column into a temporary table with COPY and compares
 * it set-wise against the deployed parent column. Never infers a reference from column names.
 */
export async function analyzeReference(
  pool: Pool,
  path: string,
  sourceHeader: string,
  target: ReferenceTarget,
): Promise<ReferenceAnalysis> {
  const parent = `app.${quote(target.table)}`;
  const key = quote(target.column);
  const { delimiter } = await detectCsv(path);
  const client = await pool.connect();
  let rows = 0;
  let emptyRows = 0;
  try {
    await client.query('BEGIN');
    const type = await targetType(client, target);
    await client.query('CREATE TEMP TABLE ref_values (value text NOT NULL) ON COMMIT DROP');
    let index = -1;
    async function* lines(): AsyncGenerator<string> {
      for await (const record of csvRows(path, delimiter)) {
        if (index < 0) {
          validateHeaders(record.values);
          index = record.values.indexOf(sourceHeader);
          if (index < 0) throw new Error(`CSV has no header named ${sourceHeader}.`);
          continue;
        }
        rows++;
        const value = record.values[index] ?? '';
        if (value === '') emptyRows++;
        else yield `"${value.replace(/"/g, '""')}"\n`;
      }
    }
    await pipeline(
      Readable.from(lines()),
      client.query(from('COPY ref_values (value) FROM STDIN WITH (FORMAT csv)')),
    );
    const exact = `EXISTS (SELECT 1 FROM ${parent} p WHERE p.${key}::text = v.value)`;
    const one = async (sql: string, params: unknown[] = []): Promise<number> =>
      count.parse((await client.query(sql, params)).rows[0]).n;
    const list = async (sql: string): Promise<string[]> =>
      values.parse((await client.query(sql)).rows).map((r) => r.value.slice(0, 200));
    const unique = await one(
      `SELECT count(*) AS n FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace ns ON ns.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
       WHERE ns.nspname = 'app' AND t.relname = $1 AND a.attname = $2 AND i.indisunique
         AND i.indnkeyatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL`,
      [target.table, target.column],
    );
    const matchedRows = await one(`SELECT count(*) AS n FROM ref_values v WHERE ${exact}`);
    const nonEmpty = rows - emptyRows;
    const result: ReferenceAnalysis = {
      sourceHeader,
      target,
      targetType: type,
      targetUnique: unique > 0,
      targetDuplicateKeys: await one(
        `SELECT count(*) AS n FROM (SELECT 1 FROM ${parent} WHERE ${key} IS NOT NULL GROUP BY ${key} HAVING count(*) > 1) d`,
      ),
      rows,
      emptyRows,
      distinctValues: await one('SELECT count(DISTINCT value) AS n FROM ref_values'),
      matchedRows,
      missingRows: nonEmpty - matchedRows,
      matchRate: nonEmpty ? matchedRows / nonEmpty : 0,
      incompatibleValues: await one(
        'SELECT count(*) AS n FROM ref_values WHERE NOT pg_input_is_valid(value, $1)',
        [type],
      ),
      missingSamples: await list(
        `SELECT DISTINCT value FROM ref_values v WHERE NOT ${exact} ORDER BY value LIMIT 10`,
      ),
      ambiguousSamples: await list(
        `SELECT DISTINCT value FROM ref_values v WHERE NOT ${exact} AND EXISTS (
           SELECT 1 FROM ${parent} p WHERE lower(btrim(p.${key}::text)) = lower(btrim(v.value))
         ) ORDER BY value LIMIT 10`,
      ),
      sampled: false,
    };
    await client.query('ROLLBACK');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Suggests candidate references from value overlap on a bounded sample (never from names).
 * Suggestions must still be reviewed and confirmed with a full-file analysis.
 */
export async function suggestReferences(
  pool: Pool,
  path: string,
  targets: ReferenceTarget[],
  sampleRows = 1000,
  threshold = 0.8,
): Promise<ReferenceSuggestion[]> {
  const { delimiter } = await detectCsv(path);
  let headers: string[] | undefined;
  const distinct = new Map<string, Set<string>>();
  let seen = 0;
  for await (const record of csvRows(path, delimiter)) {
    if (!headers) {
      headers = record.values;
      validateHeaders(headers);
      for (const h of headers) distinct.set(h, new Set());
      continue;
    }
    if (++seen > sampleRows) break;
    headers.forEach((h, i) => {
      const value = record.values[i];
      if (value) distinct.get(h)?.add(value);
    });
  }
  const suggestions: ReferenceSuggestion[] = [];
  for (const [sourceHeader, set] of distinct) {
    if (!set.size) continue;
    const sample = [...set];
    for (const target of targets) {
      const matched = count.parse(
        (
          await pool.query(
            `SELECT count(*) AS n FROM unnest($1::text[]) v(value)
             WHERE EXISTS (SELECT 1 FROM app.${quote(target.table)} p WHERE p.${quote(target.column)}::text = v.value)`,
            [sample],
          )
        ).rows[0],
      ).n;
      const matchRate = matched / sample.length;
      if (matchRate >= threshold)
        suggestions.push({
          sourceHeader,
          target,
          sampledDistinct: sample.length,
          sampledMatched: matched,
          matchRate,
          sampled: true,
        });
    }
  }
  return suggestions.sort((a, b) => b.matchRate - a.matchRate);
}

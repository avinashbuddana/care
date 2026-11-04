import type { PoolClient } from 'pg';
import { z } from 'zod';
import { identifier, type Column, type Contract } from '@platform/contracts';
export function quote(value: string): string {
  return `"${identifier.parse(value)}"`;
}
export function sqlType(column: Column, contract: Contract): string {
  if (contract.references.some((r) => r.column === column.name && r.resolveToId)) return 'uuid';
  if (column.type === 'numeric') return `numeric(${column.precision ?? 38},${column.scale ?? 10})`;
  if (column.type === 'text' && column.maxLength !== undefined)
    return `varchar(${column.maxLength})`;
  return column.type;
}
const catalogColumn = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable(),
});
const keySchema = z.object({ columns: z.array(z.string()), kind: z.string() });
const fkSchema = z.object({
  column: z.string(),
  target_table: z.string(),
  target_column: z.string(),
  delete_action: z.string(),
  update_action: z.string(),
});
const aliases: Record<string, string> = {
  integer: 'integer',
  bigint: 'bigint',
  text: 'text',
  boolean: 'boolean',
  date: 'date',
  uuid: 'uuid',
  timestamptz: 'timestamp with time zone',
};
const actions: Record<string, string> = {
  RESTRICT: 'r',
  'NO ACTION': 'a',
  CASCADE: 'c',
  'SET NULL': 'n',
};
export async function verifyContract(client: PoolClient, contract: Contract): Promise<string[]> {
  const result = await client.query(
    `SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, NOT a.attnotnull AS nullable, pg_get_expr(d.adbin,d.adrelid) AS default
    FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname='app' AND t.relname=$1 AND a.attnum>0 AND NOT a.attisdropped`,
    [contract.table],
  );
  const columns = z.array(catalogColumn).parse(result.rows);
  const errors: string[] = [];
  if (!columns.length)
    return [`app.${contract.table} does not exist; deploy the reviewed migration first.`];
  for (const [name, type] of [
    ['id', 'uuid'],
    ['created_at', 'timestamp with time zone'],
    ['updated_at', 'timestamp with time zone'],
  ]) {
    const column = columns.find((c) => c.name === name);
    if (!column || column.type !== type || column.nullable || !column.default)
      errors.push(`Internal ${name} must be non-null ${type} with a database default.`);
    else if (name === 'id' && !/gen_random_uuid\(\)|uuid_generate_v4\(\)/.test(column.default))
      errors.push('Internal id default must generate UUIDs.');
    else if (
      name !== 'id' &&
      !/now\(\)|CURRENT_TIMESTAMP|transaction_timestamp\(\)/i.test(column.default)
    )
      errors.push(`${name} must default to database current time.`);
  }
  for (const expected of contract.columns) {
    const column = columns.find((c) => c.name === expected.name);
    const type = sqlType(expected, contract).replace(/^varchar\(/, 'character varying(');
    const canonical = aliases[type] ?? type;
    if (!column) {
      errors.push(`Missing column ${expected.name}`);
      continue;
    }
    if (column.type !== canonical)
      errors.push(`${expected.name}: expected ${canonical}, found ${column.type}`);
    if (column.nullable !== expected.nullable)
      errors.push(`${expected.name}: nullability differs from approved contract`);
    if (expected.default === 'none' && column.default !== null)
      errors.push(`${expected.name}: unexpected database default`);
    if (expected.default !== 'none') {
      const value =
        expected.default === 'empty' ? "''" : expected.default === 'zero' ? '0' : 'false';
      if (!column.default?.startsWith(value))
        errors.push(`${expected.name}: default differs from approved contract`);
    }
  }
  for (const column of columns)
    if (
      !['id', 'created_at', 'updated_at', ...contract.columns.map((c) => c.name)].includes(
        column.name,
      )
    )
      errors.push(`Unapproved column ${column.name}; reconcile the contract.`);
  const keys = z
    .array(keySchema)
    .parse(
      (
        await client.query(
          `SELECT co.contype::text AS kind,array_agg(a.attname ORDER BY u.ord)::text[] AS columns FROM pg_constraint co JOIN pg_class t ON t.oid=co.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace CROSS JOIN LATERAL unnest(co.conkey) WITH ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=u.num WHERE n.nspname='app' AND t.relname=$1 AND co.contype IN ('u','p') GROUP BY co.oid`,
          [contract.table],
        )
      ).rows,
    );
  if (!keys.some((k) => k.kind === 'p' && JSON.stringify(k.columns) === JSON.stringify(['id'])))
    errors.push('Internal id primary key is missing.');
  if (!keys.some((k) => JSON.stringify(k.columns) === JSON.stringify(contract.uniqueKey)))
    errors.push(`Unique key (${contract.uniqueKey.join(', ')}) is missing or differs.`);
  const fks = z
    .array(fkSchema)
    .parse(
      (
        await client.query(
          `SELECT a.attname AS column, rt.relname AS target_table, ra.attname AS target_column, co.confdeltype::text AS delete_action, co.confupdtype::text AS update_action FROM pg_constraint co JOIN pg_class t ON t.oid=co.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class rt ON rt.oid=co.confrelid JOIN pg_namespace rn ON rn.oid=rt.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=co.conkey[1] JOIN pg_attribute ra ON ra.attrelid=rt.oid AND ra.attnum=co.confkey[1] WHERE n.nspname='app' AND rn.nspname='app' AND t.relname=$1 AND co.contype='f' AND array_length(co.conkey,1)=1`,
          [contract.table],
        )
      ).rows,
    );
  for (const ref of contract.references) {
    if (
      !fks.some(
        (f) =>
          f.column === ref.column &&
          f.target_table === ref.targetTable &&
          f.target_column === (ref.resolveToId ? 'id' : ref.targetColumn) &&
          f.delete_action === actions[ref.onDelete] &&
          f.update_action === actions[ref.onUpdate],
      )
    )
      errors.push(`Reference ${ref.column} is missing or differs.`);
    const unique = await client.query(
      `SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=i.indkey[0] WHERE n.nspname='app' AND t.relname=$1 AND a.attname=$2 AND i.indisunique AND i.indnkeyatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL`,
      [ref.targetTable, ref.targetColumn],
    );
    if ((unique.rowCount ?? 0) < 1)
      errors.push(
        `Reference target ${ref.targetTable}.${ref.targetColumn} must have an unconditional single-column unique key.`,
      );
  }
  return errors;
}

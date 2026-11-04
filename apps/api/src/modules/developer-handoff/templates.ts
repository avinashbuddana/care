import { createHash } from 'node:crypto';
import {
  contractSchema,
  conventionsSchema,
  identifier,
  sourceFields,
  type Artifact,
  type Column,
  type Contract,
  type Conventions,
} from '@platform/contracts';
/** Bump when generated artifact content changes; stored with each handoff. */
export const TEMPLATE_VERSION = 2;
export function quote(name: string): string {
  return `"${identifier.parse(name)}"`;
}
export function contractHash(contract: Contract): string {
  return createHash('sha256')
    .update(JSON.stringify(contractSchema.parse(contract)))
    .digest('hex');
}
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
function physicalType(column: Column, contract: Contract): string {
  if (contract.references.some((r) => r.column === column.name && r.resolveToId)) return 'uuid';
  if (column.type === 'text' && column.maxLength) return `varchar(${column.maxLength})`;
  if (column.type === 'numeric') return `numeric(${column.precision ?? 38},${column.scale ?? 10})`;
  return column.type;
}
function defaultSql(column: Column): string {
  return column.default === 'none'
    ? ''
    : column.default === 'empty'
      ? " DEFAULT ''"
      : column.default === 'zero'
        ? ' DEFAULT 0'
        : ' DEFAULT false';
}
function className(table: string): string {
  return table
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
export function generateArtifacts(
  input: Contract,
  settings: Conventions,
  proposalId: string,
  stamp: number,
): Artifact[] {
  const contract = contractSchema.parse(input);
  const c = conventionsSchema.parse(settings);
  const name = className(contract.table);
  const migrationName = `${name}${stamp}`;
  const columns = contract.columns.map(
    (col) =>
      `      ${quote(col.name)} ${physicalType(col, contract)}${col.nullable ? '' : ' NOT NULL'}${defaultSql(col)}`,
  );
  const fk = contract.references.map(
    (r, i) =>
      `      CONSTRAINT ${quote(`${contract.table.slice(0, 30)}_ref_${i}`)} FOREIGN KEY (${quote(r.column)}) REFERENCES app.${quote(r.targetTable)} (${quote(r.resolveToId ? 'id' : r.targetColumn)}) ON DELETE ${r.onDelete} ON UPDATE ${r.onUpdate}`,
  );
  // updated_at advances only when business values change; source_* metadata and no-op updates keep it.
  const business = contract.columns
    .filter((col) => !(sourceFields as readonly string[]).includes(col.name))
    .map((col) => quote(col.name));
  const touch = business.length
    ? `IF ROW(${business.map((b) => `NEW.${b}`).join(', ')}) IS DISTINCT FROM ROW(${business.map((b) => `OLD.${b}`).join(', ')}) THEN NEW.updated_at = clock_timestamp(); ELSE NEW.updated_at = OLD.updated_at; END IF;`
    : 'NEW.updated_at = OLD.updated_at;';
  const create = `CREATE TABLE app.${quote(contract.table)} (\n      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n      created_at timestamptz NOT NULL DEFAULT now(),\n      updated_at timestamptz NOT NULL DEFAULT now(),\n${columns.join(',\n')},\n      UNIQUE (${contract.uniqueKey.map(quote).join(', ')})${fk.length ? ',\n' + fk.join(',\n') : ''}\n    );\n    CREATE FUNCTION app.${quote(`${contract.table.slice(0, 32)}_touch`)}() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN ${touch} RETURN NEW; END $body$;\n    CREATE TRIGGER touch_updated BEFORE UPDATE ON app.${quote(contract.table)} FOR EACH ROW EXECUTE FUNCTION app.${quote(`${contract.table.slice(0, 32)}_touch`)}();`;
  const reporting = contract.reportingColumns.length
    ? `CREATE VIEW reporting.${quote(contract.table)} AS SELECT ${contract.reportingColumns.map(quote).join(', ')} FROM app.${quote(contract.table)};`
    : '';
  const registration = `UPDATE platform.datasets SET contract=${literal(JSON.stringify(contract))}::jsonb,status='awaiting_deployment' WHERE proposal_id=${literal(proposalId)}::uuid;\n    INSERT INTO platform.datasets(name,status,contract,proposal_id) SELECT ${literal(name)},'awaiting_deployment',${literal(JSON.stringify(contract))}::jsonb,${literal(proposalId)}::uuid WHERE NOT EXISTS (SELECT 1 FROM platform.datasets WHERE proposal_id=${literal(proposalId)}::uuid);`;
  const migration = `import type { MigrationInterface, QueryRunner } from 'typeorm';\n\nexport class ${migrationName} implements MigrationInterface {\n  name = '${migrationName}';\n  async up(q: QueryRunner): Promise<void> {\n    await q.query(${JSON.stringify(create)});\n    ${reporting ? `await q.query(${JSON.stringify(reporting)});` : ''}\n    await q.query(${JSON.stringify(registration)});\n  }\n  async down(q: QueryRunner): Promise<void> {\n    await q.query(${JSON.stringify(`UPDATE platform.datasets SET status='awaiting_deployment' WHERE proposal_id=${literal(proposalId)}::uuid;${reporting ? `DROP VIEW reporting.${quote(contract.table)};` : ''} DROP TABLE app.${quote(contract.table)}; DROP FUNCTION app.${quote(`${contract.table.slice(0, 32)}_touch`)}();`)});\n  }\n}\n`;
  const entityColumns = contract.columns
    .map((col) => {
      const type = physicalType(col, contract);
      const base = type.startsWith('varchar')
        ? 'varchar'
        : type.startsWith('numeric')
          ? 'numeric'
          : type;
      const tsType = ['integer'].includes(base)
        ? 'number'
        : base === 'boolean'
          ? 'boolean'
          : base === 'timestamptz'
            ? 'Date'
            : 'string';
      const options = [
        `type: '${base}'`,
        `nullable: ${col.nullable}`,
        ...(base === 'varchar' ? [`length: ${col.maxLength}`] : []),
        ...(base === 'numeric'
          ? [`precision: ${col.precision ?? 38}`, `scale: ${col.scale ?? 10}`]
          : []),
        ...(col.default === 'none'
          ? []
          : [
              `default: ${col.default === 'empty' ? "''" : col.default === 'zero' ? '0' : 'false'}`,
            ]),
      ];
      return `  @Column({ ${options.join(', ')} })\n  ${col.name}!: ${tsType}${col.nullable ? ' | null' : ''};`;
    })
    .join('\n');
  const entity = `import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';\n\n@Entity({ schema: 'app', name: '${contract.table}' })\n@Unique(${JSON.stringify(contract.uniqueKey)})\nexport class ${name} {\n  @PrimaryGeneratedColumn('uuid')\n  id!: string;\n  @CreateDateColumn({ type: 'timestamptz' })\n  created_at!: Date;\n  @UpdateDateColumn({ type: 'timestamptz' })\n  updated_at!: Date;\n${entityColumns}\n}\n`;
  const contractPath = `${c.entityDirectory}/${contract.table}.contract.ts`;
  const registry = `// Scoped insertion only: verify actual imports and existing registration structure.\n// Import ${name} from its entity file and approvedContract from ${contractPath}.\n// Add ${name} to the DataSource entities array at ${c.dataSourcePath}.\n// Add ${migrationName} to the DataSource migrations array at ${c.dataSourcePath}.\n// Add to deployedDatasets at ${c.registrationPath}:\n{ contract: approvedContract, entity: ${name}, migration: '${migrationName}' },\n`;
  const readme = `# Proposed developer handoff — not applied or verified\n\nProposal ${proposalId}, version ${contract.version}, template ${TEMPLATE_VERSION}. Contract SHA256 ${contractHash(contract)}.\n\nReview all files and business rules. No application AI has inspected the repository. Paths originate from configured conventions. Apply the scoped registration insertion; never replace the existing DataSource.\n\nChoose ONE migration alternative:\nA. Add entity, register it, generate a migration locally with pnpm --filter @platform/api migration:generate src/database/migrations/${name}, then review it. Add the trigger, reporting view and dataset registration from the proposed migration if generation omits them. Register the generated migration and its actual name in deployedDatasets.\nB. Add and review the provided migration directly, register it in DataSource migrations. Do not generate a second equivalent migration.\n\nBuild: pnpm build\nShow pending: pnpm migration:show\nApply in dedicated release job: ${c.migrationRun}\nProduction: node apps/api/dist/database/migrate.js run\nAfter rollout, use Check Schema Availability. Approval and this download do not create tables.\n\nImport parents before children. Many-to-many needs an explicit junction proposal. Cycles require an explicitly designed staged deployment, never disabled constraints or fabricated parents.\n\nRecovery: deployment failure blocks rollout. Do not automatically revert destructive changes. Successful imports do not implement rollback; restore from a tested backup or use a separately reviewed corrective import.\n`;
  return [
    {
      action: 'create',
      path: `${c.entityDirectory}/${contract.table}.ts`,
      content: entity,
      explanation:
        'Proposed TypeORM entity. Internal identifiers and timestamps are database managed.',
    },
    {
      action: 'create',
      path: `${c.migrationDirectory}/${stamp}-${name}.ts`,
      content: migration,
      explanation:
        'Alternative B: reviewed migration with timestamp trigger, constraints, optional approved reporting view, and dataset contract registration.',
    },
    {
      action: 'create',
      path: contractPath,
      content: `import { contractSchema } from '@platform/contracts';\nexport const approvedContract = contractSchema.parse(${JSON.stringify(contract, null, 2)});\n`,
      explanation: 'Immutable approved import contract snapshot.',
    },
    {
      action: 'modify',
      path: c.registrationPath,
      content: registry,
      explanation:
        'Scoped insertion; developer must verify imports, DataSource entities and migrations, and actual registry conventions.',
    },
    {
      action: 'create',
      path: 'approved-schema.json',
      content: JSON.stringify(contract, null, 2),
      explanation: 'Approved contract; not executable AI output.',
    },
    {
      action: 'create',
      path: 'README.md',
      content: readme,
      explanation: 'Choose one migration alternative and verify after deployment.',
    },
  ];
}

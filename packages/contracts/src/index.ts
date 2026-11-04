import { z } from 'zod';
export const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
/** Source metadata columns: stored separately, never advance internal updated_at. */
export const sourceFields = [
  'source_system',
  'source_record_id',
  'source_created_at',
  'source_updated_at',
] as const;
export const roles = z.enum(['admin', 'operator', 'viewer']);
export type Role = z.infer<typeof roles>;
export const columnSchema = z
  .object({
    name: identifier,
    source: z.string().min(1).max(200),
    type: z.enum([
      'text',
      'integer',
      'bigint',
      'numeric',
      'boolean',
      'date',
      'timestamptz',
      'uuid',
    ]),
    nullable: z.boolean(),
    maxLength: z.number().int().positive().max(100000).optional(),
    precision: z.number().int().min(1).max(38).optional(),
    scale: z.number().int().min(0).max(18).optional(),
    default: z.enum(['none', 'empty', 'zero', 'false']).default('none'),
    evidence: z.string().max(2000).default('Manual recommendation; verify business rules.'),
    confidence: z.number().min(0).max(1).default(0.5),
  })
  .strict();
export const referenceSchema = z
  .object({
    column: identifier,
    targetTable: identifier,
    targetColumn: identifier,
    targetDatasetId: z.string().uuid(),
    resolveToId: z.boolean().default(true),
    cardinality: z.literal('many-to-one').default('many-to-one'),
    nullable: z.boolean(),
    onDelete: z.enum(['RESTRICT', 'NO ACTION', 'SET NULL']).default('RESTRICT'),
    onUpdate: z.enum(['RESTRICT', 'NO ACTION', 'CASCADE']).default('RESTRICT'),
  })
  .strict();
export const contractSchema = z
  .object({
    version: z.number().int().positive(),
    table: identifier,
    columns: z.array(columnSchema).min(1).max(150),
    uniqueKey: z.array(identifier).min(1).max(8),
    references: z.array(referenceSchema).max(30).default([]),
    reportingColumns: z.array(identifier).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const names = value.columns.map((c) => c.name);
    const reserved = ['id', 'created_at', 'updated_at'];
    if (new Set(names).size !== names.length || names.some((n) => reserved.includes(n)))
      ctx.addIssue({ code: 'custom', message: 'Duplicate or reserved column name' });
    for (const key of value.uniqueKey)
      if (!value.columns.some((c) => c.name === key && !c.nullable))
        ctx.addIssue({ code: 'custom', message: 'Unique keys must name non-null columns' });
    for (const c of value.columns) {
      if (c.scale !== undefined && c.scale > (c.precision ?? 38))
        ctx.addIssue({ code: 'custom', message: 'Scale exceeds precision' });
      if (
        (c.default === 'empty' && c.type !== 'text') ||
        (c.default === 'zero' && !['integer', 'bigint', 'numeric'].includes(c.type)) ||
        (c.default === 'false' && c.type !== 'boolean')
      )
        ctx.addIssue({ code: 'custom', message: 'Default incompatible with type' });
    }
    for (const r of value.references)
      if (!names.includes(r.column) || (r.onDelete === 'SET NULL' && !r.nullable))
        ctx.addIssue({ code: 'custom', message: 'Invalid reference column or action' });
    if (value.reportingColumns.some((n) => !names.includes(n)))
      ctx.addIssue({ code: 'custom', message: 'Unknown reporting column' });
  });
export type Column = z.infer<typeof columnSchema>;
export type Contract = z.infer<typeof contractSchema>;
export type Reference = z.infer<typeof referenceSchema>;
export const mappingSchema = z
  .object({
    columns: z.record(identifier, z.string().min(1).max(200)),
    mode: z.enum(['insert', 'upsert']),
    emptyAsNull: z.boolean().default(true),
    ignored: z.array(z.string()).default([]),
  })
  .strict();
export type Mapping = z.infer<typeof mappingSchema>;
export const jobPayloadSchema = z.object({ jobId: z.string().uuid() }).strict();
export interface RowError {
  row: number;
  field: string;
  value: string | null;
  reason: string;
}
export interface Counts {
  received: number;
  valid: number;
  rejected: number;
  inserted: number;
  updated: number;
  unchanged: number;
}
export const profileColumnSchema = z.object({
  source: z.string(),
  name: z.string(),
  type: columnSchema.shape.type,
  nullable: z.boolean(),
  nullPercent: z.number(),
  maxLength: z.number(),
  precision: z.number(),
  scale: z.number(),
  leadingZeros: z.boolean(),
  mixed: z.boolean(),
  uniqueCandidate: z.boolean(),
  evidence: z.string(),
  confidence: z.number(),
  samples: z.array(z.string()),
});
export const profileSchema = z.object({
  encoding: z.string(),
  delimiter: z.string(),
  sampled: z.boolean(),
  rowsSampled: z.number(),
  columns: z.array(profileColumnSchema),
  warnings: z.array(z.string()),
});
export type ProfileColumn = z.infer<typeof profileColumnSchema>;
export type Profile = z.infer<typeof profileSchema>;
export const artifactSchema = z.object({
  action: z.enum(['create', 'modify']),
  path: z.string(),
  content: z.string(),
  explanation: z.string(),
});
export type Artifact = z.infer<typeof artifactSchema>;
export const conventionsSchema = z
  .object({
    entityDirectory: z.string().default('apps/api/src/database/entities'),
    migrationDirectory: z.string().default('apps/api/src/database/migrations'),
    dataSourcePath: z.string().default('apps/api/src/database/data-source.ts'),
    registrationPath: z.string().default('apps/api/src/database/registry.ts'),
    entityRegistration: z.enum(['explicit']).default('explicit'),
    packageManager: z.literal('pnpm').default('pnpm'),
    moduleFormat: z.literal('commonjs').default('commonjs'),
    migrationRun: z.string().default('pnpm migration:run'),
    compiledDataSource: z.string().default('apps/api/dist/database/data-source.js'),
    naming: z.literal('snake_case').default('snake_case'),
    snippets: z.string().max(30000).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const path of [
      v.entityDirectory,
      v.migrationDirectory,
      v.dataSourcePath,
      v.registrationPath,
      v.compiledDataSource,
    ])
      if (
        !/^[a-zA-Z0-9_./-]+$/.test(path) ||
        path.startsWith('/') ||
        path.split('/').includes('..')
      )
        ctx.addIssue({ code: 'custom', message: 'Paths must be safe repository-relative paths' });
  });
export type Conventions = z.infer<typeof conventionsSchema>;
export const bedrockSettingsSchema = z
  .object({
    enabled: z.boolean(),
    region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
    authMode: z.enum(['chain', 'explicit']),
    accessKeyId: z.string().max(200).optional(),
    secretAccessKey: z.string().max(500).optional(),
    sessionToken: z.string().max(5000).optional(),
    inferenceProfileArn: z
      .string()
      .regex(
        /^arn:aws[a-z-]*:bedrock:[a-z0-9-]+:\d{12}:(inference-profile|application-inference-profile)\/.+$/,
      ),
    timeoutMs: z.number().int().min(1000).max(120000),
    retries: z.number().int().min(0).max(5),
    maxTokens: z.number().int().min(100).max(16000),
    shareSamples: z.boolean(),
    maskSamples: z.boolean(),
  })
  .strict();
export type BedrockSettings = z.infer<typeof bedrockSettingsSchema>;
export const proposalStates = [
  'draft',
  'approved',
  'handoff_ready',
  'awaiting_deployment',
  'ready',
] as const;
export interface User {
  id: string;
  email: string;
  role: Role;
}
export interface Dataset {
  id: string;
  name: string;
  status: string;
  contract: Contract;
  proposalId: string | null;
  verification: unknown;
  createdAt: string;
}
export interface Proposal {
  id: string;
  name: string;
  status: string;
  version: number;
  contract: Contract;
  profile: Profile | null;
  uploadId: string | null;
  createdAt: string;
}
export interface Upload {
  id: string;
  originalName: string;
  bytes: number;
  profile: Profile | null;
  createdAt: string;
}
export interface ImportJob {
  id: string;
  datasetId: string;
  uploadId: string;
  status: string;
  mapping: Mapping;
  counts: Counts;
  errors: RowError[];
  createdAt: string;
  finishedAt: string | null;
  failure: string | null;
}

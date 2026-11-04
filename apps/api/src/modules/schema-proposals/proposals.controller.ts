import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  BadRequestException,
  NotFoundException,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  contractSchema,
  conventionsSchema,
  type Contract,
  type Reference,
} from '@platform/contracts';
import { zipSync, strToU8 } from 'fflate';
import { Allowed } from '../../common/guards/access.guard';
import { parse, uuid } from '../../common/validation/parse';
import { Database } from '../../database/database.module';
import { requestUser } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { generateArtifacts, contractHash, TEMPLATE_VERSION } from '../developer-handoff/templates';
const createSchema = z
  .object({
    name: z.string().min(1).max(150),
    uploadId: z.string().uuid().optional(),
    contract: contractSchema,
  })
  .strict();
const updateSchema = z
  .object({ name: z.string().min(1).max(150), contract: contractSchema })
  .strict();
const rowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  version: z.number().int(),
  contract: contractSchema,
  profile: z.unknown(),
  upload_id: z.string().nullable(),
  created_at: z.date(),
});
function present(row: unknown): unknown {
  const p = rowSchema.parse(row);
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    version: p.version,
    contract: p.contract,
    profile: p.profile,
    uploadId: p.upload_id,
    createdAt: p.created_at,
  };
}
@Allowed('admin')
@Controller('proposals')
export class ProposalsController {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}
  @Get() async list(): Promise<unknown> {
    return (
      await this.db.query('SELECT * FROM platform.schema_proposals ORDER BY created_at DESC')
    ).map(present);
  }
  @Get(':id') async get(@Param('id') raw: string): Promise<unknown> {
    const rows = await this.db.query('SELECT * FROM platform.schema_proposals WHERE id=$1', [
      uuid(raw),
    ]);
    if (!rows[0]) throw new NotFoundException();
    return present(rows[0]);
  }
  @Post() async create(@Body() input: unknown, @Req() req: Request): Promise<unknown> {
    const value = parse(createSchema, input);
    const actor = requestUser(req).id;
    let profile: unknown = null;
    if (value.uploadId) {
      const uploads = await this.db.query('SELECT profile FROM platform.uploads WHERE id=$1', [
        value.uploadId,
      ]);
      if (!uploads[0]) throw new BadRequestException('Upload not found');
      profile = uploads[0].profile;
    }
    const contract = { ...value.contract, version: 1 };
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'INSERT INTO platform.schema_proposals(name,version,contract,profile,upload_id,created_by) VALUES($1,1,$2,$3,$4,$5) RETURNING *',
        [
          value.name,
          JSON.stringify(contract),
          profile ? JSON.stringify(profile) : null,
          value.uploadId ?? null,
          actor,
        ],
      );
      const row = rowSchema.parse(result.rows[0]);
      await client.query(
        'INSERT INTO platform.proposal_versions(proposal_id,version,contract,created_by) VALUES($1,1,$2,$3)',
        [row.id, JSON.stringify(contract), actor],
      );
      await client.query('COMMIT');
      await this.audit.write(actor, 'proposal.created', row.id, { version: 1 });
      return present(row);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  @Patch(':id') async update(
    @Param('id') raw: string,
    @Body() input: unknown,
    @Req() req: Request,
  ): Promise<unknown> {
    const id = uuid(raw);
    const value = parse(updateSchema, input);
    const actor = requestUser(req).id;
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        'SELECT * FROM platform.schema_proposals WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!current.rows[0]) throw new NotFoundException();
      const old = rowSchema.parse(current.rows[0]);
      if (old.status !== 'draft')
        throw new BadRequestException(
          'Approved proposals are immutable; create a new proposal for changes',
        );
      const version = old.version + 1;
      const contract = { ...value.contract, version };
      const result = await client.query(
        'UPDATE platform.schema_proposals SET name=$2,version=$3,contract=$4 WHERE id=$1 RETURNING *',
        [id, value.name, version, JSON.stringify(contract)],
      );
      await client.query(
        'INSERT INTO platform.proposal_versions(proposal_id,version,contract,created_by) VALUES($1,$2,$3,$4)',
        [id, version, JSON.stringify(contract), actor],
      );
      await client.query('COMMIT');
      await this.audit.write(actor, 'proposal.revised', id, { version });
      return present(result.rows[0]);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  @Post(':id/approve') async approve(
    @Param('id') raw: string,
    @Req() req: Request,
  ): Promise<unknown> {
    const id = uuid(raw);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'SELECT * FROM platform.schema_proposals WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!result.rows[0]) throw new NotFoundException();
      const p = rowSchema.parse(result.rows[0]);
      if (p.status !== 'draft')
        throw new BadRequestException('Only draft proposals can be approved');
      await this.checkReferences(p.contract);
      await client.query("UPDATE platform.schema_proposals SET status='approved' WHERE id=$1", [
        id,
      ]);
      for (const reference of p.contract.references)
        await client.query(
          'INSERT INTO platform.relationship_proposals(proposal_id,proposal_version,reference,approved) VALUES($1,$2,$3,true)',
          [id, p.version, JSON.stringify(reference)],
        );
      await client.query('COMMIT');
      await this.audit.write(requestUser(req).id, 'proposal.approved', id, { version: p.version });
      return present({ ...p, status: 'approved' });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  @Post(':id/handoff') async handoff(
    @Param('id') raw: string,
    @Req() req: Request,
  ): Promise<unknown> {
    const id = uuid(raw);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'SELECT * FROM platform.schema_proposals WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!result.rows[0]) throw new NotFoundException();
      const p = rowSchema.parse(result.rows[0]);
      if (!['approved', 'handoff_ready', 'awaiting_deployment'].includes(p.status))
        throw new BadRequestException('Approve the proposal before generating a handoff');
      const existing = await client.query<Record<string, unknown>>(
        'SELECT * FROM platform.developer_handoffs WHERE proposal_id=$1 AND proposal_version=$2 ORDER BY created_at DESC LIMIT 1',
        [id, p.version],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return presentHandoff(existing.rows[0]);
      }
      const settings = await client.query<{ value: unknown }>(
        "SELECT value FROM platform.settings WHERE key='repository'",
      );
      const conventions = conventionsSchema.parse(settings.rows[0]?.value ?? {});
      const artifacts = generateArtifacts(p.contract, conventions, id, Date.now());
      const inserted = await client.query<Record<string, unknown>>(
        'INSERT INTO platform.developer_handoffs(proposal_id,proposal_version,template_version,artifacts,contract_hash) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [id, p.version, TEMPLATE_VERSION, JSON.stringify(artifacts), contractHash(p.contract)],
      );
      await client.query(
        "UPDATE platform.schema_proposals SET status='awaiting_deployment' WHERE id=$1",
        [id],
      );
      await client.query(
        "INSERT INTO platform.datasets(name,status,contract,proposal_id) VALUES($1,'awaiting_deployment',$2,$3)",
        [p.name, JSON.stringify(p.contract), id],
      );
      await client.query('COMMIT');
      await this.audit.write(requestUser(req).id, 'handoff.generated', id, {
        version: p.version,
        templateVersion: TEMPLATE_VERSION,
      });
      return presentHandoff(inserted.rows[0] ?? {});
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async checkReferences(contract: Contract): Promise<void> {
    const datasets = await this.db.query('SELECT id,contract,status FROM platform.datasets');
    const all = datasets.map((d) => ({
      id: z.string().parse(d.id),
      contract: contractSchema.parse(d.contract),
      status: z.string().parse(d.status),
    }));
    for (const ref of contract.references) {
      const target = all.find((d) => d.id === ref.targetDatasetId);
      if (!target || target.contract.table !== ref.targetTable)
        throw new BadRequestException('Reference target dataset does not match registered table');
      if (target.status !== 'ready') throw new BadRequestException('Verify parent dataset first');
      if (
        target.contract.uniqueKey.length !== 1 ||
        target.contract.uniqueKey[0] !== ref.targetColumn
      )
        throw new BadRequestException('Phase 1 references require a single unique target key');
      const targetCol = target.contract.columns.find((c) => c.name === ref.targetColumn);
      const source = contract.columns.find((c) => c.name === ref.column);
      if (
        !targetCol ||
        !source ||
        targetCol.type !== source.type ||
        source.nullable !== ref.nullable
      )
        throw new BadRequestException('Reference types or nullability differ');
    }
    const graph = new Map<string, Reference[]>(
      all.map((d) => [d.contract.table, d.contract.references]),
    );
    graph.set(contract.table, contract.references);
    const walk = (table: string, path: Set<string>): void => {
      if (path.has(table))
        throw new BadRequestException(
          'Reference cycle detected. Design an explicit staged deployment; constraints remain enabled.',
        );
      const next = new Set(path);
      next.add(table);
      for (const ref of graph.get(table) ?? []) walk(ref.targetTable, next);
    };
    walk(contract.table, new Set());
  }
}
function presentHandoff(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    proposalVersion: row.proposal_version,
    templateVersion: row.template_version,
    artifacts: row.artifacts,
    contractHash: row.contract_hash,
    createdAt: row.created_at,
  };
}
@Allowed('admin')
@Controller('handoffs')
export class HandoffsController {
  constructor(private readonly db: Database) {}
  @Get() async list(): Promise<unknown> {
    return (
      await this.db.query('SELECT * FROM platform.developer_handoffs ORDER BY created_at DESC')
    ).map(presentHandoff);
  }
  @Get(':id') async get(@Param('id') raw: string): Promise<unknown> {
    const rows = await this.db.query('SELECT * FROM platform.developer_handoffs WHERE id=$1', [
      uuid(raw),
    ]);
    if (!rows[0]) throw new NotFoundException();
    return presentHandoff(rows[0]);
  }
  @Get(':id/download') async download(
    @Param('id') raw: string,
    @Res() res: Response,
  ): Promise<void> {
    const id = uuid(raw);
    const rows = await this.db.query('SELECT * FROM platform.developer_handoffs WHERE id=$1', [id]);
    if (!rows[0]) throw new NotFoundException();
    const artifacts = z
      .array(z.object({ path: z.string(), content: z.string() }))
      .parse(rows[0].artifacts);
    const entries: Record<string, Uint8Array> = {};
    for (const a of artifacts) {
      if (a.path.startsWith('/') || a.path.split('/').includes('..'))
        throw new BadRequestException('Unsafe artifact path');
      entries[a.path] = strToU8(a.content);
    }
    res
      .type('application/zip')
      .attachment(`handoff-${id}.zip`)
      .send(Buffer.from(zipSync(entries)));
  }
}

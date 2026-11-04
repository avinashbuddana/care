import { Controller, Get, Param, Post, Query, Req, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { Database } from '../../database/database.module';
import { AuthService, requestUser } from '../auth/auth.service';
import { Allowed } from '../../common/guards/access.guard';
import { parse, uuid, pagination } from '../../common/validation/parse';
import { DatasetsService } from './datasets.service';
import { quote } from '../developer-handoff/templates';
import { z } from 'zod';
import { profileSchema } from '@platform/contracts';
import { compareProfile, type Compatibility } from '@platform/ingestion';
@Controller('datasets')
export class DatasetsController {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    private readonly datasets: DatasetsService,
  ) {}
  @Get() async list(@Req() req: Request): Promise<unknown> {
    const user = requestUser(req);
    const rows =
      user.role === 'admin'
        ? await this.db.query('SELECT * FROM platform.datasets ORDER BY created_at DESC')
        : await this.db.query(
            'SELECT d.* FROM platform.datasets d JOIN platform.dataset_grants g ON g.dataset_id=d.id WHERE g.user_id=$1 ORDER BY d.created_at DESC',
            [user.id],
          );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      contract: r.contract,
      proposalId: r.proposal_id,
      verification: r.verification,
      createdAt: r.created_at,
    }));
  }
  @Get(':id') async get(@Param('id') raw: string, @Req() req: Request): Promise<unknown> {
    const id = uuid(raw);
    await this.auth.dataset(requestUser(req), id);
    const d = await this.datasets.get(id);
    return {
      id: d.id,
      name: d.name,
      status: d.status,
      contract: d.contract,
      proposalId: d.proposal_id,
      verification: d.verification,
      createdAt: d.created_at,
    };
  }
  /** Compares an upload with the approved import contract; mismatches need a new proposal. */
  @Allowed('admin', 'operator')
  @Get(':id/compatibility')
  async compatibility(
    @Param('id') raw: string,
    @Query('uploadId') rawUpload: unknown,
    @Req() req: Request,
  ): Promise<Compatibility> {
    const id = uuid(raw);
    const user = requestUser(req);
    await this.auth.dataset(user, id);
    const dataset = await this.datasets.get(id);
    const rows = await this.db.query(
      'SELECT uploaded_by,profile FROM platform.uploads WHERE id=$1',
      [uuid(rawUpload)],
    );
    const upload = rows[0];
    if (!upload || (user.role !== 'admin' && upload.uploaded_by !== user.id))
      throw new BadRequestException('Upload not available');
    return compareProfile(dataset.contract, profileSchema.parse(upload.profile));
  }
  @Allowed('admin') @Post(':id/verify') verify(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.datasets.verify(uuid(id), requestUser(req).id);
  }
  @Get(':id/records') async records(
    @Param('id') raw: string,
    @Query() input: unknown,
    @Req() req: Request,
  ): Promise<unknown> {
    const id = uuid(raw);
    await this.auth.dataset(requestUser(req), id);
    const d = await this.datasets.get(id);
    if (d.status !== 'ready') throw new BadRequestException('Dataset is not verified');
    const p = parse(
      pagination.extend({
        sort: z.string().default('created_at'),
        direction: z.enum(['asc', 'desc']).default('desc'),
        filter: z.string().max(200).default(''),
      }),
      input,
    );
    const columns = ['id', 'created_at', 'updated_at', ...d.contract.columns.map((c) => c.name)];
    if (!columns.includes(p.sort)) throw new BadRequestException('Unknown sort column');
    const filters = p.filter
      ? ` WHERE ${d.contract.columns.map((c) => `${quote(c.name)}::text ILIKE $1`).join(' OR ')}`
      : '';
    const values: unknown[] = p.filter
      ? [`%${p.filter.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`]
      : [];
    const totals = await this.db.query(
      `SELECT count(*)::integer AS total FROM app.${quote(d.contract.table)}${filters}`,
      values,
    );
    const rows = await this.db.query(
      `SELECT ${columns.map(quote).join(',')} FROM app.${quote(d.contract.table)}${filters} ORDER BY ${quote(p.sort)} ${p.direction === 'asc' ? 'ASC' : 'DESC'},id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, p.pageSize, (p.page - 1) * p.pageSize],
    );
    return { rows, total: totals[0]?.total ?? 0, page: p.page, pageSize: p.pageSize };
  }
}

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  BadRequestException,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { mappingSchema } from '@platform/contracts';
import { redisConnection } from '@platform/ingestion';
import { Database } from '../../database/database.module';
import { AuthService, requestUser } from '../auth/auth.service';
import { DatasetsService } from '../datasets/datasets.service';
import { Allowed } from '../../common/guards/access.guard';
import { parse, uuid } from '../../common/validation/parse';
import { loadEnvironment } from '../../config/environment';
import { AuditService } from '../audit/audit.service';
const newImport = z
  .object({ datasetId: z.string().uuid(), uploadId: z.string().uuid(), mapping: mappingSchema })
  .strict();
function present(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    uploadId: row.upload_id,
    status: row.status,
    mapping: row.mapping,
    mappingVersion: row.mapping_version,
    contract: row.contract,
    counts: row.counts,
    errors: row.errors,
    createdBy: row.created_by,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    failure: row.failure,
  };
}
@Controller('imports')
@Allowed('admin', 'operator')
export class ImportsController implements OnModuleDestroy {
  private readonly queue: Queue;
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    private readonly datasets: DatasetsService,
    private readonly audit: AuditService,
  ) {
    this.queue = new Queue('imports', {
      connection: redisConnection(loadEnvironment().REDIS_URL),
    });
  }
  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
  @Get() async list(@Req() req: Request): Promise<unknown> {
    const user = requestUser(req);
    const rows =
      user.role === 'admin'
        ? await this.db.query(
            'SELECT * FROM platform.import_jobs ORDER BY created_at DESC LIMIT 200',
          )
        : await this.db.query(
            'SELECT j.* FROM platform.import_jobs j JOIN platform.dataset_grants g ON g.dataset_id=j.dataset_id WHERE g.user_id=$1 AND g.can_import ORDER BY j.created_at DESC LIMIT 200',
            [user.id],
          );
    return rows.map(present);
  }
  @Get(':id') async get(@Param('id') raw: string, @Req() req: Request): Promise<unknown> {
    const rows = await this.db.query('SELECT * FROM platform.import_jobs WHERE id=$1', [uuid(raw)]);
    if (!rows[0]) throw new NotFoundException();
    await this.auth.dataset(requestUser(req), z.string().parse(rows[0].dataset_id), true);
    return present(rows[0]);
  }
  @Post() async create(@Body() input: unknown, @Req() req: Request): Promise<unknown> {
    const value = parse(newImport, input);
    const user = requestUser(req);
    await this.auth.dataset(user, value.datasetId, true);
    const dataset = await this.datasets.get(value.datasetId);
    if (dataset.status !== 'ready')
      throw new BadRequestException(
        'Dataset is not ready for import; deploy and verify the approved schema first',
      );
    const verification = await this.datasets.verify(value.datasetId, user.id);
    if (!verification.ready) throw new BadRequestException(verification.errors);
    const uploads = await this.db.query(
      'SELECT id,uploaded_by,profile FROM platform.uploads WHERE id=$1',
      [value.uploadId],
    );
    const upload = uploads[0];
    if (!upload || (user.role !== 'admin' && upload.uploaded_by !== user.id))
      throw new BadRequestException('Upload not available');
    const headers = z
      .object({ columns: z.array(z.object({ source: z.string() })) })
      .parse(upload.profile)
      .columns.map((c) => c.source);
    for (const column of dataset.contract.columns) {
      const source = value.mapping.columns[column.name];
      if (source === undefined && !column.nullable && column.default === 'none')
        throw new BadRequestException(`Missing mapping for required column ${column.name}`);
      if (source !== undefined && !headers.includes(source))
        throw new BadRequestException(`Unknown CSV header ${source}`);
    }
    if (
      Object.keys(value.mapping.columns).some(
        (name) => !dataset.contract.columns.some((c) => c.name === name),
      )
    )
      throw new BadRequestException('Mapping contains an unknown target column');
    const mapped = Object.values(value.mapping.columns);
    const ignored = value.mapping.ignored;
    if (
      new Set(mapped).size !== mapped.length ||
      ignored.some((h) => mapped.includes(h) || !headers.includes(h)) ||
      headers.some((h) => !mapped.includes(h) && !ignored.includes(h))
    )
      throw new BadRequestException(
        'Map or explicitly ignore every CSV header; do not map a header twice',
      );
    const client = await this.db.pool.connect();
    let created: Record<string, unknown> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [value.datasetId]);
      const versions = await client.query<{ version: unknown }>(
        'SELECT COALESCE(max(version),0)+1 AS version FROM platform.mapping_versions WHERE dataset_id=$1',
        [value.datasetId],
      );
      const version = z.number().parse(versions.rows[0]?.version);
      await client.query(
        'INSERT INTO platform.mapping_versions(dataset_id,version,mapping) VALUES($1,$2,$3)',
        [value.datasetId, version, JSON.stringify(value.mapping)],
      );
      const rows = await client.query<Record<string, unknown>>(
        "INSERT INTO platform.import_jobs(dataset_id,upload_id,status,mapping,mapping_version,contract,created_by) VALUES($1,$2,'queued_validation',$3,$4,$5,$6) RETURNING *",
        [
          value.datasetId,
          value.uploadId,
          JSON.stringify(value.mapping),
          version,
          JSON.stringify(dataset.contract),
          user.id,
        ],
      );
      created = rows.rows[0];
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (!created) throw new Error('Import creation failed');
    const jobId = z.string().parse(created.id);
    await this.enqueue(jobId, 'queued_validation');
    await this.audit.write(user.id, 'import.validation_queued', jobId, {
      datasetId: value.datasetId,
    });
    return present(created);
  }
  @Post(':id/start') async start(@Param('id') raw: string, @Req() req: Request): Promise<unknown> {
    const id = uuid(raw);
    const rows = await this.db.query('SELECT * FROM platform.import_jobs WHERE id=$1', [id]);
    const job = rows[0];
    if (!job) throw new NotFoundException();
    const datasetId = z.string().parse(job.dataset_id);
    await this.auth.dataset(requestUser(req), datasetId, true);
    if (job.status !== 'validated')
      throw new BadRequestException('Only fully validated imports can be published');
    const check = await this.datasets.verify(datasetId, requestUser(req).id);
    if (!check.ready) throw new BadRequestException(check.errors);
    const updated = await this.db.query(
      "UPDATE platform.import_jobs SET status='queued_publish' WHERE id=$1 AND status='validated' RETURNING *",
      [id],
    );
    if (!updated[0]) throw new BadRequestException('Import state changed');
    await this.enqueue(id, 'queued_publish');
    await this.audit.write(requestUser(req).id, 'import.publication_queued', id);
    return present(updated[0]);
  }
  @Get(':id/errors.csv') async errors(
    @Param('id') raw: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const id = uuid(raw);
    const jobs = await this.db.query(
      'SELECT dataset_id,errors FROM platform.import_jobs WHERE id=$1',
      [id],
    );
    if (!jobs[0]) throw new NotFoundException();
    await this.auth.dataset(requestUser(req), z.string().parse(jobs[0].dataset_id), true);
    const errors = z
      .array(
        z.object({
          row: z.number(),
          field: z.string(),
          value: z.string().nullable(),
          reason: z.string(),
        }),
      )
      .parse(jobs[0].errors);
    const safe = (value: string): string =>
      `"${(/^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
    res
      .type('text/csv')
      .attachment(`errors-${id}.csv`)
      .send(
        'row,field,value,reason\r\n' +
          errors
            .map((e) => [String(e.row), e.field, e.value ?? '', e.reason].map(safe).join(','))
            .join('\r\n'),
      );
  }
  private async enqueue(id: string, status: string): Promise<void> {
    // DB state is durable. Worker reconciliation repairs Redis delivery if queue publication fails.
    await this.queue
      .add(
        'process',
        { jobId: id },
        {
          jobId: `${id}-${status}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      )
      .catch(() => undefined);
  }
}

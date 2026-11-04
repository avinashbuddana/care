import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Pool } from 'pg';
import { z } from 'zod';
import { jobPayloadSchema } from '@platform/contracts';
import { runImport } from '@platform/ingestion';
import { config } from '../config/config';
@Injectable()
export class Database extends Pool implements OnModuleDestroy {
  constructor() {
    super({
      connectionString: config.DATABASE_URL,
      max: config.WORKER_POOL_MAX,
      statement_timeout: config.QUERY_TIMEOUT_MS,
      application_name: 'powerbridge-worker',
    });
  }
  async onModuleDestroy(): Promise<void> {
    await this.end();
  }
}
@Processor('imports', { concurrency: config.WORKER_CONCURRENCY })
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);
  constructor(private readonly database: Database) {
    super();
  }
  async process(job: Job<unknown>): Promise<void> {
    const payload = jobPayloadSchema.parse(job.data);
    await runImport(this.database, payload.jobId, config.STORAGE_ROOT);
  }
  @OnWorkerEvent('failed')
  async failed(job: Job<unknown> | undefined): Promise<void> {
    if (!job) return;
    const payload = jobPayloadSchema.safeParse(job.data);
    if (!payload.success) return;
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await this.database.query(
        "UPDATE platform.import_jobs SET status='failed',finished_at=now() WHERE id=$1 AND status<>'completed'",
        [payload.data.jobId],
      );
      await this.database.query(
        "INSERT INTO platform.audit_events(action,resource_id,details) VALUES ('import.failed',$1,'{}'::jsonb)",
        [payload.data.jobId],
      );
      this.logger.error(JSON.stringify({ event: 'import.exhausted', jobId: payload.data.jobId }));
    }
  }
}
@Injectable()
export class QueueRecovery implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private recovering = false;
  private stopped = false;
  private inflight: Promise<void> | undefined;
  private readonly logger = new Logger(QueueRecovery.name);
  constructor(
    private readonly database: Database,
    @InjectQueue('imports') private readonly queue: Queue,
  ) {}
  async onModuleInit(): Promise<void> {
    await this.recover();
    this.timer = setInterval(() => {
      this.inflight = this.recover().catch(() => {
        this.logger.error('Queue reconciliation failed; will retry.');
      });
    }, 30000);
  }
  private async recover(): Promise<void> {
    if (this.recovering || this.stopped) return;
    this.recovering = true;
    try {
      const jobs = z
        .array(
          z.object({
            id: z.string().uuid(),
            status: z.enum(['queued_validation', 'queued_publish', 'validating', 'publishing']),
          }),
        )
        .parse(
          (
            await this.database.query(
              "SELECT id,status FROM platform.import_jobs WHERE status IN ('queued_validation','queued_publish','validating','publishing') ORDER BY created_at LIMIT 1000",
            )
          ).rows,
        );
      for (const job of jobs) {
        const stage =
          job.status === 'queued_publish' || job.status === 'publishing'
            ? 'queued_publish'
            : 'queued_validation';
        await this.queue.add(
          'process',
          { jobId: job.id },
          {
            jobId: `${job.id}-${stage}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: 1000,
          },
        );
      }
    } finally {
      this.recovering = false;
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.inflight;
  }
}

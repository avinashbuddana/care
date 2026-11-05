import { Global, Module, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { loadEnvironment } from '../config/environment';
import type { QueryResultRow } from 'pg';
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool: Pool;
  constructor() {
    const env = loadEnvironment();
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      statement_timeout: 30000,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
  }
  async query<R extends QueryResultRow = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<R[]> {
    const result = await this.pool.query<R>(text, values);
    return result.rows;
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}

import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { platformEntities } from './entities/platform';
import { Department } from './entities/department';
import { Platform1760000000000 } from './migrations/1760000000000-Platform';
import { Departments1760000001000 } from './migrations/1760000001000-Departments';
import { Reporting1760000002000 } from './migrations/1760000002000-Reporting';
import { z } from 'zod';
export const dataSource = new DataSource({
  type: 'postgres',
  schema: 'public',
  url: z.string().url().parse(process.env.DATABASE_URL),
  entities: [...platformEntities, Department],
  migrations: [Platform1760000000000, Departments1760000001000, Reporting1760000002000],
  synchronize: false,
  migrationsRun: false,
  migrationsTableName: 'typeorm_migrations',
  extra: { max: 3, statement_timeout: 30000, connectionTimeoutMillis: 10000 },
});

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Least-privilege reporting access for Superset. reporting_reader may read approved views in the
 * reporting schema only; it gets no privileges on platform, app or staging. Views execute with the
 * migration owner's privileges, so readers never need direct access to business tables.
 * The LOGIN password is set outside migrations (infra/docker/postgres-init.sh or your DBA).
 */
export class Reporting1760000002000 implements MigrationInterface {
  name = 'Reporting1760000002000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_reader') THEN
          CREATE ROLE reporting_reader NOLOGIN;
        END IF;
      END $$;
      REVOKE ALL ON SCHEMA platform, app, staging FROM reporting_reader;
      GRANT USAGE ON SCHEMA reporting TO reporting_reader;
      GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_reader;
      ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO reporting_reader;
      CREATE VIEW reporting.synthetic_department_headcount AS
        SELECT department_code, department_name, headcount, 'SYNTHETIC'::text AS data_origin
        FROM (VALUES
          ('SYN-HR', 'Synthetic Human Resources', 12),
          ('SYN-FIN', 'Synthetic Finance', 8),
          ('SYN-OPS', 'Synthetic Operations', 31),
          ('SYN-IT', 'Synthetic Information Technology', 17)
        ) AS t(department_code, department_name, headcount);
      COMMENT ON VIEW reporting.synthetic_department_headcount IS
        'SYNTHETIC example data for initial Superset charts only. Not business data. Remove once real reporting views exist.';
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP VIEW reporting.synthetic_department_headcount;
      ALTER DEFAULT PRIVILEGES IN SCHEMA reporting REVOKE SELECT ON TABLES FROM reporting_reader;
      REVOKE SELECT ON ALL TABLES IN SCHEMA reporting FROM reporting_reader;
      REVOKE USAGE ON SCHEMA reporting FROM reporting_reader;
    `);
  }
}

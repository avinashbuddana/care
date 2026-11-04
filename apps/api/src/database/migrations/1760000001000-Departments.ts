import type { MigrationInterface, QueryRunner } from 'typeorm';
import { departmentContract } from '../registry';
export class Departments1760000001000 implements MigrationInterface {
  name = 'Departments1760000001000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE app.departments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_department_code text NOT NULL UNIQUE,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
  CREATE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW IS DISTINCT FROM OLD THEN NEW.updated_at=clock_timestamp(); END IF; RETURN NEW; END $$;
  CREATE TRIGGER departments_updated BEFORE UPDATE ON app.departments FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
  CREATE VIEW reporting.departments AS SELECT source_department_code,name FROM app.departments;`);
    await q.query(
      "INSERT INTO platform.datasets(id,name,status,contract) VALUES('10000000-0000-4000-8000-000000000001','Departments (synthetic example)','awaiting_deployment',$1)",
      [JSON.stringify(departmentContract)],
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DELETE FROM platform.datasets WHERE id='10000000-0000-4000-8000-000000000001'; DROP VIEW reporting.departments; DROP TABLE app.departments; DROP FUNCTION app.touch_updated_at()",
    );
  }
}

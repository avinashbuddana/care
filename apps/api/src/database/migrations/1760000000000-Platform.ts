import type { MigrationInterface, QueryRunner } from 'typeorm';
export class Platform1760000000000 implements MigrationInterface {
  name = 'Platform1760000000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE SCHEMA IF NOT EXISTS platform; CREATE SCHEMA IF NOT EXISTS app; CREATE SCHEMA IF NOT EXISTS staging; CREATE SCHEMA IF NOT EXISTS reporting;
  CREATE TABLE platform.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL UNIQUE,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('admin','operator','viewer')),created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE platform.sessions(hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES platform.users ON DELETE CASCADE,expires_at timestamptz NOT NULL);
  CREATE INDEX ON platform.sessions(expires_at);
  CREATE TABLE platform.schema_proposals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,status text NOT NULL DEFAULT 'draft',version integer NOT NULL,contract jsonb NOT NULL,profile jsonb,upload_id uuid,created_by uuid NOT NULL REFERENCES platform.users,created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE platform.proposal_versions(proposal_id uuid NOT NULL REFERENCES platform.schema_proposals,version integer NOT NULL,contract jsonb NOT NULL,created_by uuid NOT NULL REFERENCES platform.users,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(proposal_id,version));
  CREATE FUNCTION platform.immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Proposal versions are immutable'; END $$;
  CREATE TRIGGER immutable_proposal_version BEFORE UPDATE OR DELETE ON platform.proposal_versions FOR EACH ROW EXECUTE FUNCTION platform.immutable_version();
  CREATE TABLE platform.relationship_proposals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),proposal_id uuid NOT NULL REFERENCES platform.schema_proposals,proposal_version integer NOT NULL,reference jsonb NOT NULL,approved boolean NOT NULL DEFAULT false);
  CREATE TABLE platform.datasets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,status text NOT NULL DEFAULT 'awaiting_deployment',contract jsonb NOT NULL,proposal_id uuid REFERENCES platform.schema_proposals,verification jsonb,created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE platform.dataset_grants(user_id uuid NOT NULL REFERENCES platform.users ON DELETE CASCADE,dataset_id uuid NOT NULL REFERENCES platform.datasets ON DELETE CASCADE,can_import boolean NOT NULL DEFAULT false,PRIMARY KEY(user_id,dataset_id));
  CREATE TABLE platform.settings(key text PRIMARY KEY,value jsonb NOT NULL,secret text);
  CREATE TABLE platform.developer_handoffs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),proposal_id uuid NOT NULL REFERENCES platform.schema_proposals,proposal_version integer NOT NULL,template_version integer NOT NULL,artifacts jsonb NOT NULL,contract_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE platform.uploads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),original_name text NOT NULL,storage_key text NOT NULL UNIQUE,bytes bigint NOT NULL,profile jsonb,uploaded_by uuid NOT NULL REFERENCES platform.users,created_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE platform.schema_proposals ADD FOREIGN KEY(upload_id) REFERENCES platform.uploads;
  CREATE TABLE platform.mapping_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dataset_id uuid NOT NULL REFERENCES platform.datasets,version integer NOT NULL,mapping jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(dataset_id,version));
  CREATE TABLE platform.import_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dataset_id uuid NOT NULL REFERENCES platform.datasets,upload_id uuid NOT NULL REFERENCES platform.uploads,status text NOT NULL,mapping jsonb NOT NULL,mapping_version integer NOT NULL,contract jsonb NOT NULL,counts jsonb NOT NULL DEFAULT '{"received":0,"valid":0,"rejected":0,"inserted":0,"updated":0,"unchanged":0}',errors jsonb NOT NULL DEFAULT '[]',created_by uuid NOT NULL REFERENCES platform.users,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,failure text);
  CREATE INDEX ON platform.import_jobs(dataset_id,created_at DESC);
  CREATE TABLE platform.import_row_errors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES platform.import_jobs ON DELETE CASCADE,row integer NOT NULL,field text NOT NULL,value text,reason text NOT NULL);
  CREATE INDEX ON platform.import_row_errors(job_id,row);
  CREATE TABLE platform.audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid REFERENCES platform.users,action text NOT NULL,resource_id text,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX ON platform.audit_events(created_at DESC);`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP SCHEMA platform CASCADE; DROP SCHEMA staging CASCADE; DROP SCHEMA reporting CASCADE; DROP SCHEMA app CASCADE',
    );
  }
}

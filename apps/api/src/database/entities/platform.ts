import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type {
  Contract,
  Mapping,
  Counts,
  RowError,
  Profile,
  Role,
  Artifact,
} from '@platform/contracts';

// These entities mirror the repository migrations exactly (constraint and index names included)
// so `migration:generate` reports only genuinely new changes, never drops platform constraints.

@Entity({ schema: 'platform', name: 'users' })
@Unique('users_email_key', ['email'])
@Check('users_role_check', `role IN ('admin','operator','viewer')`)
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('text') email!: string;
  @Column('text', { name: 'password_hash', select: false }) passwordHash!: string;
  @Column('text') role!: Role;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ schema: 'platform', name: 'sessions' })
@Index('sessions_expires_at_idx', ['expiresAt'])
export class SessionEntity {
  @Column('text', { primary: true }) hash!: string;
  @Column('uuid', { name: 'user_id' }) userId!: string;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'sessions_user_id_fkey' })
  user?: UserEntity;
  @Column('timestamptz', { name: 'expires_at' }) expiresAt!: Date;
}

@Entity({ schema: 'platform', name: 'uploads' })
@Unique('uploads_storage_key_key', ['storageKey'])
export class UploadEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('text', { name: 'original_name' }) originalName!: string;
  @Column('text', { name: 'storage_key', select: false }) storageKey!: string;
  @Column('bigint') bytes!: string;
  @Column('jsonb', { nullable: true }) profile!: Profile | null;
  @Column('uuid', { name: 'uploaded_by' }) uploadedBy!: string;
  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'uploaded_by', foreignKeyConstraintName: 'uploads_uploaded_by_fkey' })
  uploader?: UserEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ schema: 'platform', name: 'schema_proposals' })
export class ProposalEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('text') name!: string;
  @Column('text', { default: 'draft' }) status!: string;
  @Column('integer') version!: number;
  @Column('jsonb') contract!: Contract;
  @Column('jsonb', { nullable: true }) profile!: Profile | null;
  @Column('uuid', { name: 'upload_id', nullable: true }) uploadId!: string | null;
  @ManyToOne(() => UploadEntity)
  @JoinColumn({ name: 'upload_id', foreignKeyConstraintName: 'schema_proposals_upload_id_fkey' })
  upload?: UploadEntity;
  @Column('uuid', { name: 'created_by' }) createdBy!: string;
  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'schema_proposals_created_by_fkey' })
  creator?: UserEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ schema: 'platform', name: 'proposal_versions' })
export class ProposalVersionEntity {
  @Column('uuid', { primary: true, name: 'proposal_id' }) proposalId!: string;
  @ManyToOne(() => ProposalEntity)
  @JoinColumn({
    name: 'proposal_id',
    foreignKeyConstraintName: 'proposal_versions_proposal_id_fkey',
  })
  proposal?: ProposalEntity;
  @Column('integer', { primary: true }) version!: number;
  @Column('jsonb') contract!: Contract;
  @Column('uuid', { name: 'created_by' }) createdBy!: string;
  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'proposal_versions_created_by_fkey' })
  creator?: UserEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ schema: 'platform', name: 'relationship_proposals' })
export class RelationshipProposalEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid', { name: 'proposal_id' }) proposalId!: string;
  @ManyToOne(() => ProposalEntity)
  @JoinColumn({
    name: 'proposal_id',
    foreignKeyConstraintName: 'relationship_proposals_proposal_id_fkey',
  })
  proposal?: ProposalEntity;
  @Column('integer', { name: 'proposal_version' }) proposalVersion!: number;
  @Column('jsonb') reference!: unknown;
  @Column('boolean', { default: false }) approved!: boolean;
}

@Entity({ schema: 'platform', name: 'datasets' })
export class DatasetEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('text') name!: string;
  @Column('text', { default: 'awaiting_deployment' }) status!: string;
  @Column('jsonb') contract!: Contract;
  @Column('uuid', { name: 'proposal_id', nullable: true }) proposalId!: string | null;
  @ManyToOne(() => ProposalEntity)
  @JoinColumn({ name: 'proposal_id', foreignKeyConstraintName: 'datasets_proposal_id_fkey' })
  proposal?: ProposalEntity;
  @Column('jsonb', { nullable: true }) verification!: unknown;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ schema: 'platform', name: 'dataset_grants' })
export class DatasetGrantEntity {
  @Column('uuid', { primary: true, name: 'user_id' }) userId!: string;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'dataset_grants_user_id_fkey' })
  user?: UserEntity;
  @Column('uuid', { primary: true, name: 'dataset_id' }) datasetId!: string;
  @ManyToOne(() => DatasetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dataset_id', foreignKeyConstraintName: 'dataset_grants_dataset_id_fkey' })
  dataset?: DatasetEntity;
  @Column('boolean', { name: 'can_import', default: false }) canImport!: boolean;
}

@Entity({ schema: 'platform', name: 'settings' })
export class SettingEntity {
  @Column('text', { primary: true }) key!: string;
  @Column('jsonb') value!: unknown;
  @Column('text', { nullable: true, select: false }) secret!: string | null;
}

@Entity({ schema: 'platform', name: 'developer_handoffs' })
export class HandoffEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid', { name: 'proposal_id' }) proposalId!: string;
  @ManyToOne(() => ProposalEntity)
  @JoinColumn({
    name: 'proposal_id',
    foreignKeyConstraintName: 'developer_handoffs_proposal_id_fkey',
  })
  proposal?: ProposalEntity;
  @Column('integer', { name: 'proposal_version' }) proposalVersion!: number;
  @Column('integer', { name: 'template_version' }) templateVersion!: number;
  @Column('jsonb') artifacts!: Artifact[];
  @Column('text', { name: 'contract_hash' }) contractHash!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ schema: 'platform', name: 'mapping_versions' })
@Unique('mapping_versions_dataset_id_version_key', ['datasetId', 'version'])
export class MappingVersionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid', { name: 'dataset_id' }) datasetId!: string;
  @ManyToOne(() => DatasetEntity)
  @JoinColumn({ name: 'dataset_id', foreignKeyConstraintName: 'mapping_versions_dataset_id_fkey' })
  dataset?: DatasetEntity;
  @Column('integer') version!: number;
  @Column('jsonb') mapping!: Mapping;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ schema: 'platform', name: 'import_jobs' })
@Index('import_jobs_dataset_id_created_at_idx', ['datasetId', 'createdAt'])
export class ImportJobEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid', { name: 'dataset_id' }) datasetId!: string;
  @ManyToOne(() => DatasetEntity)
  @JoinColumn({ name: 'dataset_id', foreignKeyConstraintName: 'import_jobs_dataset_id_fkey' })
  dataset?: DatasetEntity;
  @Column('uuid', { name: 'upload_id' }) uploadId!: string;
  @ManyToOne(() => UploadEntity)
  @JoinColumn({ name: 'upload_id', foreignKeyConstraintName: 'import_jobs_upload_id_fkey' })
  upload?: UploadEntity;
  @Column('text') status!: string;
  @Column('jsonb') mapping!: Mapping;
  @Column('integer', { name: 'mapping_version' }) mappingVersion!: number;
  @Column('jsonb') contract!: Contract;
  @Column('jsonb', {
    default: () =>
      `'{"valid": 0, "updated": 0, "inserted": 0, "received": 0, "rejected": 0, "unchanged": 0}'`,
  })
  counts!: Counts;
  @Column('jsonb', { default: () => `'[]'` }) errors!: RowError[];
  @Column('uuid', { name: 'created_by' }) createdBy!: string;
  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'created_by', foreignKeyConstraintName: 'import_jobs_created_by_fkey' })
  creator?: UserEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column('timestamptz', { name: 'finished_at', nullable: true }) finishedAt!: Date | null;
  @Column('text', { nullable: true }) failure!: string | null;
}

@Entity({ schema: 'platform', name: 'import_row_errors' })
@Index('import_row_errors_job_id_row_idx', ['jobId', 'row'])
export class ImportRowErrorEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid', { name: 'job_id' }) jobId!: string;
  @ManyToOne(() => ImportJobEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id', foreignKeyConstraintName: 'import_row_errors_job_id_fkey' })
  job?: ImportJobEntity;
  @Column('integer') row!: number;
  @Column('text') field!: string;
  @Column('text', { nullable: true }) value!: string | null;
  @Column('text') reason!: string;
}

@Entity({ schema: 'platform', name: 'audit_events' })
@Index('audit_events_created_at_idx', ['createdAt'])
export class AuditEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid', { name: 'actor_id', nullable: true }) actorId!: string | null;
  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'actor_id', foreignKeyConstraintName: 'audit_events_actor_id_fkey' })
  actor?: UserEntity;
  @Column('text') action!: string;
  @Column('text', { name: 'resource_id', nullable: true }) resourceId!: string | null;
  @Column('jsonb', { default: () => `'{}'` }) details!: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

export const platformEntities = [
  UserEntity,
  SessionEntity,
  DatasetGrantEntity,
  DatasetEntity,
  ProposalEntity,
  ProposalVersionEntity,
  RelationshipProposalEntity,
  SettingEntity,
  HandoffEntity,
  UploadEntity,
  MappingVersionEntity,
  ImportJobEntity,
  ImportRowErrorEntity,
  AuditEntity,
];

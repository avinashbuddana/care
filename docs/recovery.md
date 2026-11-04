# Recovery and retention

Back up PostgreSQL (including platform import ledger and migration history), durable uploads, external encryption keys and the separate Superset metadata database. Redis persistence reduces lost deliveries but is not the publication ledger. Restore database and files to a consistent point; verify catalog/contracts before allowing imports.

A job completed in PostgreSQL is final even if its queue acknowledgement was lost. Retrying delivery must return the persisted outcome. For a crash before commit PostgreSQL rolls back target changes. For queued/failed jobs inspect stage, logs and database state before requeueing; do not reset completed jobs. A replay of a completed job must never republish. Keep database transaction and audit history when investigating.

Import rollback is not implemented. A corrected CSV can perform a reviewed upsert; it does not undo deletes or concurrent updates. Restoring backups can lose later writes and requires an operator-approved recovery plan. Source remains Power Apps in Phase 1.

Retention policy: retain source uploads for 30 days after all referencing jobs are terminal, staging until job completion then remove, row error reports for 30 days, and audit/proposal/handoff history for 365 days or organization policy. AI samples are not persisted separately; source samples in profiles follow upload retention and require review. These are operational retention targets, not a claim that deletion is already scheduled. Configure an approved maintenance job; avoid deleting files referenced by pending jobs or immutable audit evidence. Back up evidence required by your organization before deletion.

Run `pnpm --filter @platform/api cleanup` to dry-run retention, then add `--apply` to remove expired errors and unreferenced uploads. Uploads referenced by job/proposal history are intentionally retained; archive that history under a separately reviewed policy before removing its source evidence. Audit/proposal history is never automatically deleted. Schedule cleanup via a trusted operator. Never remove database volumes to recover a failed migration.

For foreign-key errors import parents first, correct mappings, validate again. For schema drift redeploy/reconcile the approved schema and reverify. For Bedrock failures disable assistance and use manual proposals. Never disable foreign keys to force publication.

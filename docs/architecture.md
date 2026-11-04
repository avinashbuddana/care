# Architecture

The workspace separates `apps/api`, `apps/worker`, and `apps/web`. `packages/contracts` contains public Zod contracts and frontend-safe types. `packages/ingestion` contains streaming parsing, profiling, validation, catalog checks and publication. Infrastructure secrets and TypeORM entities are never exported through the public contracts package.

`platform` stores authentication, grants, immutable proposal versions, handoffs, deployed import contracts, uploads, mappings, jobs, errors, settings and audit events. `app` contains repository-deployed business tables. `staging` is isolated per import. `reporting` exposes explicitly selected fields. TypeORM synchronization is disabled.

Authentication uses random opaque sessions with SHA-256 token hashes in PostgreSQL and scrypt password hashes. Cookies are HTTP-only and SameSite; writes check request origin. Production requires secure cookies and TLS. Admins manage all datasets; non-admins require explicit dataset grants. Operators may import only with import permission; viewers read authorized records. Superset authentication is separate.

Redis transports job identifiers; PostgreSQL is the publication authority. COPY and publication use bounded pools and worker concurrency. Publication locks its job, rechecks the contract/schema, validates references, and commits target changes and completed job status together. A retry observes the committed status. An accepted import never deletes absent records.

Uploads use opaque storage keys under a shared durable volume. API and worker must mount the same volume. Multi-host production needs shared durable storage or an object-store adapter. Filesystem access is available to trusted application services, never to Bedrock.

The future synchronization boundary is mapping/normalization/reference resolution plus stable source keys. Identify the actual Power Apps backing store (Dataverse, SharePoint, SQL, etc.) and change-capture capabilities before designing synchronization. Operational workflow replacement remains outside this release.

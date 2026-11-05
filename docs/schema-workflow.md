# Schema workflow

A new CSV may be uploaded and profiled before business tables exist. Inspect sampled evidence, names, conservative types, lengths and null percentages. Leading-zero values and identifiers stay text. Profiling is advisory and does not establish business rules or full-file validity.

Administrators create/edit a proposal, including a non-null unique source key. Every version is immutable in PostgreSQL. A change creates a new version. Reserved internal fields (`id`, `created_at`, `updated_at`) cannot be mapped from CSV. Source metadata can be represented by separate explicitly approved columns.

A proposal created by mistake (wrong name or table) can be deleted from the proposal list until its table is deployed. Its versions stay in the audit history; deleting a deployed table needs a reviewed migration.

Approve a version, then generate its handoff. Approval updates platform state only. Downloaded artifacts are proposed, not applied. A developer commits reviewed code, registers entity/contract/migration, builds and runs the release migration gate. Check Schema Availability compares deployed registration and approved contract with the actual catalog before activating import. Failed verification remains visible. A differing deployed contract needs reconciliation; a frontend checkbox cannot activate it.

**Relationships → Analyze a reference** gives evidence before an admin adds a reference to a proposal:

- _Suggest references_ compares sampled distinct values of every CSV column with the unique key of each verified single-key dataset. It suggests a reference only when at least 80% of the sampled values match. Names are never used.
- _Run full-file analysis_ streams the whole column into a temporary table with COPY. It reports matched/missing/empty rows, the match rate, missing samples, _ambiguous_ values (they match only when case or surrounding spaces are ignored), target uniqueness and duplicates, and values that cannot be stored in the target type (`pg_input_is_valid`).

Suggestions are never added automatically.

When an upload for an existing dataset does not match its approved contract, the import screen says so (`GET /api/datasets/:id/compatibility`). A mismatch means a missing required header or a sampled type conflict. Admins get a link that starts a new proposal from the same upload. Imports never add columns or change types.

Many-to-one references are explicit. Select the unique external target key and resolve it to the parent's UUID. Import parents before children. For cycles, deploy nullable references if appropriate, import parents, then perform a reviewed staged backfill and add constraints. Never disable constraints or fabricate missing parents. Many-to-many relationships require an explicit junction entity.

The initial Departments table and registry entry are repository-managed examples. New proposal tables remain unavailable until the developer adds their registration and migration and redeploys. Editing the web page or approving an AI suggestion cannot supply deployment evidence.

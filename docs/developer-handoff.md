# Developer handoff

Repository conventions are seeded from actual paths: `apps/api/src/database/entities`, `apps/api/src/database/migrations`, `apps/api/src/database/data-source.ts` and `apps/api/src/database/registry.ts`. Admins can configure sanitized relative paths and snippets. These settings are supplied by people; the in-application assistant cannot inspect the repository.

After approval, generate the version-bound handoff. Review every create/modify artifact, destination path, complete new file or scoped insertion, and explanation. Copy Path/Copy Code and a downloadable ZIP are available. Existing files are represented as insertions, not invented full replacements.

## Apply with one command

Download the package (Developer handoffs → Download package), then from the repository root:

```sh
node scripts/apply-handoff.mjs ~/Downloads/handoff-<id>.zip   # or: pnpm handoff:apply <zip>
git diff                                                       # review, then commit
./start.sh                                                     # deploy: the migration creates the table
```

Then use **Admin → Datasets → Check schema**. The command uses the supplied migration (alternative 2 below):

- creates the entity, contract and migration files; a different existing file is never overwritten,
- adds the entity and migration to `data-source.ts` and the dataset to `registry.ts`,
- saves the package README and `approved-schema.json` under `docs/handoffs/<table>/`.

Running it twice changes nothing. It needs Node.js 18+ and no installed packages, so it also works on a server.

## Manual alternative

Choose exactly one migration alternative:

1. Add/register the entity, then generate and review a migration locally using the actual DataSource.
2. Add/register the entity and review the provided migration directly.

Do not add both equivalent migrations. Register the exact approved import contract, its migration name and entity in `registry.ts`; register the entity and migration with the DataSource. The handoff README includes commands and checks. Review reporting columns before exposing a reporting view.

Generated migrations (template version 2) include a per-table trigger. It advances `updated_at` only when a business column changes and keeps it for no-op updates or changes to `source_*` metadata only. This matches the bulk merge. An integration test compiles the generated migration exactly as a developer's build would, runs `up`, checks the catalog against the contract and the trigger behaviour, then runs `down`.

For alternative 1 run `pnpm --filter @platform/api migration:generate src/database/migrations/<Name>` from the repository root with `DATABASE_URL` pointing at a migrated development database. Generation does not create the trigger, reporting view or dataset registration; copy those statements from the proposed migration into the generated one.

No assistant or API endpoint applies these artifacts; `apply-handoff.mjs` runs only when a developer runs it in their checkout. The developer uses the ordinary repository release process. After deployment, use schema verification to compare registration, migration history, columns, defaults, nullability, keys and references. Artifact template version and approved proposal version remain associated with the handoff.

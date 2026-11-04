import { dataSource } from './data-source';
async function main(): Promise<void> {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SELECT pg_advisory_lock(731612341)');
    const command = process.argv[2];
    if (command === 'run') {
      const migrations = await dataSource.runMigrations({ transaction: 'all' });
      console.log(
        JSON.stringify({ event: 'migrations_complete', applied: migrations.map((m) => m.name) }),
      );
    } else if (command === 'show')
      console.log(JSON.stringify({ pending: await dataSource.showMigrations() }));
    else if (command === 'revert') await dataSource.undoLastMigration({ transaction: 'all' });
    else throw new Error('Expected run, show, or revert');
  } finally {
    await runner.query('SELECT pg_advisory_unlock(731612341)');
    await runner.release();
    await dataSource.destroy();
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});

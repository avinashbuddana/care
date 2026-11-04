import { contractSchema, conventionsSchema } from '@platform/contracts';
import { generateArtifacts, contractHash } from '../src/modules/developer-handoff/templates';
import ts from 'typescript';
const contract = contractSchema.parse({
  version: 2,
  table: 'cost_centres',
  columns: [
    { name: 'source_code', source: 'Code', type: 'text', nullable: false },
    { name: 'amount', source: 'Amount', type: 'numeric', nullable: true, precision: 12, scale: 2 },
  ],
  uniqueKey: ['source_code'],
  reportingColumns: ['source_code'],
});
describe('trusted developer handoff templates', () => {
  it('honours configured paths, compiles complete new TS files, includes timestamp trigger and one migration alternative', () => {
    const conventions = conventionsSchema.parse({
      entityDirectory: 'custom/entities',
      migrationDirectory: 'custom/migrations',
      registrationPath: 'custom/registry.ts',
    });
    const artifacts = generateArtifacts(
      contract,
      conventions,
      '10000000-0000-4000-8000-000000000002',
      1760000002000,
    );
    expect(artifacts.find((a) => a.path === 'custom/entities/cost_centres.ts')).toBeDefined();
    expect(
      artifacts.find((a) => a.path === 'custom/migrations/1760000002000-CostCentres.ts')?.content,
    ).toContain('clock_timestamp()');
    expect(artifacts.find((a) => a.action === 'modify')?.content).toContain('Scoped insertion');
    for (const a of artifacts.filter((a) => a.action === 'create' && a.path.endsWith('.ts'))) {
      const result = ts.transpileModule(a.content, {
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          experimentalDecorators: true,
        },
      });
      expect(result.diagnostics).toEqual([]);
    }
    const readme = artifacts.find((a) => a.path === 'README.md')?.content;
    expect(readme).toContain('Choose ONE migration alternative');
    expect(readme).toContain('not applied or verified');
  });
  it('rejects path traversal and untrusted SQL identifiers', () => {
    expect(() => conventionsSchema.parse({ entityDirectory: '../outside' })).toThrow();
    expect(() =>
      contractSchema.parse({ ...contract, table: 'records; DROP TABLE users' }),
    ).toThrow();
    expect(() =>
      contractSchema.parse({
        ...contract,
        columns: [{ ...contract.columns[0], name: 'created_at' }],
      }),
    ).toThrow();
  });
  it('hashes approved typed contracts consistently and changes when schema changes', () => {
    expect(contractHash(contract)).toBe(
      contractHash(contractSchema.parse(JSON.parse(JSON.stringify(contract)))),
    );
    expect(contractHash({ ...contract, version: 3 })).not.toBe(contractHash(contract));
  });
});

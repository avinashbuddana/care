import { contractSchema, conventionsSchema, jobPayloadSchema, mappingSchema } from './index';
const valid = {
  version: 1,
  table: 'departments',
  columns: [{ name: 'code', source: 'Code', type: 'text', nullable: false }],
  uniqueKey: ['code'],
};
describe('untrusted contract boundaries', () => {
  test('accepts conservative manually specified contracts without AI', () => {
    expect(contractSchema.parse(valid).columns[0]?.evidence).toContain('Manual');
  });
  test.each(['id', 'created_at', 'updated_at'])('reserves internal field %s', (name) => {
    expect(
      contractSchema.safeParse({
        ...valid,
        columns: [{ name, source: 'Code', type: 'text', nullable: false }],
        uniqueKey: [name],
      }).success,
    ).toBe(false);
  });
  test('rejects SQL identifiers and nullable unique keys', () => {
    expect(contractSchema.safeParse({ ...valid, table: 'x;drop schema app cascade' }).success).toBe(
      false,
    );
    expect(
      contractSchema.safeParse({
        ...valid,
        columns: [{ name: 'code', source: 'Code', type: 'text', nullable: true }],
      }).success,
    ).toBe(false);
  });
  test('rejects unsafe repository artifact destinations', () => {
    for (const entityDirectory of [
      '../outside',
      '/etc',
      'apps/../../etc',
      'apps/$(id)',
      'apps/`id`',
    ])
      expect(conventionsSchema.safeParse({ entityDirectory }).success).toBe(false);
  });
  test('rejects unknown queue properties and invalid modes', () => {
    expect(
      jobPayloadSchema.safeParse({
        jobId: '00000000-0000-4000-8000-000000000001',
        sql: 'DROP TABLE',
      }).success,
    ).toBe(false);
    expect(mappingSchema.safeParse({ columns: { code: 'Code' }, mode: 'delete' }).success).toBe(
      false,
    );
  });
  test('does not permit incompatible defaults', () => {
    expect(
      contractSchema.safeParse({
        ...valid,
        columns: [{ name: 'code', source: 'Code', type: 'text', nullable: false, default: 'zero' }],
      }).success,
    ).toBe(false);
  });
});

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { columnSchema, contractSchema } from '@platform/contracts';
import { profileCsv, valueError, safeCsvCell, csvRows, compareProfile } from '../src';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'profile-test-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function file(content: string | Buffer): Promise<string> {
  const path = join(root, 'data.csv');
  await writeFile(path, content);
  return path;
}
test('bounded deterministic profile preserves codes, phone numbers, decimal scale and ambiguous dates', async () => {
  const result = await profileCsv(
    await file(
      'code;phone;amount;when\n0012;+441234;10.25;01/02/2025\n0013;+449999;9.80;02/03/2025\n0014;+441111;1.00;03/04/2025\n',
    ),
    2,
  );
  expect(result.sampled).toBe(true);
  expect(result.delimiter).toBe(';');
  expect(result.rowsSampled).toBe(2);
  expect(result.columns.map((c) => c.type)).toEqual(['text', 'text', 'numeric', 'text']);
  expect(result.columns[2]?.scale).toBe(2);
  expect(result.columns[0]?.leadingZeros).toBe(true);
});
test('duplicate and normalized-collision headers fail before recommendations', async () => {
  await expect(profileCsv(await file('Code,Code\n1,2\n'))).rejects.toThrow('Duplicate');
  await expect(profileCsv(await file('First Name,first-name\nA,B\n'))).rejects.toThrow('collide');
});
test('quoted embedded newlines and blank rows are parsed without losing values', async () => {
  const result = await profileCsv(await file('code,name\n\n1,"Alice\nJones"\n2,"B, C"\n'));
  expect(result.rowsSampled).toBe(2);
  expect(result.columns[1]?.samples).toEqual(['Alice\nJones', 'B, C']);
});
test('invalid binary or UTF-8 rejected', async () => {
  await expect(profileCsv(await file(Buffer.from([255, 254, 0, 0])))).rejects.toThrow('UTF-8');
  await expect(profileCsv(await file(Buffer.from([97, 44, 98, 10, 255])))).rejects.toThrow();
});
test('strict value boundaries forbid silent coercion and calendar rollover', () => {
  const decimal = columnSchema.parse({
    name: 'amount',
    source: 'amount',
    type: 'numeric',
    nullable: false,
    precision: 5,
    scale: 2,
  });
  expect(valueError('123.45', decimal)).toBeUndefined();
  expect(valueError('1234.56', decimal)).toMatch('precision');
  expect(valueError('1.999', decimal)).toMatch('precision');
  const date = columnSchema.parse({ name: 'day', source: 'day', type: 'date', nullable: false });
  expect(valueError('2025-02-30', date)).toMatch('Invalid');
  expect(valueError('2024-02-29', date)).toBeUndefined();
  expect(valueError(null, date)).toMatch('Required');
  expect(safeCsvCell(' =CMD()')).toBe("' =CMD()");
});

test('source row locations survive blank rows and quoted embedded newlines', async () => {
  const path = await file('code,name\n\n1,"Alice\nJones"\n2,Bob\n');
  const rows = [];
  for await (const record of csvRows(path, ',')) rows.push(record.row);
  expect(rows).toEqual([1, 3, 5]);
});

test('schema mismatch detection flags missing required headers and sampled type conflicts', async () => {
  const profile = await profileCsv(await file('Code,Amount,Extra\nA1,abc,x\n'));
  const contract = contractSchema.parse({
    version: 1,
    table: 'items',
    columns: [
      { name: 'code', source: 'Code', type: 'text', nullable: false },
      {
        name: 'amount',
        source: 'Amount',
        type: 'numeric',
        nullable: true,
        precision: 10,
        scale: 2,
      },
      { name: 'owner', source: 'Owner', type: 'text', nullable: false },
    ],
    uniqueKey: ['code'],
  });
  expect(compareProfile(contract, profile)).toMatchObject({
    compatible: false,
    missingRequired: [{ column: 'owner', source: 'Owner' }],
    unexpectedHeaders: ['Extra'],
    typeConflicts: [{ column: 'amount', expected: 'numeric', observed: 'text' }],
  });
});

#!/usr/bin/env node
// Applies a downloaded developer handoff zip to this repository:
//   node scripts/apply-handoff.mjs ~/Downloads/handoff-<id>.zip
// Writes the new entity / contract / migration files (never overwrites a different existing file),
// registers the entity and migration in the DataSource and the dataset in the registry, and keeps
// README.md + approved-schema.json under docs/handoffs/<table>/. Review the diff, commit, then deploy.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = process.argv[2];
if (!zipPath) fail('Usage: node scripts/apply-handoff.mjs <handoff.zip>');

function fail(message) {
  console.error(`apply-handoff: ${message}`);
  process.exit(1);
}

/** Minimal zip reader (stored or deflated entries), enough for handoff downloads. */
function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) fail('Not a zip file');
  const files = {};
  let at = buffer.readUInt32LE(end + 16);
  for (let i = buffer.readUInt16LE(end + 10); i > 0; i--) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) fail('Corrupt zip directory');
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    if (method !== 0 && method !== 8) fail(`Unsupported compression in ${name}`);
    files[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return files;
}

function safe(path) {
  if (path.startsWith('/') || path.split('/').includes('..')) fail(`Unsafe path ${path}`);
  return join(root, path);
}

function importPath(fromFile, toFile) {
  const path = relative(dirname(fromFile), toFile).replace(/\.ts$/, '');
  return path.startsWith('.') ? path : `./${path}`;
}

function edit(file, change) {
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  if (after !== before) writeFileSync(file, after);
}

function addImport(source, line) {
  if (source.includes(line)) return source;
  const lines = source.split('\n');
  let last = -1;
  lines.forEach((l, i) => {
    if (/^import .* from '.*';$/.test(l)) last = i;
  });
  lines.splice(last + 1, 0, line);
  return lines.join('\n');
}

function appendToArray(source, label, item) {
  const pattern = new RegExp(`(${label}: \\[)([^\\]]*)(\\])`);
  const match = source.match(pattern);
  if (!match) fail(`Could not find "${label}: [...]" to register ${item}`);
  const items = match[2].split(',').map((x) => x.trim());
  if (items.includes(item)) return source;
  return source.replace(pattern, `$1${match[2].trimEnd()}, ${item}$3`);
}

const files = unzip(readFileSync(zipPath));
const registration = Object.entries(files).find(([, c]) => c.startsWith('// Scoped insertion'));
if (!registration) fail('This zip does not look like a developer handoff');
const [registryRel, notes] = registration;
const entityName = notes.match(/^\/\/ Import (\w+) from its entity file/m)?.[1];
const contractRel = notes.match(/and approvedContract from (\S+)\.$/m)?.[1];
const migrationName = notes.match(/^\/\/ Add (\w+) to the DataSource migrations array/m)?.[1];
const dataSourceRel = notes.match(/migrations array at (\S+)\.$/m)?.[1];
if (!entityName || !contractRel || !migrationName || !dataSourceRel)
  fail('Could not read the registration notes in the handoff');

const created = Object.entries(files).filter(
  ([path, c]) =>
    path !== registryRel && path !== 'README.md' && path !== 'approved-schema.json' && c,
);
const entityRel = created.find(([, c]) => c.includes(`export class ${entityName} {`))?.[0];
const migrationRel = created.find(([, c]) => c.includes(`export class ${migrationName} `))?.[0];
if (!entityRel || !migrationRel) fail('Entity or migration file missing from the handoff');
const table = JSON.parse(files['approved-schema.json'] ?? '{}').table ?? entityName;

// 1. New files. An identical existing file is fine (re-run); a different one is never overwritten.
for (const [path, content] of created) {
  const target = safe(path);
  if (existsSync(target)) {
    if (readFileSync(target, 'utf8') !== content) fail(`${path} already exists with other content`);
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`created   ${path}`);
}
for (const name of ['README.md', 'approved-schema.json'])
  if (files[name]) {
    const path = `docs/handoffs/${table}/${name}`;
    mkdirSync(dirname(safe(path)), { recursive: true });
    writeFileSync(safe(path), files[name]);
    console.log(`saved     ${path}`);
  }

// 2. Register entity + migration in the DataSource.
const dataSource = safe(dataSourceRel);
edit(dataSource, (s) => {
  s = addImport(s, `import { ${entityName} } from '${importPath(dataSource, safe(entityRel))}';`);
  s = addImport(
    s,
    `import { ${migrationName} } from '${importPath(dataSource, safe(migrationRel))}';`,
  );
  return appendToArray(appendToArray(s, 'entities', entityName), 'migrations', migrationName);
});
console.log(`updated   ${dataSourceRel}`);

// 3. Register the dataset so "Check schema" can verify it after deployment.
const registry = safe(registryRel);
const contractAlias = `${entityName}Contract`;
edit(registry, (s) => {
  if (s.includes(`migration: '${migrationName}'`)) return s;
  s = addImport(s, `import { ${entityName} } from '${importPath(registry, safe(entityRel))}';`);
  s = addImport(
    s,
    `import { approvedContract as ${contractAlias} } from '${importPath(registry, safe(contractRel))}';`,
  );
  const close = s.lastIndexOf('];');
  if (close < 0 || !s.includes('deployedDatasets')) fail('Could not find deployedDatasets');
  const entry = `  { contract: ${contractAlias}, entity: ${entityName}, migration: '${migrationName}' },\n`;
  return s.slice(0, close) + entry + s.slice(close);
});
console.log(`updated   ${registryRel}`);

console.log(`
Applied handoff for table app.${table}. Next:
  1. Review:  git diff && git status
  2. Commit the changes.
  3. Deploy:  ./start.sh   (the migration creates the table)
  4. In the app: Admin -> Datasets -> Check schema, then import the CSV.`);

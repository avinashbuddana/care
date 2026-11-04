import { createReadStream } from 'node:fs';
import { resolve, sep } from 'node:path';
import { open } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import { z } from 'zod';

const rowSchema = z.object({
  record: z.array(z.string()).max(150),
  raw: z.string(),
  info: z.object({ lines: z.number().int().positive() }),
});
export async function detectCsv(path: string): Promise<{ delimiter: string; encoding: string }> {
  const handle = await open(path, 'r');
  const buffer = Buffer.alloc(65536);
  let bytesRead: number;
  try {
    ({ bytesRead } = await handle.read(buffer, 0, buffer.length, 0));
  } finally {
    await handle.close();
  }
  const prefix = buffer.subarray(0, bytesRead);
  if (
    (prefix[0] === 255 && prefix[1] === 254) ||
    (prefix[0] === 254 && prefix[1] === 255) ||
    prefix.includes(0)
  )
    throw new Error('CSV must be UTF-8; convert UTF-16 or binary files first.');
  const text = new TextDecoder('utf-8', { fatal: true })
    .decode(prefix, { stream: true })
    .replace(/^\uFEFF/, '');
  const candidates = [',', ';', '\t', '|'];
  const counts = new Map(candidates.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char !== undefined && counts.has(char))
      counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  const delimiter = candidates.reduce(
    (a, b) => ((counts.get(b) ?? 0) > (counts.get(a) ?? 0) ? b : a),
    ',',
  );
  return { delimiter, encoding: 'UTF-8' };
}

export async function* csvRows(
  path: string,
  delimiter: string,
): AsyncGenerator<{ values: string[]; row: number }> {
  const source = createReadStream(path);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const utf8 = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        callback(null, decoder.decode(chunk, { stream: true }));
      } catch {
        callback(new Error('Invalid UTF-8 encoding'));
      }
    },
    flush(callback) {
      try {
        callback(null, decoder.decode());
      } catch {
        callback(new Error('Truncated UTF-8 encoding'));
      }
    },
  });
  const parser = parse({
    delimiter,
    bom: true,
    skip_empty_lines: true,
    max_record_size: 1048576,
    relax_column_count: true,
    info: true,
    raw: true,
  });
  let stopped = false;
  const completion = pipeline(source, utf8, parser).catch((error: unknown) => {
    if (!stopped) throw error;
  });
  // Attach rejection observer immediately; completion is awaited in finally.
  void completion.catch(() => undefined);
  try {
    for await (const raw of parser) {
      const parsed = rowSchema.parse(raw);
      const recordRaw = parsed.raw.replace(/^(?:\r\n|\r|\n)+/, '');
      const lineBreaks = (recordRaw.match(/\r\n|\r|\n/g) ?? []).length;
      const row = parsed.info.lines - lineBreaks + (/[\r\n]$/.test(recordRaw) ? 1 : 0);
      yield { values: parsed.record, row };
    }
  } finally {
    stopped = true;
    source.destroy();
    utf8.destroy();
    parser.destroy();
    await completion;
  }
}
export function normalizeHeader(source: string): string {
  let normalized = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(normalized)) normalized = `field_${normalized}`;
  return normalized.slice(0, 48);
}
export function validateHeaders(headers: string[]): void {
  if (!headers.length || headers.some((h) => h.trim().length === 0))
    throw new Error('Blank CSV headers are not allowed.');
  if (headers.some((h) => h.length > 200))
    throw new Error('CSV headers must be at most 200 characters.');
  if (new Set(headers).size !== headers.length)
    throw new Error('Duplicate CSV headers are not allowed.');
  if (new Set(headers.map(normalizeHeader)).size !== headers.length)
    throw new Error('CSV headers collide after name normalization. Rename them before uploading.');
}

/** Resolves an application-generated storage key inside the storage root; rejects traversal. */
export function uploadPath(storageRoot: string, storageKey: string): string {
  if (!/^[a-zA-Z0-9_.-]+$/.test(storageKey)) throw new Error('Invalid upload storage key.');
  const root = resolve(storageRoot);
  const path = resolve(root, storageKey);
  if (!path.startsWith(root + sep)) throw new Error('Invalid upload storage key.');
  return path;
}

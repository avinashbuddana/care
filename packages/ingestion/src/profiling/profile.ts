import type { Column, Profile, ProfileColumn } from '@platform/contracts';
import { csvRows, detectCsv, normalizeHeader, validateHeaders } from '../parsing/csv';

function candidate(value: string): Column['type'] {
  if (/^0\d+$/.test(value) || /^\+\d+$/.test(value)) return 'text';
  if (/^-?(0|[1-9]\d*)$/.test(value))
    return value.replace('-', '').length < 10
      ? 'integer'
      : value.replace('-', '').length < 19
        ? 'bigint'
        : 'text';
  if (/^-?\d+\.\d+$/.test(value)) return 'numeric';
  if (/^(true|false)$/i.test(value)) return 'boolean';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) return 'date';
  if (/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)))
    return 'timestamptz';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    return 'uuid';
  return 'text';
}
export async function profileCsv(path: string, sampleLimit = 1000): Promise<Profile> {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 10000)
    throw new Error('Sample limit must be 1–10000.');
  const detected = await detectCsv(path);
  let headers: string[] | undefined;
  const rows: string[][] = [];
  let sampled = false;
  for await (const record of csvRows(path, detected.delimiter)) {
    if (!headers) {
      headers = record.values;
      validateHeaders(headers);
      continue;
    }
    if (rows.length === sampleLimit) {
      sampled = true;
      break;
    }
    if (record.values.length !== headers.length)
      throw new Error(
        `CSV row ${record.row} has ${record.values.length} values; expected ${headers.length}.`,
      );
    rows.push(record.values);
  }
  if (!headers) throw new Error('CSV is empty.');
  const warnings: string[] = [
    'Candidate keys and relationships require business review; samples cannot establish production rules.',
  ];
  if (sampled)
    warnings.push(
      `Profile uses the first ${sampleLimit} rows. Import validation reads the entire file.`,
    );
  if (!rows.length) warnings.push('CSV contains headers but no data.');
  const columns: ProfileColumn[] = headers.map((source, index) => {
    const values = rows.map((r) => r[index] ?? '').filter((v) => v !== '');
    const types = new Set(values.map(candidate));
    const leadingZeros = values.some((v) => /^0\d+$/.test(v));
    const identifierLike =
      /(^|[^a-z])(code|phone|zip|postal|identifier|account)([^a-z]|$)/i.test(source) ||
      /(?:code|phone|postal|zip)$/i.test(source);
    let type: Column['type'] =
      types.size === 1
        ? candidate(values[0] ?? '')
        : [...types].every((t) => ['integer', 'bigint', 'numeric'].includes(t))
          ? 'numeric'
          : 'text';
    if (identifierLike || leadingZeros) type = 'text';
    let precision = 0;
    let scale = 0;
    for (const value of values) {
      if (/^-?\d+(\.\d+)?$/.test(value)) {
        const parts = value.replace('-', '').split('.');
        scale = Math.max(scale, parts[1]?.length ?? 0);
        precision = Math.max(precision, (parts[0]?.length ?? 0) + (parts[1]?.length ?? 0));
      }
    }
    const ambiguous = values.some((v) => /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(v));
    if (ambiguous) warnings.push(`${source}: ambiguous date values kept as text.`);
    const nulls = rows.length - values.length;
    return {
      source,
      name: normalizeHeader(source),
      type,
      nullable: nulls > 0,
      nullPercent: rows.length ? (100 * nulls) / rows.length : 0,
      maxLength: values.reduce((max, v) => Math.max(max, [...v].length), 0),
      precision,
      scale,
      leadingZeros,
      mixed: types.size > 1,
      uniqueCandidate: values.length > 0 && nulls === 0 && new Set(values).size === values.length,
      evidence: `${values.length} non-empty sampled values; ${types.size} observed type categories.${identifierLike || leadingZeros ? ' Identifier retained as text.' : ''}${ambiguous ? ' Ambiguous dates require explicit normalization.' : ''}`,
      confidence: values.length ? (types.size === 1 ? 0.85 : 0.4) : 0,
      samples: values.slice(0, 3).map((v) => v.slice(0, 120)),
    };
  });
  return { ...detected, sampled, rowsSampled: rows.length, columns, warnings };
}

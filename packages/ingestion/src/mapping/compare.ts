import type { Column, Contract, Profile } from '@platform/contracts';

export interface Compatibility {
  /** False when a new schema proposal is needed before this file can be imported. */
  compatible: boolean;
  missingRequired: { column: string; source: string }[];
  missingOptional: { column: string; source: string }[];
  unexpectedHeaders: string[];
  typeConflicts: {
    column: string;
    source: string;
    expected: Column['type'];
    observed: Column['type'];
  }[];
  /** Type evidence comes from the bounded profile sample; full validation happens on import. */
  sampled: boolean;
}

// Observed sample type → contract types that can hold every such value without loss.
const accepts: Record<Column['type'], Column['type'][]> = {
  text: ['text'],
  integer: ['integer', 'bigint', 'numeric', 'text'],
  bigint: ['bigint', 'numeric', 'text'],
  numeric: ['numeric', 'text'],
  boolean: ['boolean', 'text'],
  date: ['date', 'timestamptz', 'text'],
  timestamptz: ['timestamptz', 'text'],
  uuid: ['uuid', 'text'],
};

/** Compares an upload's profile to an approved contract by CSV header. Never changes the schema. */
export function compareProfile(contract: Contract, profile: Profile): Compatibility {
  const byHeader = new Map(profile.columns.map((c) => [c.source, c]));
  const known = new Set(contract.columns.map((c) => c.source));
  const result: Compatibility = {
    compatible: true,
    missingRequired: [],
    missingOptional: [],
    unexpectedHeaders: profile.columns.map((c) => c.source).filter((h) => !known.has(h)),
    typeConflicts: [],
    sampled: profile.sampled,
  };
  for (const column of contract.columns) {
    const observed = byHeader.get(column.source);
    if (!observed) {
      const required = !column.nullable && column.default === 'none';
      (required ? result.missingRequired : result.missingOptional).push({
        column: column.name,
        source: column.source,
      });
      continue;
    }
    // An all-empty sample carries no type evidence.
    if (observed.nullPercent < 100 && !accepts[observed.type].includes(column.type))
      result.typeConflicts.push({
        column: column.name,
        source: column.source,
        expected: column.type,
        observed: observed.type,
      });
  }
  result.compatible = !result.missingRequired.length && !result.typeConflicts.length;
  return result;
}

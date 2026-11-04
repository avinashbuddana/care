'use client';
import { useState } from 'react';
import { z } from 'zod';
import { contractSchema, columnSchema, type Contract, type Column } from '@platform/contracts';
import { Plus, Trash2 } from 'lucide-react';
import { Input, Select, Textarea } from '../ui/input';
import { Button } from '../ui/button';
import { Notice } from '../ui/feedback';
const types = [
  'text',
  'integer',
  'bigint',
  'numeric',
  'boolean',
  'date',
  'timestamptz',
  'uuid',
] as const;
export function ContractEditor({
  contract,
  onChange,
  disabled = false,
}: {
  contract: Contract;
  onChange: (contract: Contract) => void;
  disabled?: boolean;
}) {
  const [references, setReferences] = useState(JSON.stringify(contract.references, null, 2));
  const [referenceError, setReferenceError] = useState('');
  const [keyText, setKeyText] = useState(contract.uniqueKey.join(', '));
  function updateColumn(index: number, patch: Partial<Column>) {
    onChange({
      ...contract,
      columns: contract.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    });
  }
  const result = contractSchema.safeParse(contract);
  return (
    <div className="space-y-5">
      <div className="field-grid">
        <label>
          Destination table
          <Input
            disabled={disabled}
            value={contract.table}
            onChange={(e) => onChange({ ...contract, table: e.target.value })}
          />
        </label>
        <label>
          Unique business key (comma separated)
          <Input
            disabled={disabled}
            value={keyText}
            onChange={(e) => {
              setKeyText(e.target.value);
              onChange({
                ...contract,
                uniqueKey: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              });
            }}
          />
        </label>
      </div>
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs leading-5 text-stone-500">
        Every table includes PostgreSQL-generated <code>id</code>, <code>created_at</code>, and{' '}
        <code>updated_at</code>. CSVs cannot overwrite these internal fields. Put original
        timestamps in separate source fields.
      </div>
      <div className="table-wrap rounded-lg border border-stone-200">
        <table className="data-table">
          <thead>
            <tr>
              <th>Source header</th>
              <th>Column name</th>
              <th>Type</th>
              <th>Nullable</th>
              <th>Default</th>
              <th>Length / precision</th>
              <th>Reporting</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {contract.columns.map((c, i) => (
              <tr key={i}>
                <td>
                  <Input
                    aria-label={`Source header ${i + 1}`}
                    className="min-w-32"
                    disabled={disabled}
                    value={c.source}
                    onChange={(e) => updateColumn(i, { source: e.target.value })}
                  />
                </td>
                <td>
                  <Input
                    aria-label={`Column name ${i + 1}`}
                    className="min-w-32"
                    disabled={disabled}
                    value={c.name}
                    onChange={(e) => updateColumn(i, { name: e.target.value })}
                  />
                  <p className="mt-1 max-w-48 text-[10px] text-stone-400">
                    {Math.round(c.confidence * 100)}% confidence · {c.evidence}
                  </p>
                </td>
                <td>
                  <Select
                    aria-label={`Column type ${i + 1}`}
                    className="min-w-28"
                    disabled={disabled}
                    value={c.type}
                    onChange={(e) => {
                      const parsed = columnSchema.shape.type.safeParse(e.target.value);
                      if (parsed.success) updateColumn(i, { type: parsed.data });
                    }}
                  >
                    {types.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </td>
                <td>
                  <input
                    aria-label={`Nullable ${i + 1}`}
                    disabled={disabled}
                    type="checkbox"
                    checked={c.nullable}
                    onChange={(e) => updateColumn(i, { nullable: e.target.checked })}
                  />
                </td>
                <td>
                  <Select
                    aria-label={`Default ${i + 1}`}
                    disabled={disabled}
                    value={c.default}
                    onChange={(e) => {
                      const parsed = columnSchema.shape.default.safeParse(e.target.value);
                      if (parsed.success) updateColumn(i, { default: parsed.data });
                    }}
                  >
                    <option value="none">None</option>
                    <option value="empty">Empty text</option>
                    <option value="zero">Zero</option>
                    <option value="false">False</option>
                  </Select>
                </td>
                <td>
                  {c.type === 'text' ? (
                    <Input
                      aria-label={`Maximum length ${i + 1}`}
                      className="w-24"
                      disabled={disabled}
                      type="number"
                      min="1"
                      value={c.maxLength ?? ''}
                      onChange={(e) => {
                        const { maxLength: old, ...rest } = c;
                        void old;
                        onChange({
                          ...contract,
                          columns: contract.columns.map((v, n) =>
                            n === i
                              ? e.target.value
                                ? { ...rest, maxLength: Number(e.target.value) }
                                : rest
                              : v,
                          ),
                        });
                      }}
                    />
                  ) : c.type === 'numeric' ? (
                    <div className="flex gap-1">
                      <Input
                        aria-label={`Precision ${i + 1}`}
                        disabled={disabled}
                        className="w-16"
                        type="number"
                        min="1"
                        value={c.precision ?? 38}
                        onChange={(e) => updateColumn(i, { precision: Number(e.target.value) })}
                      />
                      <Input
                        aria-label={`Scale ${i + 1}`}
                        disabled={disabled}
                        className="w-16"
                        type="number"
                        min="0"
                        value={c.scale ?? 0}
                        onChange={(e) => updateColumn(i, { scale: Number(e.target.value) })}
                      />
                    </div>
                  ) : (
                    <span className="text-stone-300">—</span>
                  )}
                </td>
                <td>
                  <input
                    aria-label={`Approve reporting ${i + 1}`}
                    disabled={disabled}
                    type="checkbox"
                    checked={contract.reportingColumns.includes(c.name)}
                    onChange={(e) =>
                      onChange({
                        ...contract,
                        reportingColumns: e.target.checked
                          ? [...contract.reportingColumns, c.name]
                          : contract.reportingColumns.filter((n) => n !== c.name),
                      })
                    }
                  />
                </td>
                <td>
                  {!disabled && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove column ${i + 1}`}
                      onClick={() =>
                        onChange({
                          ...contract,
                          columns: contract.columns.filter((_, n) => n !== i),
                          uniqueKey: contract.uniqueKey.filter((k) => k !== c.name),
                          reportingColumns: contract.reportingColumns.filter((k) => k !== c.name),
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...contract,
              columns: [
                ...contract.columns,
                {
                  name: `column_${contract.columns.length + 1}`,
                  source: `Column ${contract.columns.length + 1}`,
                  type: 'text',
                  nullable: true,
                  default: 'none',
                  confidence: 0.5,
                  evidence: 'Manual column; confirm business requirements.',
                },
              ],
            })
          }
        >
          <Plus className="size-3" />
          Add column
        </Button>
      )}
      <details className="rounded-lg border border-stone-200">
        <summary className="cursor-pointer p-4 text-sm font-medium">
          Reviewed many-to-one relationships ({contract.references.length})
        </summary>
        <div className="space-y-3 border-t border-stone-100 p-4">
          <p className="text-xs leading-5 text-stone-500">
            Configure source column, target dataset ID/table/unique column, nullability, actions and
            external-key resolution. Parent datasets must be deployed first. Cycles need a staged
            developer migration. Relationships are part of the approved contract.
          </p>
          <Textarea
            aria-label="Relationship configuration JSON"
            className="min-h-44 font-mono text-xs"
            disabled={disabled}
            value={references}
            onChange={(e) => {
              setReferences(e.target.value);
              try {
                const parsed = z
                  .array(
                    z.object({
                      column: z.string(),
                      targetTable: z.string(),
                      targetColumn: z.string(),
                      targetDatasetId: z.string(),
                      resolveToId: z.boolean(),
                      cardinality: z.literal('many-to-one'),
                      nullable: z.boolean(),
                      onDelete: z.enum(['RESTRICT', 'NO ACTION', 'SET NULL']),
                      onUpdate: z.enum(['RESTRICT', 'NO ACTION', 'CASCADE']),
                    }),
                  )
                  .parse(JSON.parse(e.target.value));
                onChange({ ...contract, references: parsed });
                setReferenceError('');
              } catch {
                setReferenceError('Enter valid relationship JSON with every required field.');
              }
            }}
          />
          {referenceError && <Notice danger>{referenceError}</Notice>}
          <p className="text-[11px] text-stone-400">
            Example:{' '}
            {JSON.stringify({
              column: 'department_id',
              targetTable: 'departments',
              targetColumn: 'source_department_code',
              targetDatasetId: 'UUID of the registered parent',
              resolveToId: true,
              cardinality: 'many-to-one',
              nullable: false,
              onDelete: 'RESTRICT',
              onUpdate: 'RESTRICT',
            })}
          </p>
        </div>
      </details>
      {!result.success && (
        <Notice danger>{result.error.issues.map((i) => i.message).join('; ')}</Notice>
      )}
    </div>
  );
}

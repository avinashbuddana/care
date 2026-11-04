'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { GitBranch, ArrowRight, Pencil } from 'lucide-react';
import { api, post, proposalSchema, datasetSchema, uploadSchema } from '../lib/api/client';
import { Select } from '../components/ui/input';
import { PageHeading } from '../components/layout/page-heading';
import { Card, CardHeader, Badge } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Empty, Notice, Loading } from '../components/ui/feedback';
import { message } from '../lib/utils';
export function Relationships() {
  const proposals = useQuery({
    queryKey: ['proposals'],
    queryFn: () => api('/proposals', z.array(proposalSchema)),
  });
  const datasets = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api('/datasets', z.array(datasetSchema)),
  });
  const relationships =
    proposals.data?.flatMap((p) =>
      p.contract.references.map((r) => ({
        ...r,
        proposalName: p.name,
        sourceTable: p.contract.table,
        status: p.status,
      })),
    ) ?? [];
  return (
    <>
      <PageHeading
        title="Relationships"
        description="Explicit, reviewed references between datasets. Resolve external keys to internal UUIDs and import parent datasets first."
        action={
          <Button asChild>
            <Link href="/admin/schema-proposals">
              <Pencil className="size-4" />
              Configure in a proposal
            </Link>
          </Button>
        }
      />
      <div className="mb-6">
        <Notice>
          Many-to-one references are part of each approved schema contract. A matching column name
          alone is never evidence of a foreign key. Many-to-many references require an explicit
          junction table.
        </Notice>
      </div>
      {proposals.isPending ? (
        <Loading />
      ) : proposals.isError ? (
        <Notice danger>{message(proposals.error)}</Notice>
      ) : (
        <Card>
          <CardHeader
            title="Reviewed relationship configurations"
            description="Target keys must be unique and type-compatible. Missing or ambiguous values block publication."
          />
          {relationships.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th />
                    <th>Target unique key</th>
                    <th>Resolution</th>
                    <th>Actions</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {relationships.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <p className="font-mono text-xs">
                          {r.sourceTable}.{r.column}
                        </p>
                        <p className="mt-1 text-xs text-stone-400">{r.proposalName}</p>
                      </td>
                      <td>
                        <ArrowRight className="size-4 text-stone-400" />
                      </td>
                      <td>
                        <p className="font-mono text-xs">
                          {r.targetTable}.{r.targetColumn}
                        </p>
                        <p className="mt-1 text-xs text-stone-400">
                          {datasets.data?.find((d) => d.id === r.targetDatasetId)?.name ??
                            r.targetDatasetId}
                        </p>
                      </td>
                      <td>
                        {r.resolveToId ? 'External key → UUID' : 'Direct reference'}
                        <p className="mt-1 text-xs text-stone-400">
                          {r.cardinality} · {r.nullable ? 'optional' : 'required'}
                        </p>
                      </td>
                      <td className="text-xs text-stone-500">
                        Delete: {r.onDelete}
                        <br />
                        Update: {r.onUpdate}
                      </td>
                      <td>
                        <Badge>{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No relationships configured">
              <GitBranch className="mx-auto mb-4 size-7 text-stone-300" />
              Add reviewed reference configurations in the proposal editor. Deploy parent datasets
              before dependent imports.
            </Empty>
          )}
        </Card>
      )}
      <ReferenceAnalysisPanel />
    </>
  );
}

const suggestionsSchema = z.array(
  z.object({
    sourceHeader: z.string(),
    targetDatasetId: z.string(),
    target: z.object({ table: z.string(), column: z.string() }),
    sampledDistinct: z.number(),
    sampledMatched: z.number(),
    matchRate: z.number(),
  }),
);
const analysisSchema = z.object({
  targetType: z.string(),
  targetUnique: z.boolean(),
  targetDuplicateKeys: z.number(),
  rows: z.number(),
  emptyRows: z.number(),
  distinctValues: z.number(),
  matchedRows: z.number(),
  missingRows: z.number(),
  matchRate: z.number(),
  incompatibleValues: z.number(),
  missingSamples: z.array(z.string()),
  ambiguousSamples: z.array(z.string()),
});
const percent = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** Evidence for a reference before an admin adds it to a proposal. Never infers from names. */
function ReferenceAnalysisPanel() {
  const uploads = useQuery({
    queryKey: ['uploads'],
    queryFn: () => api('/uploads', z.array(uploadSchema)),
  });
  const datasets = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api('/datasets', z.array(datasetSchema)),
  });
  const [uploadId, setUploadId] = useState('');
  const [sourceHeader, setSourceHeader] = useState('');
  const [targetDatasetId, setTargetDatasetId] = useState('');
  const [targetColumn, setTargetColumn] = useState('');
  const upload = uploads.data?.find((u) => u.id === uploadId);
  const ready = datasets.data?.filter((d) => d.status === 'ready') ?? [];
  const target = ready.find((d) => d.id === targetDatasetId);
  const suggest = useMutation({
    mutationFn: () => post('/relationships/suggest', suggestionsSchema, { uploadId }),
  });
  const analyze = useMutation({
    mutationFn: () =>
      post('/relationships/analyze', analysisSchema, {
        uploadId,
        sourceHeader,
        targetDatasetId,
        targetColumn,
      }),
  });
  const a = analyze.data;
  return (
    <div className="mt-6">
      <Card>
        <CardHeader
          title="Analyze a reference"
          description="Suggestions compare sampled values with verified parent keys. Confirm any reference with a full-file analysis, then add it to the proposal yourself."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="text-sm">
            Upload
            <Select
              aria-label="Upload"
              value={uploadId}
              onChange={(e) => {
                setUploadId(e.target.value);
                setSourceHeader('');
                suggest.reset();
                analyze.reset();
              }}
            >
              <option value="">Select an upload</option>
              {uploads.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.originalName}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            Source CSV column
            <Select
              aria-label="Source CSV column"
              value={sourceHeader}
              onChange={(e) => setSourceHeader(e.target.value)}
            >
              <option value="">Select a column</option>
              {upload?.profile?.columns.map((c) => (
                <option key={c.source}>{c.source}</option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            Parent dataset (verified)
            <Select
              aria-label="Parent dataset"
              value={targetDatasetId}
              onChange={(e) => {
                setTargetDatasetId(e.target.value);
                setTargetColumn('');
              }}
            >
              <option value="">Select a dataset</option>
              {ready.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            Parent unique column
            <Select
              aria-label="Parent unique column"
              value={targetColumn}
              onChange={(e) => setTargetColumn(e.target.value)}
            >
              <option value="">Select a column</option>
              {target?.contract.columns.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </Select>
          </label>
        </div>
        <div className="flex flex-wrap gap-3 px-5 pb-5">
          <Button
            variant="outline"
            disabled={!uploadId || suggest.isPending}
            onClick={() => suggest.mutate()}
          >
            {suggest.isPending ? 'Comparing values…' : 'Suggest references'}
          </Button>
          <Button
            disabled={!uploadId || !sourceHeader || !targetColumn || analyze.isPending}
            onClick={() => analyze.mutate()}
          >
            {analyze.isPending ? 'Reading the whole file…' : 'Run full-file analysis'}
          </Button>
        </div>
        <div className="space-y-4 px-5 pb-5">
          {[suggest.error, analyze.error].filter(Boolean).map((e, i) => (
            <Notice key={i} danger>
              {message(e)}
            </Notice>
          ))}
          {suggest.data &&
            (suggest.data.length ? (
              <ul className="space-y-2 text-sm">
                {suggest.data.map((s) => (
                  <li key={`${s.sourceHeader}-${s.target.table}`}>
                    <button
                      className="underline"
                      onClick={() => {
                        setSourceHeader(s.sourceHeader);
                        setTargetDatasetId(s.targetDatasetId);
                        setTargetColumn(s.target.column);
                      }}
                    >
                      {s.sourceHeader} → {s.target.table}.{s.target.column}
                    </button>{' '}
                    <span className="text-stone-500">
                      {s.sampledMatched}/{s.sampledDistinct} sampled values matched (
                      {percent(s.matchRate)}). Sample only — run the full analysis.
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Notice>
                No column&apos;s sampled values match a verified parent key closely enough.
              </Notice>
            ))}
          {a && (
            <div className="text-sm">
              <Notice danger={a.missingRows > 0 || !a.targetUnique || a.incompatibleValues > 0}>
                {a.matchedRows} of {a.rows - a.emptyRows} non-empty rows match (
                {percent(a.matchRate)}
                ). {a.missingRows} rows have no parent; {a.emptyRows} rows are empty. Target{' '}
                {a.targetUnique ? 'has a unique key' : 'is NOT unique — references cannot resolve'}
                {a.targetDuplicateKeys ? ` (${a.targetDuplicateKeys} duplicated keys)` : ''}.{' '}
                {a.incompatibleValues} values cannot be stored as {a.targetType}.
              </Notice>
              {a.missingSamples.length > 0 && (
                <p className="mt-2 text-stone-600">
                  Missing values: <span className="font-mono">{a.missingSamples.join(', ')}</span>.
                  Import the parent records first; parents are never fabricated.
                </p>
              )}
              {a.ambiguousSamples.length > 0 && (
                <p className="mt-2 text-stone-600">
                  Ambiguous (match only ignoring case or spaces):{' '}
                  <span className="font-mono">{a.ambiguousSamples.join(', ')}</span>. Clean the
                  source; matching is exact.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

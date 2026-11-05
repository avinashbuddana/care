'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { mappingSchema, type Mapping } from '@platform/contracts';
import {
  UploadCloud,
  ArrowRight,
  CheckCheck,
  Play,
  Download,
  FileText,
  ChevronRight,
} from 'lucide-react';
import {
  api,
  post,
  datasetSchema,
  uploadSchema,
  jobSchema,
  type UploadView,
  type JobView,
  compatibilitySchema,
} from '../lib/api/client';
import { useSession } from '../hooks/use-session';
import { PageHeading } from '../components/layout/page-heading';
import { Card, CardHeader, Badge } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Empty, Loading, Notice } from '../components/ui/feedback';
import { ProfilePreview } from '../components/schema/profile-preview';
import { date, message } from '../lib/utils';
const active = new Set([
  'queued',
  'queued_validation',
  'queued_publish',
  'validating',
  'publishing',
  'processing',
  'pending',
  'running',
]);
export function Imports() {
  const session = useSession();
  const client = useQueryClient();
  const datasets = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api('/datasets', z.array(datasetSchema)),
  });
  const uploads = useQuery({
    queryKey: ['uploads'],
    queryFn: () => api('/uploads', z.array(uploadSchema)),
    enabled: session.data?.role !== 'viewer',
  });
  const jobs = useQuery({
    queryKey: ['imports'],
    queryFn: () => api('/imports', z.array(jobSchema)),
    refetchInterval: 3000,
  });
  const [datasetId, setDatasetId] = useState('');
  const [upload, setUpload] = useState<UploadView | null>(null);
  const [mapping, setMapping] = useState<Mapping>({
    columns: {},
    mode: 'upsert',
    emptyAsNull: true,
    ignored: [],
  });
  const compatibility = useQuery({
    queryKey: ['compatibility', datasetId, upload?.id],
    queryFn: () =>
      api(`/datasets/${datasetId}/compatibility?uploadId=${upload?.id ?? ''}`, compatibilitySchema),
    enabled: !!datasetId && !!upload,
  });
  const [selectedId, setSelectedId] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('dataset');
    const job = params.get('job');
    if (id) {
      setDatasetId(id);
      setShowNew(true);
    }
    if (job) setSelectedId(job);
  }, []);
  const dataset = datasets.data?.find((d) => d.id === datasetId);
  const ready = datasets.data?.filter((d) => d.status === 'ready') ?? [];
  const headers = upload?.profile?.columns.map((c) => c.source) ?? [];
  const selected = jobs.data?.find((j) => j.id === selectedId);
  function chooseUpload(result: UploadView) {
    setUpload(result);
    const columns: Record<string, string> = {};
    for (const c of dataset?.contract.columns ?? []) {
      if (result.profile?.columns.some((p) => p.source === c.source)) columns[c.name] = c.source;
    }
    setMapping((m) => ({ ...m, columns, ignored: [] }));
  }
  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.set('file', file);
      return api('/uploads', uploadSchema, { method: 'POST', body });
    },
    onSuccess: (result) => {
      chooseUpload(result);
      void client.invalidateQueries({ queryKey: ['uploads'] });
    },
  });
  const validate = useMutation({
    mutationFn: () =>
      post('/imports', jobSchema, {
        datasetId,
        uploadId: upload?.id,
        mapping: mappingSchema.parse(mapping),
      }),
    onSuccess: (result) => {
      setSelectedId(result.id);
      setShowNew(false);
      setNotice('Validation queued. Every row will be checked before publication is allowed.');
      void client.invalidateQueries({ queryKey: ['imports'] });
    },
  });
  const start = useMutation({
    mutationFn: (id: string) => post(`/imports/${id}/start`, jobSchema),
    onSuccess: (result) => {
      setSelectedId(result.id);
      setNotice(
        'Import queued for publication. The worker will recheck schema compatibility and publish transactionally.',
      );
      void client.invalidateQueries({ queryKey: ['imports'] });
    },
  });
  const unmapped = dataset?.contract.columns.filter((c) => !mapping.columns[c.name]) ?? [];
  const extra = headers.filter((h) => !Object.values(mapping.columns).includes(h));
  const canValidate =
    !!dataset &&
    !!upload &&
    unmapped.every((c) => c.nullable || c.default !== 'none') &&
    extra.every((h) => mapping.ignored.includes(h));
  return (
    <>
      <PageHeading
        title="CSV imports"
        description="Map source columns, validate every row, and review the result before publishing into a verified dataset."
        action={
          session.data?.role !== 'viewer' && (
            <Button
              onClick={() => {
                setShowNew(!showNew);
                setNotice('');
              }}
            >
              <UploadCloud className="size-4" />
              {showNew ? 'Close new import' : 'New import'}
            </Button>
          )
        }
      />
      {notice && (
        <div className="mb-5">
          <Notice>{notice}</Notice>
        </div>
      )}
      {[uploadMutation.error, validate.error, start.error].filter(Boolean).map((e, i) => (
        <div key={i} className="mb-5">
          <Notice danger>{message(e)}</Notice>
        </div>
      ))}
      {showNew && session.data?.role !== 'viewer' && (
        <Card className="mb-6">
          <CardHeader
            title="Prepare an import"
            description="Only datasets that pass server-side schema verification are available."
          />
          <div className="space-y-6 p-6">
            <ol className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
              {[
                'Select dataset',
                'Upload & preview',
                'Map columns',
                'Validate & review',
                'Publish',
              ].map((step, i) => (
                <li key={step} className="flex items-center gap-3">
                  <span className="flex size-6 items-center justify-center rounded-full bg-teal-50 font-medium text-teal-800">
                    {i + 1}
                  </span>
                  {step}
                  {i < 4 && <ChevronRight className="size-3 text-stone-300" />}
                </li>
              ))}
            </ol>
            {ready.length === 0 && (
              <Notice>
                No verified datasets are available. Deploy an approved schema and use Check Schema
                Availability on the Datasets page.
              </Notice>
            )}
            <div className="field-grid">
              <label>
                Import-ready dataset
                <Select
                  value={datasetId}
                  onChange={(e) => {
                    setDatasetId(e.target.value);
                    setUpload(null);
                    setMapping((m) => ({ ...m, columns: {}, ignored: [] }));
                  }}
                >
                  <option value="">Choose a dataset</option>
                  {ready.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · contract v{d.contract.version}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                Import mode
                <Select
                  value={mapping.mode}
                  onChange={(e) => {
                    const parsed = z.enum(['insert', 'upsert']).safeParse(e.target.value);
                    if (parsed.success) setMapping((m) => ({ ...m, mode: parsed.data }));
                  }}
                >
                  <option value="upsert">Upsert · insert new, update changed</option>
                  <option value="insert">Insert only · existing keys are errors</option>
                </Select>
              </label>
            </div>
            {dataset && (
              <>
                <p className="text-xs text-stone-500">
                  Destination: <code>app.{dataset.contract.table}</code> ·{' '}
                  {dataset.contract.uniqueKey.length ? (
                    <>
                      Unique key: <code>{dataset.contract.uniqueKey.join(', ')}</code>. This
                      deployed contract defines the upsert key.
                    </>
                  ) : (
                    <>
                      No unique key: every import <strong>appends</strong> all rows (the import mode
                      does not apply). Re-importing the same file duplicates its rows.
                    </>
                  )}
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <label>
                    Upload source CSV
                    <Input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={uploadMutation.isPending}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadMutation.mutate(file);
                      }}
                    />
                  </label>
                  <label>
                    Or reuse a durable upload
                    <Select
                      value={upload?.id ?? ''}
                      onChange={(e) => {
                        const result = uploads.data?.find((u) => u.id === e.target.value);
                        if (result) chooseUpload(result);
                      }}
                    >
                      <option value="">Choose an uploaded file</option>
                      {uploads.data?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.originalName} · {date(u.createdAt)}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                {uploadMutation.isPending && <Loading />}
                {upload && (
                  <>
                    <div className="flex items-center gap-3 text-sm">
                      <FileText className="size-4 text-teal-700" />
                      <span>{upload.originalName}</span>
                      <Badge>{(upload.bytes / 1024).toFixed(1)} KB</Badge>
                    </div>
                    {upload.profile && (
                      <details className="rounded-lg border border-stone-200 p-4">
                        <summary className="cursor-pointer text-sm font-medium">
                          Source profile and sample preview
                        </summary>
                        <div className="mt-4">
                          <ProfilePreview profile={upload.profile} />
                        </div>
                      </details>
                    )}
                    <div className="table-wrap rounded-lg border border-stone-200">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Destination column</th>
                            <th>Contract</th>
                            <th>CSV source header</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dataset.contract.columns.map((c) => (
                            <tr key={c.name}>
                              <td className="font-mono text-xs">{c.name}</td>
                              <td className="text-xs text-stone-500">
                                {c.type} · {c.nullable ? 'optional' : 'required'}
                                {c.default !== 'none' ? ` · default ${c.default}` : ''}
                              </td>
                              <td>
                                <Select
                                  aria-label={`Map ${c.name}`}
                                  value={mapping.columns[c.name] ?? ''}
                                  onChange={(e) => {
                                    const columns = { ...mapping.columns };
                                    if (e.target.value) columns[c.name] = e.target.value;
                                    else delete columns[c.name];
                                    setMapping((m) => ({ ...m, columns }));
                                  }}
                                >
                                  <option value="">Unmapped</option>
                                  {headers.map((h) => (
                                    <option key={h}>{h}</option>
                                  ))}
                                </Select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {compatibility.data && !compatibility.data.compatible && (
                      <Notice danger>
                        This file does not match the approved contract
                        {compatibility.data.missingRequired.length > 0 &&
                          `; missing required headers: ${compatibility.data.missingRequired.map((m) => m.source).join(', ')}`}
                        {compatibility.data.typeConflicts.length > 0 &&
                          `; type conflicts${compatibility.data.sampled ? ' (sample-based)' : ''}: ${compatibility.data.typeConflicts.map((t) => `${t.source} looks like ${t.observed}, contract expects ${t.expected}`).join('; ')}`}
                        . Imports never add columns or change types.{' '}
                        {session.data?.role === 'admin' && upload && (
                          <Link
                            className="font-medium underline"
                            href={`/admin/schema-proposals?uploadId=${upload.id}`}
                          >
                            Create a new schema proposal from this file
                          </Link>
                        )}
                      </Notice>
                    )}
                    {unmapped.length > 0 && (
                      <Notice danger={unmapped.some((c) => !c.nullable && c.default === 'none')}>
                        Unmapped destination columns: {unmapped.map((c) => c.name).join(', ')}.
                        Required columns without defaults must be mapped.
                      </Notice>
                    )}
                    {extra.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                        <p className="text-sm font-medium text-amber-900">
                          Unmapped source columns
                        </p>
                        <p className="mt-1 text-xs text-amber-800">
                          Acknowledge each ignored header. For a schema mismatch, create a new
                          schema proposal; imports never add columns automatically.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-5">
                          {extra.map((h) => (
                            <label key={h} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={mapping.ignored.includes(h)}
                                onChange={(e) =>
                                  setMapping((m) => ({
                                    ...m,
                                    ignored: e.target.checked
                                      ? [...m.ignored, h]
                                      : m.ignored.filter((s) => s !== h),
                                  }))
                                }
                              />
                              Ignore {h}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={mapping.emptyAsNull}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, emptyAsNull: e.target.checked }))
                        }
                      />
                      Treat empty CSV fields as null
                    </label>
                    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-100 pt-5">
                      <p className="max-w-xl text-xs leading-5 text-stone-500">
                        Strict publication: blocking row errors leave target records unchanged.
                        Missing rows in the CSV never delete records. Mapping is saved as an
                        immutable job version.
                      </p>
                      <Button
                        disabled={!canValidate || validate.isPending}
                        onClick={() => validate.mutate()}
                      >
                        <CheckCheck className="size-4" />
                        {validate.isPending ? 'Creating validation…' : 'Validate entire file'}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </Card>
      )}
      {selected && (
        <JobDetails
          job={selected}
          datasetName={
            datasets.data?.find((d) => d.id === selected.datasetId)?.name ?? selected.datasetId
          }
          canStart={session.data?.role !== 'viewer'}
          starting={start.isPending}
          onStart={() => start.mutate(selected.id)}
        />
      )}
      <Card>
        <CardHeader
          title="Import history"
          description="Job state and counts are read from PostgreSQL. Active jobs refresh every three seconds."
        />
        {jobs.isPending ? (
          <Loading />
        ) : jobs.isError ? (
          <Notice danger>{message(jobs.error)}</Notice>
        ) : jobs.data.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dataset / job</th>
                  <th>Status</th>
                  <th>Received</th>
                  <th>Rejected</th>
                  <th>Published</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.data.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <p className="font-medium">
                        {datasets.data?.find((d) => d.id === j.datasetId)?.name ?? 'Dataset'}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-stone-400">
                        {j.id.slice(0, 8)} · {j.mapping.mode}
                      </p>
                    </td>
                    <td>
                      <Badge
                        tone={
                          j.status === 'completed'
                            ? 'success'
                            : j.status === 'failed' || j.status === 'invalid'
                              ? 'danger'
                              : active.has(j.status)
                                ? 'warning'
                                : 'neutral'
                        }
                      >
                        {j.status}
                      </Badge>
                    </td>
                    <td>{j.counts.received.toLocaleString()}</td>
                    <td>{j.counts.rejected.toLocaleString()}</td>
                    <td>{(j.counts.inserted + j.counts.updated).toLocaleString()}</td>
                    <td className="text-xs text-stone-500">{date(j.createdAt)}</td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedId(j.id)}>
                        Review
                        <ArrowRight className="size-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No imports yet">
            Start a new import after verifying a deployed dataset.
          </Empty>
        )}
      </Card>
    </>
  );
}
function JobDetails({
  job,
  datasetName,
  canStart,
  starting,
  onStart,
}: {
  job: JobView;
  datasetName: string;
  canStart: boolean;
  starting: boolean;
  onStart: () => void;
}) {
  return (
    <Card className="mb-6">
      <CardHeader
        title={`Import review · ${datasetName}`}
        description={`Job ${job.id} · Created ${date(job.createdAt)} · Finished ${date(job.finishedAt)}`}
        action={
          <Badge
            tone={
              job.status === 'completed' ? 'success' : job.counts.rejected ? 'danger' : 'neutral'
            }
          >
            {job.status}
          </Badge>
        }
      />
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {Object.entries(job.counts).map(([key, value]) => (
            <div key={key} className="rounded-lg border border-stone-200 p-4">
              <p className="text-[10px] uppercase tracking-wider text-stone-400">{key}</p>
              <p className="mt-2 text-xl font-semibold">{value.toLocaleString()}</p>
            </div>
          ))}
        </div>
        <p className="text-xs leading-5 text-stone-500">
          Received: parsed data rows. Valid: rows passing validation. Rejected: rows with blocking
          errors. Inserted: new keys. Updated: changed business values. Unchanged: existing keys
          with identical values. Rejected rows may have multiple errors.
        </p>
        {job.failure && <Notice danger>{job.failure}</Notice>}
        {active.has(job.status) && (
          <Notice>
            The worker is processing this job. Publication remains protected by the deployed
            contract and database constraints.
          </Notice>
        )}
        {job.status === 'validated' && (
          <Notice>
            Full-file validation passed. Review the mapping, key, counts, and errors before starting
            publication.
          </Notice>
        )}
        <details className="rounded-lg border border-stone-200 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Saved mapping version and import mode
          </summary>
          <pre className="mt-3 overflow-x-auto text-xs leading-6">
            {JSON.stringify(job.mapping, null, 2)}
          </pre>
        </details>
        {job.errors.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Row errors</h3>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/imports/${job.id}/errors.csv`}>
                  <Download className="size-3" />
                  Download safe CSV
                </a>
              </Button>
            </div>
            <div className="max-h-80 overflow-auto rounded-lg border border-stone-200">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source row</th>
                    <th>Field</th>
                    <th>Value</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {job.errors.map((e, i) => (
                    <tr key={i}>
                      <td>{e.row}</td>
                      <td>{e.field}</td>
                      <td className="max-w-48 truncate" title={e.value ?? ''}>
                        {e.value ?? 'NULL'}
                      </td>
                      <td>{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {canStart && job.status === 'validated' && job.counts.rejected === 0 && (
          <div className="flex justify-end">
            <Button disabled={starting} onClick={onStart}>
              <Play className="size-4" />
              {starting ? 'Queuing…' : 'Start import'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

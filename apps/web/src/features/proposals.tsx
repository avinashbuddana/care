'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { contractSchema, type Contract, type Profile } from '@platform/contracts';
import { Plus, UploadCloud, CheckCheck, PackageOpen, Sparkles, ArrowLeft } from 'lucide-react';
import {
  api,
  post,
  proposalSchema,
  uploadSchema,
  handoffSchema,
  type ProposalView,
  type UploadView,
} from '../lib/api/client';
import { PageHeading } from '../components/layout/page-heading';
import { Card, CardHeader, Badge } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Notice, Loading, Empty } from '../components/ui/feedback';
import { ContractEditor } from '../components/schema/contract-editor';
import { ProfilePreview } from '../components/schema/profile-preview';
import { message, date } from '../lib/utils';
const metadataSchema = z.object({ name: z.string().min(2).max(120) });
const blank: Contract = {
  version: 1,
  table: 'new_dataset',
  columns: [
    {
      name: 'source_record_id',
      source: 'Source ID',
      type: 'text',
      nullable: false,
      default: 'none',
      evidence: 'Stable key from the source system.',
      confidence: 0.5,
    },
  ],
  uniqueKey: ['source_record_id'],
  references: [],
  reportingColumns: [],
};
function fromProfile(profile: Profile): Contract {
  const first = profile.columns.find((c) => c.uniqueCandidate && !c.nullable) ?? profile.columns[0];
  return {
    ...blank,
    columns: profile.columns.map((c) => ({
      name: c.name,
      source: c.source,
      type: c.type,
      nullable: c.name === first?.name ? false : c.nullable,
      default: 'none',
      evidence: c.evidence,
      confidence: c.confidence,
      ...(c.type === 'numeric'
        ? { precision: Math.min(38, Math.max(1, c.precision)), scale: Math.min(18, c.scale) }
        : {}),
    })),
    uniqueKey: first ? [first.name] : [],
  };
}
export function Proposals() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['proposals'],
    queryFn: () => api('/proposals', z.array(proposalSchema)),
  });
  const [editing, setEditing] = useState<ProposalView | null>(null);
  const [creating, setCreating] = useState(false);
  const [contract, setContract] = useState<Contract>(blank);
  const [upload, setUpload] = useState<UploadView | null>(null);
  const [notice, setNotice] = useState('');
  const form = useForm<z.infer<typeof metadataSchema>>({
    resolver: zodResolver(metadataSchema),
    defaultValues: { name: '' },
  });
  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.set('file', file);
      return api('/uploads', uploadSchema, { method: 'POST', body });
    },
    onSuccess: (result) => {
      setUpload(result);
      if (result.profile) setContract({ ...fromProfile(result.profile), table: contract.table });
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const checked = contractSchema.parse(contract);
      const name = metadataSchema.parse(form.getValues()).name;
      if (editing)
        return api(`/proposals/${editing.id}`, proposalSchema, {
          method: 'PATCH',
          body: JSON.stringify({ name, contract: checked }),
        });
      return post('/proposals', proposalSchema, {
        name,
        contract: checked,
        ...(upload ? { uploadId: upload.id } : {}),
      });
    },
    onSuccess: (result) => {
      setEditing(result);
      setCreating(false);
      setContract(result.contract);
      setNotice('Proposal saved. Review the contract before approving.');
      void client.invalidateQueries({ queryKey: ['proposals'] });
    },
  });
  const approve = useMutation({
    mutationFn: (id: string) => post(`/proposals/${id}/approve`, proposalSchema),
    onSuccess: (result) => {
      setEditing(result);
      setContract(result.contract);
      setNotice(
        'Approved. No database tables have been created. Generate the developer handoff next.',
      );
      void client.invalidateQueries({ queryKey: ['proposals'] });
    },
  });
  const handoff = useMutation({
    mutationFn: (id: string) => post(`/proposals/${id}/handoff`, handoffSchema),
    onSuccess: () => {
      setNotice(
        'Developer handoff generated. Open Developer handoffs to review and download the proposed artifacts. Import remains blocked until deployment is verified.',
      );
      void client.invalidateQueries({ queryKey: ['proposals'] });
      void client.invalidateQueries({ queryKey: ['datasets'] });
      void client.invalidateQueries({ queryKey: ['handoffs'] });
    },
  });
  const recommend = useMutation({
    mutationFn: () => {
      if (!upload) throw new Error('Upload a CSV first.');
      return post('/settings/bedrock/recommend', contractSchema, {
        uploadId: upload.id,
        table: contract.table,
      });
    },
    onSuccess: (result) => {
      setContract(result);
      setNotice('AI recommendation loaded. Review every field and relationship before saving.');
    },
  });
  // /admin/schema-proposals?uploadId=… starts a new proposal from an existing upload (schema mismatch path).
  useEffect(() => {
    const uploadId = new URLSearchParams(window.location.search).get('uploadId');
    if (!uploadId) return;
    void api('/uploads', z.array(uploadSchema)).then((uploads) => {
      const existing = uploads.find((u) => u.id === uploadId);
      if (!existing) return;
      setCreating(true);
      setEditing(null);
      setUpload(existing);
      if (existing.profile) setContract(fromProfile(existing.profile));
      setNotice(
        'New proposal started from the selected upload. Review every column before saving.',
      );
    });
  }, []);
  function open(p: ProposalView) {
    setEditing(p);
    setContract(p.contract);
    form.reset({ name: p.name });
    setUpload(null);
    setCreating(false);
    setNotice('');
  }
  const profile = upload?.profile ?? editing?.profile;
  const selected = editing !== null || creating;
  const immutable = editing !== null && editing.status !== 'draft';
  const errors = [
    save.error,
    uploadMutation.error,
    approve.error,
    handoff.error,
    recommend.error,
  ].filter(Boolean);
  return (
    <>
      <PageHeading
        title={
          selected
            ? editing
              ? 'Review schema proposal'
              : 'Create a schema proposal'
            : 'Schema proposals'
        }
        description="Profile a source file, shape a contract, and prepare reviewed code for your developer. Approval never creates tables."
        action={
          !selected && (
            <Button
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setContract(blank);
                setUpload(null);
                form.reset({ name: '' });
                setNotice('');
              }}
            >
              <Plus className="size-4" />
              New proposal
            </Button>
          )
        }
      />
      {notice && (
        <div className="mb-5">
          <Notice>{notice}</Notice>
        </div>
      )}
      {errors.map((e, i) => (
        <div key={i} className="mb-4">
          <Notice danger>{message(e)}</Notice>
        </div>
      ))}
      {selected ? (
        <div className="space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCreating(false);
              setEditing(null);
              setNotice('');
              save.reset();
              approve.reset();
              handoff.reset();
              recommend.reset();
              uploadMutation.reset();
            }}
          >
            <ArrowLeft className="size-3" />
            All proposals
          </Button>
          <Card>
            <CardHeader
              title={editing?.name ?? 'New proposal'}
              description={
                editing
                  ? `Version ${editing.version} · ${editing.status.replaceAll('_', ' ')}`
                  : 'Upload a CSV or create a contract manually.'
              }
              action={
                editing && <Badge tone={immutable ? 'success' : 'neutral'}>{editing.status}</Badge>
              }
            />
            <div className="space-y-6 p-6">
              <label className="block max-w-lg">
                Proposal name
                <Input
                  disabled={immutable}
                  placeholder="e.g. Employee directory"
                  {...form.register('name')}
                />
                {form.formState.errors.name && (
                  <span className="text-xs text-red-700">{form.formState.errors.name.message}</span>
                )}
              </label>
              {!immutable && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-5">
                  <UploadCloud className="size-6 text-teal-700" />
                  <div className="flex-1">
                    <label htmlFor="proposal-upload" className="block">
                      Analyze a source CSV
                    </label>
                    <p className="mt-1 text-xs text-stone-500">
                      Bounded profiling before recommendations. Manual editing is always available.
                    </p>
                  </div>
                  <Input
                    id="proposal-upload"
                    aria-label="Analyze CSV"
                    className="max-w-xs bg-white"
                    type="file"
                    accept=".csv,text/csv"
                    disabled={uploadMutation.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadMutation.mutate(file);
                    }}
                  />
                </div>
              )}
              {uploadMutation.isPending && <Loading />}
              {profile && <ProfilePreview profile={profile} />}
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Proposed import contract</h3>
                {!immutable && upload && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={recommend.isPending}
                    onClick={() => recommend.mutate()}
                  >
                    <Sparkles className="size-3" />
                    {recommend.isPending ? 'Requesting…' : 'Ask Bedrock'}
                  </Button>
                )}
              </div>
              <ContractEditor
                key={`${editing?.id ?? 'new'}-${upload?.id ?? ''}-${recommend.submittedAt}`}
                contract={contract}
                onChange={setContract}
                disabled={immutable}
              />
              {!immutable && (
                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-100 pt-5">
                  <p className="max-w-xl text-xs leading-5 text-stone-500">
                    Confirm nullability, business keys and reporting columns with the data owner.
                    CSV evidence alone does not establish production business rules.
                  </p>
                  <Button
                    disabled={save.isPending || !contractSchema.safeParse(contract).success}
                    onClick={() => {
                      void form.handleSubmit(() => save.mutate())();
                    }}
                  >
                    {save.isPending ? 'Saving…' : 'Save draft'}
                  </Button>
                </div>
              )}
              {editing && (
                <div className="flex flex-wrap gap-3 border-t border-stone-100 pt-5">
                  {editing.status === 'draft' && (
                    <Button disabled={approve.isPending} onClick={() => approve.mutate(editing.id)}>
                      <CheckCheck className="size-4" />
                      Approve saved version {editing.version}
                    </Button>
                  )}
                  {editing.status === 'approved' && (
                    <Button disabled={handoff.isPending} onClick={() => handoff.mutate(editing.id)}>
                      <PackageOpen className="size-4" />
                      Generate developer handoff
                    </Button>
                  )}
                  {['handoff_ready', 'awaiting_deployment', 'ready'].includes(editing.status) && (
                    <Button asChild>
                      <Link href="/admin/developer-handoffs">Open developer handoffs</Link>
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      ) : query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Notice danger>{message(query.error)}</Notice>
      ) : (
        <Card>
          <CardHeader
            title="Schema review queue"
            description="Immutable approved versions are tied to generated handoff artifacts."
          />
          {query.data.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Proposal</th>
                    <th>Destination</th>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {query.data.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.name}</td>
                      <td className="font-mono text-xs">app.{p.contract.table}</td>
                      <td>v{p.version}</td>
                      <td>
                        <Badge tone={p.status === 'draft' ? 'neutral' : 'success'}>
                          {p.status.replaceAll('_', ' ')}
                        </Badge>
                      </td>
                      <td className="text-xs text-stone-500">{date(p.createdAt)}</td>
                      <td>
                        <Button variant="outline" size="sm" onClick={() => open(p)}>
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Start with a source file">
              Create a proposal to analyze a CSV, or define your first contract manually.
            </Empty>
          )}
        </Card>
      )}
    </>
  );
}

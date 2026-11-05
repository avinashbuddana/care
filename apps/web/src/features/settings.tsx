'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  bedrockSettingsSchema,
  conventionsSchema,
  roles,
  type Conventions,
  type BedrockSettings,
} from '@platform/contracts';
import { Save, PlugZap, LockKeyhole, Sparkles } from 'lucide-react';
import { api, put, post, unknownSchema, datasetSchema } from '../lib/api/client';
import { contractSchema } from '@platform/contracts';
import { PageHeading } from '../components/layout/page-heading';
import { Card, CardHeader } from '../components/ui/card';
import { Input, Select, Textarea } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Loading, Notice } from '../components/ui/feedback';
import { message } from '../lib/utils';
function Tabs({ active }: { active: 'repository' | 'bedrock' | 'users' }) {
  return (
    <nav
      aria-label="Settings sections"
      className="mb-6 flex gap-6 border-b border-stone-200 text-sm"
    >
      {['repository', 'bedrock', 'users'].map((tab) => (
        <Link
          key={tab}
          href={`/admin/settings/${tab}`}
          className={`border-b-2 px-1 pb-4 ${active === tab ? 'border-teal-800 font-medium text-teal-900' : 'border-transparent text-stone-500'}`}
        >
          {tab === 'repository'
            ? 'Repository conventions'
            : tab === 'bedrock'
              ? 'Amazon Bedrock'
              : 'Users & access'}
        </Link>
      ))}
    </nav>
  );
}
export function RepositorySettings() {
  const query = useQuery({
    queryKey: ['repository-settings'],
    queryFn: () => api('/settings/repository', conventionsSchema),
  });
  const form = useForm<Conventions>({
    resolver: zodResolver(conventionsSchema),
    defaultValues: conventionsSchema.parse({}),
  });
  useEffect(() => {
    if (query.data) form.reset(query.data);
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (values: Conventions) => put('/settings/repository', conventionsSchema, values),
  });
  return (
    <>
      <PageHeading
        title="Workspace settings"
        description="Tell the in-application assistant how your repository is organized. It cannot inspect files, apply migrations, or run commands."
      />
      <Tabs active="repository" />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Notice danger>{message(query.error)}</Notice>
      ) : (
        <form
          onSubmit={(event) => {
            void form.handleSubmit((values) => save.mutate(values))(event);
          }}
        >
          <Card>
            <CardHeader
              title="Repository conventions"
              description="Seeded from this project's actual layout. All paths must be repository-relative."
            />
            <div className="space-y-6 p-6">
              <div className="field-grid">
                <label>
                  Entity directory
                  <Input {...form.register('entityDirectory')} />
                </label>
                <label>
                  Migration directory
                  <Input {...form.register('migrationDirectory')} />
                </label>
                <label>
                  DataSource path
                  <Input {...form.register('dataSourcePath')} />
                </label>
                <label>
                  Entity / contract registration file
                  <Input {...form.register('registrationPath')} />
                </label>
                <label>
                  Compiled DataSource path
                  <Input {...form.register('compiledDataSource')} />
                </label>
                <label>
                  Migration command
                  <Input {...form.register('migrationRun')} />
                </label>
                <label>
                  Package manager
                  <Select {...form.register('packageManager')}>
                    <option value="pnpm">pnpm</option>
                  </Select>
                </label>
                <label>
                  Module format
                  <Select {...form.register('moduleFormat')}>
                    <option value="commonjs">CommonJS</option>
                  </Select>
                </label>
                <label>
                  Entity registration method
                  <Select {...form.register('entityRegistration')}>
                    <option value="explicit">Explicit registry</option>
                  </Select>
                </label>
                <label>
                  Naming convention
                  <Select {...form.register('naming')}>
                    <option value="snake_case">snake_case</option>
                  </Select>
                </label>
              </div>
              <label className="block">
                Sanitized examples and relevant snippets
                <Textarea
                  className="min-h-48 font-mono text-xs"
                  placeholder="Supply sanitized registration snippets. Omit credentials, tokens and personal data."
                  {...form.register('snippets')}
                />
              </label>
              <Notice>
                Where existing file contents are unavailable, the handoff provides a scoped
                insertion with verification instructions. It does not invent complete replacements.
              </Notice>
              {Object.keys(form.formState.errors).length > 0 && (
                <Notice danger>
                  {Object.values(form.formState.errors)
                    .map((e) => e.message)
                    .join('; ')}
                </Notice>
              )}
              {save.isError && <Notice danger>{message(save.error)}</Notice>}
              {save.isSuccess && (
                <Notice>
                  Repository conventions saved. Newly generated handoffs will use these paths.
                </Notice>
              )}
              <div className="flex justify-end border-t border-stone-100 pt-5">
                <Button type="submit" disabled={save.isPending}>
                  <Save className="size-4" />
                  Save conventions
                </Button>
              </div>
            </div>
          </Card>
        </form>
      )}
    </>
  );
}
const publicSettingsSchema = z.object({
  enabled: z.boolean(),
  region: z.string(),
  authMode: z.enum(['chain', 'explicit', 'apiKey']),
  inferenceProfileArn: z.string(),
  timeoutMs: z.number(),
  retries: z.number(),
  maxTokens: z.number(),
  shareSamples: z.boolean(),
  maskSamples: z.boolean(),
  hasCredentials: z.boolean().optional(),
});
export function BedrockSettingsPage() {
  const query = useQuery({
    queryKey: ['bedrock-settings'],
    queryFn: () => api('/settings/bedrock', publicSettingsSchema),
  });
  const form = useForm<BedrockSettings>({
    resolver: zodResolver(bedrockSettingsSchema),
    defaultValues: {
      enabled: false,
      region: 'us-east-1',
      authMode: 'chain',
      inferenceProfileArn: '',
      timeoutMs: 30000,
      retries: 2,
      maxTokens: 4000,
      shareSamples: false,
      maskSamples: true,
    },
  });
  const [uploadId, setUploadId] = useState('');
  const [table, setTable] = useState('new_dataset');
  useEffect(() => {
    if (query.data) {
      const { hasCredentials, ...settings } = query.data;
      void hasCredentials;
      form.reset(settings);
    }
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (values: BedrockSettings) => {
      const clean = { ...values };
      if (!clean.accessKeyId) delete clean.accessKeyId;
      if (!clean.secretAccessKey) delete clean.secretAccessKey;
      if (!clean.sessionToken) delete clean.sessionToken;
      if (!clean.apiKey) delete clean.apiKey;
      return put('/settings/bedrock', publicSettingsSchema, clean);
    },
    onSuccess: () => {
      form.resetField('accessKeyId');
      form.resetField('secretAccessKey');
      form.resetField('sessionToken');
      form.resetField('apiKey');
      void query.refetch();
    },
  });
  const test = useMutation({ mutationFn: () => post('/settings/bedrock/test', unknownSchema) });
  const recommend = useMutation({
    mutationFn: () => post('/settings/bedrock/recommend', contractSchema, { uploadId, table }),
  });
  const authMode = form.watch('authMode');
  return (
    <>
      <PageHeading
        title="Workspace settings"
        description="Optional schema recommendations using Amazon Bedrock. Manual schema creation remains available when AI is disabled or unavailable."
      />
      <Tabs active="bedrock" />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Notice danger>{message(query.error)}</Notice>
      ) : (
        <div className="space-y-6">
          <form
            onSubmit={(event) => {
              void form.handleSubmit((values) => save.mutate(values))(event);
            }}
          >
            <Card>
              <CardHeader
                title="Amazon Bedrock connection"
                description="Server-side AWS SDK Converse API · inference profile ARN as modelId"
              />
              <div className="space-y-6 p-6">
                <label className="flex items-center gap-2">
                  <input type="checkbox" {...form.register('enabled')} />
                  Enable AI schema recommendations
                </label>
                <div className="field-grid">
                  <label>
                    AWS Region
                    <Input placeholder="us-east-1" {...form.register('region')} />
                  </label>
                  <label>
                    Authentication mode
                    <Select {...form.register('authMode')}>
                      <option value="apiKey">Bedrock API key</option>
                      <option value="chain">Default credential chain / IAM role</option>
                      <option value="explicit">Explicit encrypted credentials</option>
                    </Select>
                  </label>
                </div>
                <label className="block">
                  Inference profile ARN
                  <Input
                    placeholder="arn:aws:bedrock:us-east-1:123456789012:inference-profile/…"
                    {...form.register('inferenceProfileArn')}
                  />
                </label>
                {authMode === 'apiKey' && (
                  <div className="space-y-4 rounded-lg border border-stone-200 bg-stone-50 p-5">
                    <p className="flex items-center gap-2 text-xs text-stone-500">
                      <LockKeyhole className="size-4" />
                      {query.data.hasCredentials
                        ? 'An encrypted API key is saved. Leave blank to keep it.'
                        : 'No API key saved.'}{' '}
                      Saved keys are never returned.
                    </p>
                    <label className="block">
                      Bedrock API key
                      <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="Created in the Bedrock console under API keys"
                        {...form.register('apiKey')}
                      />
                    </label>
                  </div>
                )}
                {authMode === 'explicit' && (
                  <div className="space-y-4 rounded-lg border border-stone-200 bg-stone-50 p-5">
                    <p className="flex items-center gap-2 text-xs text-stone-500">
                      <LockKeyhole className="size-4" />
                      {query.data.hasCredentials
                        ? 'Encrypted credentials are saved. Leave blank to retain them.'
                        : 'No explicit credentials saved.'}{' '}
                      Saved secret values are never returned.
                    </p>
                    <div className="field-grid">
                      <label>
                        Access key ID
                        <Input
                          type="password"
                          autoComplete="off"
                          {...form.register('accessKeyId')}
                        />
                      </label>
                      <label>
                        Secret access key
                        <Input
                          type="password"
                          autoComplete="new-password"
                          {...form.register('secretAccessKey')}
                        />
                      </label>
                    </div>
                    <label className="block">
                      Session token (optional)
                      <Textarea autoComplete="off" {...form.register('sessionToken')} />
                    </label>
                  </div>
                )}
                <div className="field-grid">
                  <label>
                    Timeout (milliseconds)
                    <Input
                      type="number"
                      min="1000"
                      max="120000"
                      {...form.register('timeoutMs', { valueAsNumber: true })}
                    />
                  </label>
                  <label>
                    Retry limit
                    <Input
                      type="number"
                      min="0"
                      max="5"
                      {...form.register('retries', { valueAsNumber: true })}
                    />
                  </label>
                  <label>
                    Maximum output tokens
                    <Input
                      type="number"
                      min="100"
                      max="16000"
                      {...form.register('maxTokens', { valueAsNumber: true })}
                    />
                  </label>
                </div>
                <div className="space-y-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" {...form.register('shareSamples')} />
                    Allow bounded samples to be shared with Bedrock
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" {...form.register('maskSamples')} />
                    Mask sample values before sharing
                  </label>
                  <p className="text-xs leading-5 text-stone-500">
                    Only necessary profiling metadata and permitted bounded samples are sent. CSV
                    text is treated as data. The assistant cannot execute SQL, access the
                    repository, or deploy changes.
                  </p>
                </div>
                {Object.keys(form.formState.errors).length > 0 && (
                  <Notice danger>
                    {Object.values(form.formState.errors)
                      .map((e) => e.message)
                      .join('; ')}
                  </Notice>
                )}
                {save.isError && <Notice danger>{message(save.error)}</Notice>}
                {save.isSuccess && (
                  <Notice>
                    Settings saved. Secret values are encrypted with the server's external
                    encryption key.
                  </Notice>
                )}
                <div className="flex flex-wrap justify-end gap-3 border-t border-stone-100 pt-5">
                  <Button
                    variant="outline"
                    type="button"
                    disabled={test.isPending}
                    onClick={() => test.mutate()}
                  >
                    <PlugZap className="size-4" />
                    {test.isPending ? 'Testing…' : 'Test saved connection'}
                  </Button>
                  <Button type="submit" disabled={save.isPending}>
                    <Save className="size-4" />
                    Save settings
                  </Button>
                </div>
                {test.isError && <Notice danger>{message(test.error)}</Notice>}
                {test.isSuccess && <Notice>Bedrock connection succeeded.</Notice>}
              </div>
            </Card>
          </form>
          <Card>
            <CardHeader
              title="Test a schema recommendation"
              description="Use an existing upload to test the saved profile, permissions and structured response validation."
            />
            <div className="space-y-4 p-6">
              <div className="field-grid">
                <label>
                  Upload ID
                  <Input
                    value={uploadId}
                    onChange={(e) => setUploadId(e.target.value)}
                    placeholder="UUID from a CSV upload"
                  />
                </label>
                <label>
                  Proposed table
                  <Input value={table} onChange={(e) => setTable(e.target.value)} />
                </label>
              </div>
              <Button
                variant="outline"
                disabled={!uploadId || recommend.isPending}
                onClick={() => recommend.mutate()}
              >
                <Sparkles className="size-4" />
                {recommend.isPending ? 'Requesting recommendation…' : 'Test schema recommendation'}
              </Button>
              {recommend.isError && <Notice danger>{message(recommend.error)}</Notice>}
              {recommend.data && (
                <pre className="max-h-96 overflow-auto rounded-lg bg-stone-50 p-4 text-xs leading-6">
                  {JSON.stringify(recommend.data, null, 2)}
                </pre>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

const userRowSchema = z.object({ id: z.string(), email: z.string(), role: roles });
const grantSchema = z.object({ datasetId: z.string(), canImport: z.boolean() });
const newUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Use at least 12 characters'),
  role: roles,
});

/** Local accounts and per-dataset grants. Admins see everything; others need explicit grants. */
export function UsersSettings() {
  const client = useQueryClient();
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api('/users', z.array(userRowSchema)),
  });
  const datasets = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api('/datasets', z.array(datasetSchema)),
  });
  const [selected, setSelected] = useState('');
  const grants = useQuery({
    queryKey: ['grants', selected],
    queryFn: () => api(`/users/${selected}/grants`, z.array(grantSchema)),
    enabled: !!selected,
  });
  const form = useForm<z.infer<typeof newUserSchema>>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { email: '', password: '', role: 'viewer' },
  });
  const create = useMutation({
    mutationFn: (values: z.infer<typeof newUserSchema>) => post('/users', userRowSchema, values),
    onSuccess: () => {
      form.reset({ email: '', password: '', role: 'viewer' });
      void client.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const grant = useMutation({
    mutationFn: (body: { datasetId: string; canImport: boolean; revoke?: boolean }) =>
      put(`/users/${selected}/grants`, unknownSchema, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['grants', selected] }),
  });
  const user = users.data?.find((u) => u.id === selected);
  return (
    <>
      <PageHeading
        title="Settings"
        description="Application roles are enforced by the API. Superset has its own separate accounts and permissions."
      />
      <Tabs active="users" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Users"
            description="Select an operator or viewer to manage dataset access."
          />
          {users.isPending ? (
            <Loading />
          ) : (
            <ul className="divide-y divide-stone-100">
              {users.data?.map((u) => (
                <li key={u.id}>
                  <button
                    className={`flex w-full justify-between px-5 py-3 text-left text-sm ${u.id === selected ? 'bg-teal-50' : ''}`}
                    onClick={() => setSelected(u.id)}
                  >
                    <span>{u.email}</span>
                    <span className="text-stone-500">{u.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="grid gap-3 border-t border-stone-100 p-5"
            onSubmit={(e) => void form.handleSubmit((values) => create.mutate(values))(e)}
          >
            <p className="text-sm font-medium">Add a user</p>
            <Input aria-label="New user email" placeholder="Email" {...form.register('email')} />
            <Input
              aria-label="New user password"
              type="password"
              placeholder="Initial password (12+ characters)"
              autoComplete="new-password"
              {...form.register('password')}
            />
            <Select aria-label="New user role" {...form.register('role')}>
              <option value="viewer">Viewer — read granted datasets</option>
              <option value="operator">Operator — import into granted datasets</option>
              <option value="admin">Admin — full platform administration</option>
            </Select>
            {Object.values(form.formState.errors).map((e) => (
              <Notice key={e.message} danger>
                {e.message ?? 'Invalid value'}
              </Notice>
            ))}
            {create.error && <Notice danger>{message(create.error)}</Notice>}
            <Button type="submit" disabled={create.isPending}>
              Create user
            </Button>
          </form>
        </Card>
        <Card>
          <CardHeader
            title="Dataset access"
            description={user ? user.email : 'Select a user to edit grants.'}
          />
          {user?.role === 'admin' ? (
            <div className="p-5">
              <Notice>Admins can access every dataset.</Notice>
            </div>
          ) : user ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dataset</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.data?.map((d) => {
                    const current = grants.data?.find((g) => g.datasetId === d.id);
                    const value = !current ? 'none' : current.canImport ? 'import' : 'view';
                    return (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td>
                          <Select
                            aria-label={`Access to ${d.name}`}
                            value={value}
                            onChange={(e) =>
                              grant.mutate({
                                datasetId: d.id,
                                canImport: e.target.value === 'import',
                                ...(e.target.value === 'none' ? { revoke: true } : {}),
                              })
                            }
                          >
                            <option value="none">No access</option>
                            <option value="view">View records</option>
                            {user.role === 'operator' && (
                              <option value="import">View and import</option>
                            )}
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {grant.error && <Notice danger>{message(grant.error)}</Notice>}
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}

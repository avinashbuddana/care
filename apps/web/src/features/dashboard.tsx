'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Database,
  ArrowUpRight,
  ArrowRight,
  FileCheck2,
  UploadCloud,
  GitPullRequest,
  CheckCircle2,
  FileCode2,
  ShieldCheck,
} from 'lucide-react';
import { api, datasetSchema, jobSchema, proposalSchema } from '../lib/api/client';
import { useSession } from '../hooks/use-session';
import { PageHeading } from '../components/layout/page-heading';
import { Button } from '../components/ui/button';
import { Card, CardHeader, Badge } from '../components/ui/card';
import { Empty, Loading, Notice } from '../components/ui/feedback';
import { date, message } from '../lib/utils';
export function Dashboard() {
  const session = useSession();
  const datasets = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api('/datasets', z.array(datasetSchema)),
  });
  const imports = useQuery({
    queryKey: ['imports'],
    queryFn: () => api('/imports', z.array(jobSchema)),
    enabled: session.data?.role !== 'viewer',
  });
  const proposals = useQuery({
    queryKey: ['proposals'],
    queryFn: () => api('/proposals', z.array(proposalSchema)),
    enabled: session.data?.role === 'admin',
  });
  if (datasets.isPending || (session.data?.role !== 'viewer' && imports.isPending))
    return <Loading />;
  if (datasets.isError || imports.isError)
    return <Notice danger>{message(datasets.error ?? imports.error)}</Notice>;
  const ready = datasets.data.filter((d) => d.status === 'ready');
  const completed = (imports.data ?? []).filter((j) => j.status === 'completed');
  const total = completed.reduce((n, j) => n + j.counts.inserted + j.counts.updated, 0);
  return (
    <>
      <PageHeading
        title="A clear view of your migration"
        description="From source files to trusted data. Keep every step reviewed, verified, and moving forward."
        action={
          session.data?.role !== 'viewer' && (
            <Button asChild>
              <Link href="/admin/imports">
                <UploadCloud className="size-4" />
                New import
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Registered datasets',
            value: datasets.data.length,
            note: `${ready.length} ready for import`,
            icon: Database,
          },
          {
            label: 'Schema proposals',
            value: proposals.data?.length ?? '—',
            note:
              session.data?.role === 'admin' ? 'Review before deployment' : 'Administrator managed',
            icon: GitPullRequest,
          },
          {
            label: 'Completed imports',
            value: session.data?.role === 'viewer' ? '—' : completed.length,
            note: `${(imports.data ?? []).length} total import jobs`,
            icon: FileCheck2,
          },
          {
            label: 'Records published',
            value: session.data?.role === 'viewer' ? '—' : total.toLocaleString(),
            note: 'Inserted + changed records',
            icon: UploadCloud,
          },
        ].map(({ label, value, note, icon: Icon }) => (
          <Card key={label} className="p-5">
            <div className="flex items-center justify-between text-xs text-stone-500">
              {label}
              <Icon className="size-4 text-stone-400" />
            </div>
            <p className="mt-5 text-3xl font-semibold tracking-tight">{value}</p>
            <p className="mt-3 text-xs text-stone-400">{note}</p>
          </Card>
        ))}
      </div>
      <Card className="mb-8 overflow-hidden">
        <div className="grid lg:grid-cols-[1fr_1.3fr]">
          <div className="bg-[#edf3ee] px-7 py-8">
            <div className="mb-4 flex size-9 items-center justify-center rounded-lg bg-white text-teal-800">
              <ShieldCheck className="size-5" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">
              Good data starts with a good schema.
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-stone-500">
              Analyze a CSV, review a schema recommendation, and hand approved artifacts to your
              developer. Imports open only after deployment is verified.
            </p>
            {session.data?.role === 'admin' && (
              <Link
                href="/admin/schema-proposals"
                className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-teal-800"
              >
                Create a schema proposal
                <ArrowRight className="size-4" />
              </Link>
            )}
          </div>
          <div className="flex items-center px-8 py-8">
            <ol className="grid w-full gap-6 sm:grid-cols-3">
              {[
                {
                  n: '01',
                  title: 'Review a schema',
                  text: 'Profile source files and confirm the right structure.',
                  icon: FileCode2,
                },
                {
                  n: '02',
                  title: 'Deploy & verify',
                  text: 'Apply reviewed code through your repository.',
                  icon: CheckCircle2,
                },
                {
                  n: '03',
                  title: 'Validate & import',
                  text: 'Check every row before publishing data.',
                  icon: UploadCloud,
                },
              ].map(({ n, title, text, icon: Icon }) => (
                <li key={n}>
                  <div className="flex items-center gap-2 text-teal-700">
                    <Icon className="size-4" />
                    <span className="text-[10px] tracking-wider">STEP {n}</span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{title}</h3>
                  <p className="mt-2 text-xs leading-5 text-stone-500">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Your datasets"
            description="The destination for your next import."
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/datasets">
                  View all
                  <ArrowUpRight className="size-3" />
                </Link>
              </Button>
            }
          />
          {datasets.data.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dataset</th>
                    <th>Schema</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {datasets.data.slice(0, 5).map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="flex size-8 items-center justify-center rounded-lg border border-stone-200">
                            <Database className="size-4 text-teal-700" />
                          </span>
                          <span className="font-medium">{d.name}</span>
                        </div>
                      </td>
                      <td className="text-stone-500">app.{d.contract.table}</td>
                      <td>
                        <Badge tone={d.status === 'ready' ? 'success' : 'warning'}>
                          {d.status.replaceAll('_', ' ')}
                        </Badge>
                      </td>
                      <td>
                        <Link aria-label={`View ${d.name} records`} href={`/data/${d.id}`}>
                          <ArrowUpRight className="size-4 text-stone-400" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Your workspace is ready">
              Start with a CSV schema proposal, or deploy a dataset through your repository.
            </Empty>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Recent imports"
            description="A traceable path from file to publication."
          />
          {(imports.data ?? []).length ? (
            <div className="divide-y divide-stone-100">
              {(imports.data ?? []).slice(0, 4).map((j) => (
                <Link
                  key={j.id}
                  href={`/admin/imports?job=${j.id}`}
                  className="flex items-center gap-3 px-6 py-4 hover:bg-stone-50"
                >
                  <span className="flex size-9 items-center justify-center rounded-full bg-stone-50 text-stone-500">
                    <UploadCloud className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {datasets.data.find((d) => d.id === j.datasetId)?.name ?? 'Dataset import'}
                    </p>
                    <p className="mt-1 text-[11px] text-stone-400">{date(j.createdAt)}</p>
                  </div>
                  <Badge
                    tone={
                      j.status === 'completed'
                        ? 'success'
                        : j.status.includes('fail')
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {j.status}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="No imports yet">
              Once a dataset is ready, upload and validate your first CSV.
            </Empty>
          )}
        </Card>
      </div>
    </>
  );
}

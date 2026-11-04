'use client';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Database, CheckCheck, ArrowUpRight, FilePlus2, RefreshCw } from 'lucide-react';
import { api, post, datasetSchema } from '../lib/api/client';
import { useSession } from '../hooks/use-session';
import { PageHeading } from '../components/layout/page-heading';
import { Card, CardHeader, Badge } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Notice, Loading, Empty } from '../components/ui/feedback';
import { message } from '../lib/utils';
const verificationSchema = z.object({ ready: z.boolean(), errors: z.array(z.string()) });
export function Datasets() {
  const session = useSession();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api('/datasets', z.array(datasetSchema)),
  });
  const verify = useMutation({
    mutationFn: (id: string) => post(`/datasets/${id}/verify`, verificationSchema),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['datasets'] });
    },
  });
  return (
    <>
      <PageHeading
        title="Datasets"
        description="Repository-managed business schemas. Every dataset must pass server-side verification before an import can publish records."
        action={
          session.data?.role === 'admin' && (
            <Button asChild>
              <Link href="/admin/schema-proposals">
                <FilePlus2 className="size-4" />
                New schema proposal
              </Link>
            </Button>
          )
        }
      />
      {verify.isError && (
        <div className="mb-5">
          <Notice danger>{message(verify.error)}</Notice>
        </div>
      )}
      {verify.data && (
        <div className="mb-5">
          <Notice danger={!verify.data.ready}>
            {verify.data.ready ? (
              'Schema verified. This dataset is ready for import.'
            ) : (
              <>
                <p className="font-medium">Deployment verification needs attention</p>
                <ul className="mt-2 list-disc pl-5">
                  {verify.data.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </>
            )}
          </Notice>
        </div>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Notice danger>{message(query.error)}</Notice>
      ) : (
        <Card>
          <CardHeader
            title="Dataset registry"
            description={`${query.data.length} datasets · app namespace`}
            action={
              <Button
                variant="ghost"
                size="sm"
                aria-label="Refresh datasets"
                onClick={() => {
                  void query.refetch();
                }}
              >
                <RefreshCw className="size-4" />
              </Button>
            }
          />
          {query.data.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dataset</th>
                    <th>Destination</th>
                    <th>Contract</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 items-center justify-center rounded-lg bg-teal-50">
                            <Database className="size-4 text-teal-800" />
                          </span>
                          <div>
                            <p className="font-medium">{d.name}</p>
                            <p className="mt-1 text-[11px] text-stone-400">
                              {d.contract.columns.length} business columns
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="font-mono text-xs text-stone-500">app.{d.contract.table}</td>
                      <td>v{d.contract.version}</td>
                      <td>
                        <Badge tone={d.status === 'ready' ? 'success' : 'warning'}>
                          {d.status.replaceAll('_', ' ')}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex gap-2">
                          {session.data?.role === 'admin' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={verify.isPending}
                              onClick={() => verify.mutate(d.id)}
                            >
                              <CheckCheck className="size-3" />
                              Check schema
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/data/${d.id}`}>
                              Records
                              <ArrowUpRight className="size-3" />
                            </Link>
                          </Button>
                          {session.data?.role !== 'viewer' && d.status === 'ready' && (
                            <Button size="sm" asChild>
                              <Link href={`/admin/imports?dataset=${d.id}`}>Import CSV</Link>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No datasets registered">
              Create a schema proposal and generate its handoff, then deploy the reviewed artifacts.
            </Empty>
          )}
        </Card>
      )}
    </>
  );
}

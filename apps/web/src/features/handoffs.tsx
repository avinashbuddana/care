'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Copy, Download, PackageOpen, Check, ArrowUpRight } from 'lucide-react';
import { api, handoffSchema, proposalSchema } from '../lib/api/client';
import { PageHeading } from '../components/layout/page-heading';
import { Button } from '../components/ui/button';
import { Card, CardHeader, Badge } from '../components/ui/card';
import { Loading, Empty, Notice } from '../components/ui/feedback';
import { message } from '../lib/utils';
export function Handoffs() {
  const query = useQuery({
    queryKey: ['handoffs'],
    queryFn: () => api('/handoffs', z.array(handoffSchema)),
  });
  const proposals = useQuery({
    queryKey: ['proposals'],
    queryFn: () => api('/proposals', z.array(proposalSchema)),
  });
  const [id, setId] = useState('');
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');
  const handoff = query.data?.find((h) => h.id === id) ?? query.data?.[0];
  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setCopyError('');
    } catch {
      setCopyError(
        'Clipboard access is unavailable. Select and copy the displayed content manually.',
      );
    }
  }
  return (
    <>
      <PageHeading
        title="Developer handoffs"
        description="Complete proposed artifacts, compiled from validated contracts and versioned templates. Review and apply them through your repository."
        action={
          handoff && (
            <Button asChild>
              <a href={`/api/handoffs/${handoff.id}/download`}>
                <Download className="size-4" />
                Download package
              </a>
            </Button>
          )
        }
      />
      <div className="mb-6">
        <Notice>
          These artifacts are proposed. They have not been applied or verified in your environment.
          Only a successful server-side schema check can enable imports.
        </Notice>
      </div>
      {copyError && (
        <div className="mb-5">
          <Notice danger>{copyError}</Notice>
        </div>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Notice danger>{message(query.error)}</Notice>
      ) : !handoff ? (
        <Card>
          <Empty title="No handoffs generated">
            <PackageOpen className="mx-auto mb-4 size-7 text-stone-300" />
            Approve a schema proposal, then generate its developer handoff.
            <div className="mt-5">
              <Button asChild variant="outline">
                <Link href="/admin/schema-proposals">Open proposals</Link>
              </Button>
            </div>
          </Empty>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center gap-4 p-5">
              <label className="flex-1">
                Approved proposal
                <select
                  className="mt-2 h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm"
                  value={handoff.id}
                  onChange={(e) => setId(e.target.value)}
                >
                  {query.data.map((h) => (
                    <option key={h.id} value={h.id}>
                      {proposals.data?.find((p) => p.id === h.proposalId)?.name ?? h.proposalId} ·
                      version {h.proposalVersion}
                    </option>
                  ))}
                </select>
              </label>
              <Badge tone="warning">Awaiting developer deployment</Badge>
              <Button variant="outline" asChild>
                <Link href="/admin/datasets">
                  Check schema availability
                  <ArrowUpRight className="size-3" />
                </Link>
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Choose one migration approach"
              description="The package includes a reviewed migration alternative. Do not create two equivalent migrations."
            />
            <div className="grid gap-5 p-6 md:grid-cols-2">
              <div className="rounded-lg border border-stone-200 p-5">
                <Badge>A · Generate locally</Badge>
                <p className="mt-3 text-sm leading-6 text-stone-600">
                  Add and register the proposed entity, generate a migration locally, and inspect
                  the SQL against the approved contract. Follow the package README for the
                  repository commands.
                </p>
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-5">
                <Badge tone="success">B · Review supplied migration</Badge>
                <p className="mt-3 text-sm leading-6 text-stone-600">
                  Add the proposed entity and provided migration directly. Review the complete
                  up/down methods, register the contract, build, and run pending migrations.
                </p>
              </div>
            </div>
          </Card>
          {handoff.artifacts.map((artifact, i) => (
            <Card key={`${artifact.path}-${i}`}>
              <CardHeader
                title={artifact.path}
                description={artifact.explanation}
                action={
                  <div className="flex items-center gap-2">
                    <Badge>{artifact.action}</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void copy(artifact.path, `path-${i}`);
                      }}
                    >
                      {copied === `path-${i}` ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      Copy path
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void copy(artifact.content, `code-${i}`);
                      }}
                    >
                      {copied === `code-${i}` ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      Copy code
                    </Button>
                  </div>
                }
              />
              <div className="overflow-x-auto rounded-b-xl bg-[#192822] p-6">
                <pre className="text-xs leading-6 text-[#dce9df]">
                  <code>{artifact.content}</code>
                </pre>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

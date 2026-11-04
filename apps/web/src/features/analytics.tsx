'use client';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ChartNoAxesCombined, ArrowUpRight, ShieldCheck, Database } from 'lucide-react';
import { api } from '../lib/api/client';
import { PageHeading } from '../components/layout/page-heading';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Notice, Loading } from '../components/ui/feedback';
import { message } from '../lib/utils';
const schema = z
  .object({ url: z.string().url(), separateAuthentication: z.literal(true) })
  .superRefine((value, ctx) => {
    if (!['http:', 'https:'].includes(new URL(value.url).protocol))
      ctx.addIssue({ code: 'custom', message: 'Unsupported analytics URL protocol' });
  });
export function Analytics() {
  const query = useQuery({ queryKey: ['analytics'], queryFn: () => api('/analytics', schema) });
  return (
    <>
      <PageHeading
        title="Analytics"
        description="Explore approved reporting data in Apache Superset, a separate analytics application."
      />
      <Card className="max-w-4xl overflow-hidden">
        <div className="bg-[#edf3ee] p-8">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white text-teal-800">
            <ChartNoAxesCombined className="size-6" />
          </span>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight">
            A space to see the bigger picture.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-stone-500">
            Build charts and explore approved reporting views. Superset connects directly to the
            reporting namespace through dedicated read-only credentials.
          </p>
        </div>
        <div className="space-y-6 p-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <ShieldCheck className="mb-3 size-5 text-teal-700" />
              <h3 className="text-sm font-semibold">Separate access controls</h3>
              <p className="mt-2 text-xs leading-6 text-stone-500">
                Your application role does not grant Superset access. Sign in with the analytics
                credentials provided by your administrator.
              </p>
            </div>
            <div>
              <Database className="mb-3 size-5 text-teal-700" />
              <h3 className="text-sm font-semibold">Approved reporting views</h3>
              <p className="mt-2 text-xs leading-6 text-stone-500">
                Only deliberately published fields are exposed. Business CSV imports remain in the
                platform's validation workflow.
              </p>
            </div>
          </div>
          {query.isPending ? (
            <Loading />
          ) : query.isError ? (
            <Notice danger>{message(query.error)}</Notice>
          ) : (
            <Button asChild>
              <a href={query.data.url} target="_blank" rel="noopener noreferrer">
                Open Apache Superset
                <ArrowUpRight className="size-4" />
              </a>
            </Button>
          )}
          <p className="text-[11px] text-stone-400">
            Opens in a new tab. Initial example charts use clearly labeled synthetic data.
          </p>
        </div>
      </Card>
    </>
  );
}

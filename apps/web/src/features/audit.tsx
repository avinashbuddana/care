'use client';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api, auditSchema } from '../lib/api/client';
import { PageHeading } from '../components/layout/page-heading';
import { Card, CardHeader, Badge } from '../components/ui/card';
import { Loading, Notice, Empty } from '../components/ui/feedback';
import { date, message } from '../lib/utils';
export function Audit() {
  const query = useQuery({
    queryKey: ['audit'],
    queryFn: () => api('/audit', z.array(auditSchema)),
  });
  return (
    <>
      <PageHeading
        title="Audit trail"
        description="Schema decisions, settings changes, verification, and import publication. Secrets are excluded from audit payloads."
      />
      <Card>
        <CardHeader
          title="Recent audit events"
          description="Append-only platform activity, newest first."
        />
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <Notice danger>{message(query.error)}</Notice>
        ) : query.data.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Time</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Badge>{event.action}</Badge>
                    </td>
                    <td className="max-w-44 truncate font-mono text-[11px] text-stone-500">
                      {event.actorId ?? 'System'}
                    </td>
                    <td className="whitespace-nowrap text-xs text-stone-500">
                      {date(event.createdAt)}
                    </td>
                    <td>
                      <details>
                        <summary className="cursor-pointer text-xs text-teal-800">
                          View payload
                        </summary>
                        <pre className="mt-3 max-w-xl overflow-auto text-[11px] leading-5">
                          {JSON.stringify(event.details, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No audit events yet">
            Platform actions appear here as the workspace is used.
          </Empty>
        )}
      </Card>
    </>
  );
}

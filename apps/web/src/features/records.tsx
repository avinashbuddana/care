'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { z } from 'zod';
import { ChevronLeft, ChevronRight, ArrowDownUp, Search } from 'lucide-react';
import { api, datasetSchema } from '../lib/api/client';
import { PageHeading } from '../components/layout/page-heading';
import { Input, Select } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Card, Badge } from '../components/ui/card';
import { Notice, Loading, Empty } from '../components/ui/feedback';
import { message } from '../lib/utils';
const recordSchema = z.record(z.unknown());
const pageSchema = z.object({
  rows: z.array(recordSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return '[unsupported value]';
}
export function Records({ datasetId }: { datasetId: string }) {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const datasets = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api('/datasets', z.array(datasetSchema)),
  });
  const dataset = datasets.data?.find((d) => d.id === datasetId);
  const sort = sorting[0];
  const params = new URLSearchParams({
    page: String(pagination.pageIndex + 1),
    pageSize: String(pagination.pageSize),
    filter,
    ...(sort ? { sort: sort.id, direction: sort.desc ? 'desc' : 'asc' } : {}),
  });
  const records = useQuery({
    queryKey: ['records', datasetId, pagination, sorting, filter],
    queryFn: () => api(`/datasets/${datasetId}/records?${params}`, pageSchema),
  });
  const names = dataset
    ? ['id', ...dataset.contract.columns.map((c) => c.name), 'created_at', 'updated_at']
    : Object.keys(records.data?.rows[0] ?? {});
  const columns: ColumnDef<Record<string, unknown>>[] = names.map((name) => ({
    id: name,
    accessorFn: (row) => row[name],
    header: () => name,
    cell: (info) => (
      <span className="block max-w-80 truncate" title={display(info.getValue())}>
        {display(info.getValue())}
      </span>
    ),
  }));
  const table = useReactTable({
    data: records.data?.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount: Math.ceil((records.data?.total ?? 0) / pagination.pageSize),
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
  });
  return (
    <>
      <PageHeading
        title={dataset?.name ?? 'Dataset records'}
        description="Published records from the verified application schema. Filter, sort, and page on the server."
        action={
          dataset && (
            <Badge tone={dataset.status === 'ready' ? 'success' : 'warning'}>
              Contract v{dataset.contract.version}
            </Badge>
          )
        }
      />
      <Card>
        <form
          className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            setPagination((p) => ({ ...p, pageIndex: 0 }));
            setFilter(search);
          }}
        >
          <div className="flex w-full max-w-lg gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 size-4 text-stone-400" />
              <Input
                aria-label="Filter records"
                className="pl-9"
                placeholder="Filter business values…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </div>
          <p className="text-xs text-stone-500">
            {records.data?.total.toLocaleString() ?? '…'} matching records
          </p>
        </form>
        {records.isPending ? (
          <Loading />
        ) : records.isError ? (
          <Notice danger>{message(records.error)}</Notice>
        ) : records.data.rows.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th key={h.id}>
                        <button
                          className="flex items-center gap-2"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <ArrowDownUp className="size-3" />
                        </button>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching records">
            Publish a validated CSV import to populate this dataset, or change your filter.
          </Empty>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 p-5">
          <div className="flex items-center gap-2 text-xs text-stone-500">
            Rows per page
            <Select
              aria-label="Rows per page"
              className="w-20"
              value={pagination.pageSize}
              onChange={(e) => setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })}
            >
              {[25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-4 text-xs text-stone-500">
            Page {pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous page"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next page"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}

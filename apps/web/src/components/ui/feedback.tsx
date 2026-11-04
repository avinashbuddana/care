import { AlertCircle, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <div
      role={danger ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-lg border p-4 text-sm ${danger ? 'border-red-200 bg-red-50 text-red-800' : 'border-teal-200 bg-teal-50 text-teal-900'}`}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
export function Loading() {
  return (
    <div role="status" className="flex items-center gap-3 p-8 text-sm text-stone-500">
      <LoaderCircle className="size-5 animate-spin" />
      Loading workspace…
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium text-stone-700">{title}</p>
      <div className="mx-auto mt-2 max-w-md text-sm text-stone-500">{children}</div>
    </div>
  );
}

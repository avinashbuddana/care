import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';
export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-xl border border-stone-200 bg-white shadow-xs', className)}
      {...props}
    />
  );
}
export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-6 py-5">
      <div>
        <h2 className="font-semibold text-stone-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        tone === 'success'
          ? 'border-teal-200 bg-teal-50 text-teal-800'
          : tone === 'warning'
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : tone === 'danger'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-stone-200 bg-stone-50 text-stone-600',
      )}
    >
      {children}
    </span>
  );
}

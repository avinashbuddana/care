import * as React from 'react';
import { cn } from '../../lib/utils';
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'w-full h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100 disabled:bg-stone-100',
        className,
      )}
      {...props}
    />
  );
}
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'w-full h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-teal-100',
        className,
      )}
      {...props}
    />
  );
}
export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full min-h-28 rounded-lg border border-stone-300 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-teal-100',
        className,
      )}
      {...props}
    />
  );
}

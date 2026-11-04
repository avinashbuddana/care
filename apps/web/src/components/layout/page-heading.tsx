import type { ReactNode } from 'react';
export function PageHeading({
  eyebrow = 'Migration workspace',
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[.2em] text-teal-700">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

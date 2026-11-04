import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(values));
}
export function date(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

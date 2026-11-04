'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  Database,
  FileCode2,
  GitBranch,
  PackageOpen,
  UploadCloud,
  Settings2,
  ScrollText,
  ChartNoAxesCombined,
  Layers3,
  ArrowUpRight,
  LogOut,
  Menu,
  ChevronRight,
  CircleHelp,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../hooks/use-session';
import { post, unknownSchema } from '../../lib/api/client';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Loading, Notice } from '../ui/feedback';
const items = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, admin: false },
  { href: '/admin/datasets', label: 'Datasets', icon: Database, admin: false },
  { href: '/admin/schema-proposals', label: 'Schema proposals', icon: FileCode2, admin: true },
  { href: '/admin/relationships', label: 'Relationships', icon: GitBranch, admin: true },
  {
    href: '/admin/developer-handoffs',
    label: 'Developer handoffs',
    icon: PackageOpen,
    admin: true,
  },
  { href: '/admin/imports', label: 'Import history', icon: UploadCloud, admin: false },
  { href: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined, admin: false },
];
export function Shell({ children }: { children: ReactNode }) {
  const session = useSession();
  const path = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const [mobile, setMobile] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  useEffect(() => {
    if (session.isError) router.replace('/login');
  }, [session.isError, router]);
  if (session.isPending || !session.data) return <Loading />;
  const user = session.data;
  const current =
    items.find((i) => path.startsWith(i.href))?.label ??
    (path.includes('settings') ? 'Settings' : path.includes('audit') ? 'Audit logs' : 'Records');
  async function logout() {
    try {
      await post('/auth/logout', unknownSchema);
      client.clear();
      router.replace('/login');
    } catch {
      setLogoutError('Sign out failed. Please try again.');
    }
  }
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-stone-200 bg-white px-5 lg:hidden">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Open navigation"
          onClick={() => setMobile(!mobile)}
        >
          <Menu className="size-5" />
        </Button>
        <Layers3 className="size-5 text-teal-800" />
        <span className="font-semibold">powerbridge</span>
      </div>
      {mobile && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-stone-200 bg-white transition-transform lg:translate-x-0',
          mobile ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Link
          href="/dashboard"
          className="flex h-20 items-center gap-3 px-6 text-xl font-semibold tracking-tight"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-teal-800 text-white">
            <Layers3 className="size-5" />
          </span>
          powerbridge
        </Link>
        <div className="mx-4 mb-7 rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Migration workspace</span>
            <span className="size-2 rounded-full bg-teal-600" />
          </div>
          <p className="mt-1 text-xs text-stone-500">Phase 1 · Power Apps → PostgreSQL</p>
        </div>
        <div className="px-6 text-[10px] font-semibold uppercase tracking-[.18em] text-stone-400">
          Workspace
        </div>
        <nav aria-label="Main navigation" className="mt-3 space-y-1 px-3">
          {items
            .filter(
              (i) =>
                (!i.admin || user.role === 'admin') &&
                !(i.href === '/admin/imports' && user.role === 'viewer'),
            )
            .map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobile(false)}
                aria-current={path.startsWith(href) ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors',
                  path.startsWith(href)
                    ? 'bg-teal-50 font-semibold text-teal-900'
                    : 'text-stone-500 hover:bg-stone-50 hover:text-stone-900',
                )}
              >
                <Icon className="size-[18px]" />
                {label}
                {path.startsWith(href) && (
                  <span className="ml-auto size-1.5 rounded-full bg-teal-700" />
                )}
              </Link>
            ))}
        </nav>
        {user.role === 'admin' && (
          <>
            <div className="mt-8 px-6 text-[10px] font-semibold uppercase tracking-[.18em] text-stone-400">
              Administration
            </div>
            <nav aria-label="Administration" className="mt-3 space-y-1 px-3">
              <Link
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px]',
                  path.includes('/settings')
                    ? 'bg-teal-50 text-teal-900'
                    : 'text-stone-500 hover:bg-stone-50',
                )}
                href="/admin/settings/repository"
              >
                <Settings2 className="size-[18px]" />
                Settings
              </Link>
              <Link
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px]',
                  path.includes('audit')
                    ? 'bg-teal-50 text-teal-900'
                    : 'text-stone-500 hover:bg-stone-50',
                )}
                href="/admin/audit-logs"
              >
                <ScrollText className="size-[18px]" />
                Audit logs
              </Link>
            </nav>
          </>
        )}
        <div className="mt-auto p-4">
          <div className="mb-5 rounded-xl bg-[#f3f6f0] p-4">
            <p className="flex items-center gap-2 text-xs font-semibold text-stone-700">
              <CircleHelp className="size-4" />A deliberate migration
            </p>
            <p className="mt-2 text-xs leading-5 text-stone-500">
              Power Apps remains your operational source during Phase 1.
            </p>
          </div>
          <div className="flex items-center gap-3 border-t border-stone-100 pt-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#e8eee8] text-sm font-semibold text-teal-900">
              {user.email.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium" title={user.email}>
                {user.email}
              </p>
              <p className="mt-0.5 text-[11px] capitalize text-stone-500">{user.role}</p>
            </div>
            <button
              aria-label="Sign out"
              onClick={() => {
                void logout();
              }}
              className="rounded-md p-2 text-stone-400 hover:bg-stone-100"
            >
              <LogOut className="size-4" />
            </button>
          </div>
          {logoutError && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {logoutError}
            </p>
          )}
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="flex h-16 items-center justify-between border-b border-stone-200 bg-white px-6 lg:px-10">
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <span>Workspace</span>
            <ChevronRight className="size-3" />
            <span className="text-stone-700">{current}</span>
          </div>
          <span className="flex items-center gap-2 rounded-full border border-stone-200 px-3 py-1.5 text-[11px] text-stone-500">
            <span className="size-1.5 rounded-full bg-teal-600" />
            Repository-managed schemas
          </span>
        </header>
        <main className="mx-auto max-w-[1600px] px-5 py-8 lg:px-10 lg:py-10">
          {path.startsWith('/admin/') &&
          user.role !== 'admin' &&
          !['/admin/datasets', '/admin/imports'].some((p) => path.startsWith(p)) ? (
            <Notice danger>This area requires an administrator role.</Notice>
          ) : (
            children
          )}
        </main>
        <footer className="flex flex-wrap justify-between gap-2 px-6 py-6 text-[11px] text-stone-400 lg:px-10">
          <span>Powerbridge · Phase 1 migration platform</span>
          <span className="flex items-center gap-1">
            Verified schema. Validated data.
            <ArrowUpRight className="size-3" />
          </span>
        </footer>
      </div>
    </div>
  );
}

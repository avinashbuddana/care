'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowRight, Layers3, ShieldCheck } from 'lucide-react';
import { post, userSchema } from '../../../lib/api/client';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { Notice } from '../../../components/ui/feedback';
import { message } from '../../../lib/utils';
const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
type Fields = z.infer<typeof schema>;
export default function Login() {
  const router = useRouter();
  const client = useQueryClient();
  const form = useForm<Fields>({ resolver: zodResolver(schema) });
  const mutation = useMutation({
    mutationFn: (body: Fields) => post('/auth/login', userSchema, body),
    onSuccess: (user) => {
      client.setQueryData(['session'], user);
      router.replace('/dashboard');
    },
  });
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between bg-teal-950 p-14 text-white lg:flex">
        <div className="flex items-center gap-3 font-semibold">
          <Layers3 className="size-7" />
          powerbridge
          <span className="ml-2 rounded border border-teal-700 px-2 py-1 text-[10px] tracking-widest text-teal-200">
            PHASE 1
          </span>
        </div>
        <div>
          <div className="mb-8 flex h-44 items-end gap-5" aria-hidden="true">
            {[60, 95, 130, 170, 140].map((h, i) => (
              <div
                key={h}
                className="w-14 rounded-t-xl border border-teal-500/30 bg-teal-700/30"
                style={{ height: h, opacity: 0.4 + i * 0.12 }}
              />
            ))}
          </div>
          <p className="text-xs uppercase tracking-[.25em] text-teal-300">
            A considered move forward
          </p>
          <h1 className="mt-5 max-w-md text-5xl font-medium leading-tight">
            Your data.
            <br />A stronger foundation.
          </h1>
          <p className="mt-6 max-w-sm leading-7 text-teal-100/70">
            Move from Power Apps to a verified PostgreSQL schema, one reviewed step at a time.
          </p>
        </div>
        <p className="text-xs text-teal-300/60">
          Review schemas. Validate every row. Publish with confidence.
        </p>
      </section>
      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-12 flex items-center gap-2 font-semibold text-teal-900 lg:hidden">
            <Layers3 />
            powerbridge
          </div>
          <span className="text-xs font-semibold uppercase tracking-widest text-teal-700">
            Migration workspace
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Welcome back</h2>
          <p className="mt-3 text-sm text-stone-500">Sign in to manage your data migration.</p>
          <form
            className="mt-9 space-y-5"
            onSubmit={(event) => {
              void form.handleSubmit((values) => mutation.mutate(values))(event);
            }}
          >
            <label className="block">
              Email address
              <Input
                type="email"
                autoComplete="username"
                placeholder="you@organization.com"
                {...form.register('email')}
              />
              {form.formState.errors.email && (
                <span className="text-xs text-red-700">Enter a valid email address.</span>
              )}
            </label>
            <label className="block">
              Password
              <Input
                type="password"
                autoComplete="current-password"
                {...form.register('password')}
              />
            </label>
            {mutation.isError && <Notice danger>{message(mutation.error)}</Notice>}
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? 'Signing in…' : 'Sign in'}
              <ArrowRight className="size-4" />
            </Button>
          </form>
          <p className="mt-8 flex items-start gap-2 text-xs leading-5 text-stone-500">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            Access is managed by your administrator. Contact them if you need an account or dataset
            permissions.
          </p>
        </div>
      </section>
    </main>
  );
}

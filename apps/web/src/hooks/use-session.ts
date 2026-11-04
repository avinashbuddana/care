'use client';
import { useQuery } from '@tanstack/react-query';
import { api, userSchema } from '../lib/api/client';
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api('/auth/me', userSchema),
    retry: false,
  });
}

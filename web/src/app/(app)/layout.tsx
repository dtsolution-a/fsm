'use client';
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import Shell from '@/components/Shell';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  useEffect(() => { if (ready && !user) router.replace('/login'); }, [ready, user, router]);
  if (!ready || !user) return <div className="p-10 text-center text-sm text-slate-400">Loading…</div>;
  if (user.role === 'engineer' || user.role === 'client') {
    return <div className="p-10 text-center text-sm text-slate-500">This admin panel is for office staff. Engineers use the mobile app.</div>;
  }
  return <Shell>{children}</Shell>;
}

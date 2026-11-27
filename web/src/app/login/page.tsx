'use client';
import { useState } from 'react';
import { ClipboardCheck, MapPinned, PackageCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button, ErrorNote, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(identifier.trim(), password); }
    catch (err: any) { setError(err.status === 401 ? 'Wrong user ID or password.' : err.message || 'Could not sign in'); }
    finally { setBusy(false); }
  }

  const points = [
    { icon: ClipboardCheck, t: 'Jobs, dispatch and closure', d: 'From service request to signed-off job, with every step recorded.' },
    { icon: PackageCheck, t: 'Stock you can trust', d: 'Available, pending and defective parts tracked separately across warehouses.' },
    { icon: MapPinned, t: 'Live field visibility', d: 'Engineer location, attendance and workload in one view.' },
  ];

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-navy p-12 text-white lg:flex">
        <div className="inline-flex w-fit items-center rounded-lg bg-white px-4 py-3"><img src="/brand/shah-logo.png" alt="Shah Engineers & Consultants" className="h-12 w-auto" /></div>
        <div className="max-w-md">
          <div className="text-5xl font-bold tracking-wide">कार्यसेतु</div>
          <h1 className="mt-3 text-xl font-medium leading-snug text-blue-100">One system for every service visit.</h1>
          <ul className="mt-9 space-y-6">
            {points.map(({ icon: Icon, t, d }) => (
              <li key={t} className="flex gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/10 text-indigo-200"><Icon size={18} strokeWidth={1.8} /></div>
                <div><div className="text-sm font-semibold">{t}</div><div className="mt-0.5 text-[13px] leading-relaxed text-slate-400">{d}</div></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="text-xs text-slate-500">© Shah Engineers &amp; Consultants Pvt. Ltd. · Adding wings to your vision</div>
      </aside>

      <main className="flex flex-1 items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <img src="/brand/shah-logo.png" alt="Shah Engineers & Consultants" className="mb-8 h-12 w-auto lg:hidden" />
          <div className="mb-1 text-[28px] font-bold tracking-wide text-indigo-900">कार्यसेतु</div>
          <h2 className="text-lg font-semibold text-slate-800">Sign in to continue</h2>
          <p className="mt-1 text-sm text-slate-500">Field service admin panel for office staff.</p>
          <div className="mt-7 space-y-4">
            <Field label="User ID or email">
              <Input autoFocus autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {error && <ErrorNote message={error} />}
            <Button type="submit" className="h-10 w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          </div>
          <p className="mt-8 text-xs text-slate-400">Engineers use the mobile app. Having trouble signing in? Contact the system administrator.</p>
        </form>
      </main>
    </div>
  );
}

'use client';
import RowActions from '@/components/RowActions';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td } from '@/components/ui';
import { fmtDateTime, post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

const ROLES = ['admin', 'ga_head', 'supervisor', 'client'];

export default function Users() {
  const { user: me } = useAuth();
  const [search, setSearch] = useState(''); const [role, setRole] = useState(''); const [sort, setSort] = useState('login'); const [zoneId, setZoneId] = useState(''); const [review, setReview] = useState(false); const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const q = useDebounced(search);
  const { data, loading, error, reload } = useFetch<any>(`/users${qs({ search: q, role, sort, zoneId, review: review ? 'true' : '', page, limit })}`);
  const zones = useFetch<any[]>('/zones');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');

  async function toggle(u: any) {
    setErr('');
    try { await post(`/users/${u.id}/${u.isActive ? 'deactivate' : 'activate'}`); reload(); } catch (e: any) { setErr(e.message); }
  }

  return (
    <>
      <PageHeader title="Users" subtitle="Office accounts and roles. Engineers are created from the Engineers page." actions={<Button onClick={() => setAdding(true)}>+ New user</Button>} />
      <Card>
        <div className="mb-4 flex gap-3">
          <Input className="max-w-xs" placeholder="Search name, email or user ID…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select className="w-52" value={zoneId} onChange={(e) => { setZoneId(e.target.value); setPage(1); }}><option value="">All branches</option>{(zones.data || []).map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select>
          <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={review} onChange={(e) => { setReview(e.target.checked); setPage(1); }} />Role to confirm</label>
          <Select className="w-48" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="login">Latest login first</option><option value="name">Name A–Z</option></Select>
          <Select className="w-44" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="">All roles</option>{[...ROLES, 'engineer'].map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</Select>
        </div>
        {(error || err) && <ErrorNote message={error || err} />}
        {loading && !data ? <Spinner /> : (
          <>
            <Table head={['Name', 'User ID', 'Role / designation', 'Branch', 'Last login', 'Status', '', 'Actions']} empty={data?.data.length === 0}>
              {data?.data.map((u: any) => (
                <tr key={u.id}>
                  <Td className="font-medium text-slate-800">{u.fullName}<div className="text-xs font-normal text-slate-400">{u.email}</div></Td>
                  <Td className="text-xs">{u.userCode || '—'}</Td>
                  <Td><Badge tone="blue">{u.role.replace('_', ' ')}</Badge>{u.legacyGroup ? <div className="text-xs text-slate-500">{u.legacyGroup}</div> : u.role === 'engineer' && !u.isActive ? <div className="text-xs text-amber-600">role to confirm</div> : null}</Td>
                  <Td className="text-xs">{u.zones.map((z: any) => z.zone.name).join(', ') || '—'}</Td>
                  <Td className="text-xs">{fmtDateTime(u.lastLoginAt)}</Td>
                  <Td><Badge tone={u.isActive ? 'green' : 'slate'}>{u.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                  <Td className="whitespace-nowrap"><Link className="mr-3 text-xs text-indigo-600 hover:underline" href={`/admin/access?user=${u.id}`}>Manage access</Link>{u.id !== me?.id && <button className="text-xs text-slate-500 hover:underline" onClick={() => toggle(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</button>}</Td>
                  <Td className="text-right"><RowActions entity="users" id={u.id} viewHref={`/admin/access?user=${u.id}`} onChanged={reload} /></Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </Card>
      <NewUser open={adding} zones={zones.data || []} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
    </>
  );
}

function NewUser({ open, zones, onClose, onDone }: { open: boolean; zones: any[]; onClose(): void; onDone(): void }) {
  const blank = { fullName: '', role: 'ga_head', password: '', email: '', phone: '', userCode: '' };
  const [f, setF] = useState(blank); const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body: any = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
      if (f.role === 'supervisor' && zoneIds.length) body.zoneIds = zoneIds;
      await post('/users', body); setF(blank); setZoneIds([]); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New user" wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name *"><Input required value={f.fullName} onChange={set('fullName')} /></Field>
          <Field label="Role *"><Select value={f.role} onChange={set('role')}>{ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</Select></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="User ID (login)"><Input value={f.userCode} onChange={set('userCode')} /></Field>
          <Field label="Password *" hint="At least 8 characters"><Input type="password" required minLength={8} value={f.password} onChange={set('password')} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
        </div>
        {f.role === 'supervisor' && (
          <Field label="Zones this supervisor can see" hint="Supervisors only see engineers in these zones">
            <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {zones.map((z) => (
                <label key={z.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${zoneIds.includes(z.id) ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600'}`}>
                  <input type="checkbox" className="sr-only" checked={zoneIds.includes(z.id)} onChange={() => setZoneIds((x) => (x.includes(z.id) ? x.filter((i) => i !== z.id) : [...x, z.id]))} />{z.name}
                </label>
              ))}
            </div>
          </Field>
        )}
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Create user</Button></div>
      </form>
    </Modal>
  );
}

'use client';
import RowActions from '@/components/RowActions';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td } from '@/components/ui';
import { post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

export default function Engineers() {
  const { user } = useAuth();
  const [search, setSearch] = useState(''); const [zoneId, setZoneId] = useState(''); const [skillId, setSkillId] = useState(''); const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const q = useDebounced(search);
  const zones = useFetch<any[]>('/zones');
  const skills = useFetch<any[]>('/lookups/skill-categories');
  const { data, loading, error, reload } = useFetch<any>(`/engineers${qs({ search: q, zoneId, skillId, page, limit, active: 'true' })}`);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader title="Engineers" subtitle="Field staff with zones and skills for smart assignment"
        actions={user?.role === 'admin' && <Button onClick={() => setAdding(true)}>+ New engineer</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-xs" placeholder="Search name, code or city…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select className="w-48" value={zoneId} onChange={(e) => { setZoneId(e.target.value); setPage(1); }}><option value="">All zones</option>{zones.data?.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select>
          <Select className="w-48" value={skillId} onChange={(e) => { setSkillId(e.target.value); setPage(1); }}><option value="">All skills</option>{skills.data?.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
        </div>
        {error && <ErrorNote message={error} />}
        {loading && !data ? <Spinner /> : (
          <>
            <Table head={['Name', 'User ID', 'Zone(s)', 'City', 'Skills', 'Phone', 'Actions']} empty={data?.data.length === 0}>
              {data?.data.map((e: any) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <Td><Link href={`/engineers/${e.id}`} className="font-medium text-indigo-600 hover:underline">{e.user.fullName}</Link></Td>
                  <Td className="text-xs text-slate-500">{e.user.userCode || '—'}</Td>
                  <Td className="text-xs">{e.zones.map((z: any) => z.zone.name).join(', ') || '—'}</Td>
                  <Td>{e.city || '—'}</Td>
                  <Td><div className="flex flex-wrap gap-1">{e.skills.map((s: any) => <Badge key={s.skillCategoryId} tone="blue">{s.skill.label}</Badge>)}{e.skills.length === 0 && <span className="text-xs text-slate-400">none tagged</span>}</div></Td>
                  <Td className="text-xs">{e.user.phone || '—'}</Td>
                  <Td className="text-right"><RowActions entity="engineers" id={e.id} viewHref={`/engineers/${e.id}`} onChanged={reload} /></Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </Card>
      <NewEngineer open={adding} zones={zones.data || []} skills={skills.data || []} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
    </>
  );
}

function NewEngineer({ open, zones, skills, onClose, onDone }: { open: boolean; zones: any[]; skills: any[]; onClose(): void; onDone(): void }) {
  const blank = { fullName: '', userCode: '', password: '', phone: '', email: '', city: '', designation: '', primaryZoneId: '' };
  const [f, setF] = useState(blank); const [skillIds, setSkillIds] = useState<string[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body: any = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
      if (skillIds.length) body.skillIds = skillIds;
      await post('/engineers', body); setF(blank); setSkillIds([]); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New engineer" wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name *"><Input required value={f.fullName} onChange={set('fullName')} /></Field>
          <Field label="User ID (login)"><Input value={f.userCode} onChange={set('userCode')} placeholder="e.g. User118" /></Field>
          <Field label="Password *" hint="At least 8 characters"><Input type="password" required minLength={8} value={f.password} onChange={set('password')} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="City"><Input value={f.city} onChange={set('city')} /></Field>
          <Field label="Designation"><Input value={f.designation} onChange={set('designation')} /></Field>
          <Field label="Primary zone"><Select value={f.primaryZoneId} onChange={set('primaryZoneId')}><option value="">—</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select></Field>
        </div>
        <Field label="Skills">
          <div className="flex flex-wrap gap-2">
            {skills.map((s) => (
              <label key={s.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${skillIds.includes(s.id) ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600'}`}>
                <input type="checkbox" className="sr-only" checked={skillIds.includes(s.id)} onChange={() => setSkillIds((x) => (x.includes(s.id) ? x.filter((i) => i !== s.id) : [...x, s.id]))} />{s.label}
              </label>
            ))}
          </div>
        </Field>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Create engineer</Button></div>
      </form>
    </Modal>
  );
}

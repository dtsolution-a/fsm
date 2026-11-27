'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Pagination, Select, Spinner, Table, Tabs, Td } from '@/components/ui';
import { patch, post, put, qs } from '@/lib/api';
import { useDebounced, useFetch } from '@/lib/hooks';

export default function Page() { return <Suspense><AccessControl /></Suspense>; }

const LEVEL_LABEL: Record<string, string> = { none: 'No access', view: 'View only', manage: 'View & change' };
const ROLE_LABEL: Record<string, string> = { ga_head: 'GA Head', supervisor: 'Supervisor / Zonal admin', engineer: 'Engineer', client: 'Client' };

function AccessControl() {
  const initialUser = useSearchParams().get('user');
  const [tab, setTab] = useState<'roles' | 'people' | 'sites'>(initialUser ? 'people' : 'roles');
  return (
    <>
      <PageHeader title="Access Control" subtitle="Who can open what. Admin always has full access. Branch users only ever see the customers, jobs and engineers of their own branch." />
      <Tabs<'roles' | 'people' | 'sites'> tabs={[{ id: 'roles', label: 'By role' }, { id: 'people', label: 'By person' }, { id: 'sites', label: 'Customer branches' }]} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'roles' && <Roles />}
        {tab === 'people' && <People initialUser={initialUser} />}
        {tab === 'sites' && <SiteBranches />}
      </div>
    </>
  );
}

// ───────── roles: one grid, screens x roles ─────────
function Roles() {
  const { data, loading, error, reload } = useFetch<any>('/access/matrix');
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [saved, setSaved] = useState('');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const roles = ['ga_head', 'supervisor', 'engineer', 'client'].filter((r) => r !== 'client');
  const value = (role: string, m: string) => draft[role]?.[m] ?? data.roles[role][m];
  const dirty = Object.values(draft).some((d) => Object.keys(d).length);
  async function save() {
    setBusy(true); setErr(''); setSaved('');
    try { for (const [role, levels] of Object.entries(draft)) if (Object.keys(levels).length) await put(`/access/roles/${role}`, { levels }); setDraft({}); setSaved('Saved. People see the change within a few seconds.'); reload(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Card title="Default access for each role" actions={<Button disabled={!dirty || busy} onClick={save}>Save changes</Button>}>
      <p className="mb-3 text-sm text-slate-500">These are the starting levels. A single person can be given more or less on the &quot;By person&quot; tab. The screens still follow each role&apos;s fixed rules (for example only an admin can create clients).</p>
      {err && <div className="mb-3"><ErrorNote message={err} /></div>}{saved && <div className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{saved}</div>}
      <Table head={['Screen', 'Admin', ...roles.map((r) => ROLE_LABEL[r])]}>
        {data.modules.map((m: any) => (
          <tr key={m.key}>
            <Td className="font-medium text-slate-800">{m.label}</Td>
            <Td><Badge tone="green">Full</Badge></Td>
            {roles.map((r) => (
              <Td key={r}>
                <Select className="w-40" value={value(r, m.key)} onChange={(e) => setDraft({ ...draft, [r]: { ...(draft[r] || {}), [m.key]: e.target.value } })}>
                  {data.levels.map((l: string) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                </Select>
              </Td>
            ))}
          </tr>
        ))}
      </Table>
      <p className="mt-3 text-xs text-slate-400">Engineers use the mobile app; their job actions are checked job by job, so this grid only matters for office screens.</p>
    </Card>
  );
}

// ───────── people ─────────
function People({ initialUser }: { initialUser: string | null }) {
  const [search, setSearch] = useState(''); const [zoneId, setZoneId] = useState(''); const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(initialUser);
  const q = useDebounced(search);
  const zones = useFetch<any[]>('/zones');
  const list = useFetch<any>(`/users${qs({ search: q, zoneId, sort: 'name', page, limit: 12 })}`);
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <div className="mb-3 space-y-2">
          <Input placeholder="Search name or user ID…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select value={zoneId} onChange={(e) => { setZoneId(e.target.value); setPage(1); }}><option value="">All branches</option>{(zones.data || []).map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select>
        </div>
        {list.loading && !list.data ? <Spinner /> : (
          <>
            <ul className="divide-y divide-slate-100 text-sm">
              {list.data?.data.map((u: any) => (
                <li key={u.id}>
                  <button onClick={() => setSel(u.id)} className={`flex w-full items-center justify-between gap-2 px-2 py-2.5 text-left hover:bg-slate-50 ${sel === u.id ? 'bg-indigo-50' : ''}`}>
                    <span><span className="font-medium text-slate-800">{u.fullName}</span><span className="block text-xs text-slate-400">{u.userCode} · {u.legacyGroup || u.role.replace('_', ' ')}</span></span>
                    <span className="text-right text-xs text-slate-400">{u.zones.map((z: any) => z.zone.name).join(', ') || '—'}{!u.isActive && <span className="block text-amber-600">inactive</span>}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination meta={list.data?.meta} onPage={setPage} />
          </>
        )}
      </Card>
      <div className="lg:col-span-3">{sel ? <Person key={sel} id={sel} zones={zones.data || []} onChanged={list.reload} /> : <Card><p className="text-sm text-slate-400">Pick a person to see and change what they can open and which branch they belong to.</p></Card>}</div>
    </div>
  );
}

const OFFICE_ROLES = ['admin', 'ga_head', 'supervisor'];

function Person({ id, zones, onChanged }: { id: string; zones: any[]; onChanged(): void }) {
  const { data, loading, error, reload } = useFetch<any>(`/access/users/${id}`);
  const mods = useFetch<any>('/access/matrix');
  const [f, setF] = useState<{ role: string; legacyGroup: string; zoneIds: string[] } | null>(null);
  const [over, setOver] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  useEffect(() => { if (data) { setF({ role: data.user.role, legacyGroup: data.user.legacyGroup || '', zoneIds: data.user.zones.map((z: any) => z.id) }); setOver({}); } }, [data]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!data || !f || !mods.data) return null;
  const u = data.user; const isAdmin = u.role === 'admin';
  const eff = (m: string) => over[m] ?? data.overrides[m] ?? '';
  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      await patch(`/users/${id}`, { role: f!.role !== u.role ? f!.role : undefined, legacyGroup: f!.legacyGroup || undefined, zoneIds: f!.zoneIds });
      if (!isAdmin && Object.keys(over).length) await put(`/access/users/${id}`, { overrides: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, v || null])) });
      setMsg('Saved.'); reload(); onChanged();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function setActive(on: boolean) {
    setBusy(true); setErr('');
    try { await post(`/users/${id}/${on ? 'activate' : 'deactivate'}`); reload(); onChanged(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Card title={`${u.fullName}`} actions={<Badge tone={u.isActive ? 'green' : 'slate'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>}>
      <div className="mb-1 text-xs text-slate-400">{u.userCode}</div>
      {!u.isActive && u.role === 'engineer' && !u.legacyGroup && <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Imported from QuikAllot without a role. Confirm the role and branch below, then press Activate.</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Role" hint={u.role === 'engineer' ? 'Engineers keep the engineer role (they use the mobile app)' : undefined}>
          <Select disabled={isAdmin || u.role === 'engineer'} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {(u.role === 'engineer' ? ['engineer'] : OFFICE_ROLES).map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Designation"><Input value={f.legacyGroup} placeholder="e.g. Executive, Service Partner Admin" onChange={(e) => setF({ ...f, legacyGroup: e.target.value })} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Branch(es)" hint={isAdmin ? 'Admin sees every branch' : 'This person sees only the customers, jobs, engineers and money of these branches'}>
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {zones.map((z) => (
              <label key={z.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${f.zoneIds.includes(z.id) ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600'}`}>
                <input type="checkbox" className="sr-only" disabled={isAdmin} checked={f.zoneIds.includes(z.id)} onChange={() => setF({ ...f, zoneIds: f.zoneIds.includes(z.id) ? f.zoneIds.filter((i) => i !== z.id) : [...f.zoneIds, z.id] })} />{z.name}
              </label>
            ))}
          </div>
        </Field>
      </div>
      <div className="mt-4">
        <div className="mb-1 text-sm font-medium text-slate-700">What this person can open</div>
        {isAdmin ? <p className="text-sm text-slate-500">Admin always has full access to everything.</p> : (
          <Table head={['Screen', 'Role default', 'For this person']}>
            {mods.data.modules.map((m: any) => (
              <tr key={m.key}>
                <Td>{m.label}</Td>
                <Td className="text-xs text-slate-500">{LEVEL_LABEL[data.roleLevels[m.key]] || '—'}</Td>
                <Td><Select className="w-44" value={eff(m.key)} onChange={(e) => setOver({ ...over, [m.key]: e.target.value })}>
                  <option value="">Same as role</option>{mods.data.levels.map((l: string) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                </Select></Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
      {err && <div className="mt-3"><ErrorNote message={err} /></div>}{msg && <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        {!isAdmin ? <Button variant="secondary" disabled={busy} onClick={() => setActive(!u.isActive)}>{u.isActive ? 'Deactivate' : 'Activate'}</Button> : <span />}
        <Button disabled={busy} onClick={save}>Save</Button>
      </div>
    </Card>
  );
}

// ───────── customer sites that are not linked to a branch yet ─────────
function SiteBranches() {
  const { data, loading, error, reload } = useFetch<any[]>('/clients/zone-labels/unlinked');
  const zones = useFetch<any[]>('/zones');
  const [pick, setPick] = useState<Record<string, string>>({});
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  async function link(label: string) {
    setErr(''); setMsg('');
    try { const r = await post('/clients/zone-labels/assign', { zoneLabel: label || '(blank)', zoneId: pick[label] }); setMsg(`${r.sitesLinked} sites linked to ${r.zone}.`); reload(); } catch (e: any) { setErr(e.message); }
  }
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  const total = (data || []).reduce((a, r) => a + r.sites, 0);
  return (
    <Card title={`Customer sites without a branch (${total})`}>
      <p className="mb-3 text-sm text-slate-500">These sites carry a place name or nothing at all in QuikAllot, so the system could not tell their branch. Until one is chosen they are visible to Admin and GA Head only. Pick a branch for a label and every site with that label moves there.</p>
      {err && <div className="mb-3"><ErrorNote message={err} /></div>}{msg && <div className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
      <Table head={['QuikAllot label', 'Sites', 'Branch', '']} empty={(data || []).length === 0}>
        {(data || []).map((r) => (
          <tr key={r.zoneLabel ?? '(blank)'}>
            <Td className="font-medium">{r.zoneLabel || <span className="text-slate-400">(blank)</span>}</Td>
            <Td>{r.sites}</Td>
            <Td><Select className="w-56" value={pick[r.zoneLabel ?? ''] || ''} onChange={(e) => setPick({ ...pick, [r.zoneLabel ?? '']: e.target.value })}><option value="">Choose branch…</option>{(zones.data || []).map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select></Td>
            <Td><Button variant="secondary" disabled={!pick[r.zoneLabel ?? '']} onClick={() => link(r.zoneLabel ?? '')}>Link</Button></Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

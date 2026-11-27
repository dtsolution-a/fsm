'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { EngineerPicker } from '@/components/pickers';
import { Badge, Button, Card, ErrorNote, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td } from '@/components/ui';
import { fmtDate, post, qs, todayIST } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

type Bucket = 'overdue' | 'month' | 'next' | 'later' | 'all';
const STATUS: Record<string, [string, 'amber' | 'blue' | 'green' | 'slate']> = { planned: ['Not assigned', 'amber'], assigned: ['Assigned', 'blue'], done: ['Done', 'green'], skipped: ['Skipped', 'slate'] };
const monthName = (ym?: string) => (ym ? new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');

export default function AmcSchedule() {
  const { user } = useAuth();
  const can = user?.role === 'admin' || user?.role === 'ga_head';
  const [bucket, setBucket] = useState<Bucket>('month');
  const [zoneId, setZoneId] = useState(''); const [type, setType] = useState(''); const [status, setStatus] = useState(''); const [search, setSearch] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const q = useDebounced(search);
  const zones = useFetch<any[]>('/zones'); const types = useFetch<any[]>('/lookups/contract-types');
  const sum = useFetch<any>(`/amc/schedule/summary${qs({ zoneId, type })}`);
  const list = useFetch<any>(`/amc/schedule${qs({ bucket: from || to ? '' : bucket, from, to, zoneId, type, status, search: q, page, limit })}`);
  const [sel, setSel] = useState<Record<string, any>>({});
  const [assigning, setAssigning] = useState(false);
  const [msg, setMsg] = useState('');

  const reset = () => { setPage(1); setSel({}); };
  useEffect(() => { setSel({}); }, [bucket]);
  const rows: any[] = list.data?.data || [];
  const selectable = rows.filter((r) => r.status === 'planned');
  const chosen = Object.values(sel);
  const allOn = selectable.length > 0 && selectable.every((r) => sel[r.id]);
  const toggle = (r: any) => setSel((s) => { const n = { ...s }; if (n[r.id]) delete n[r.id]; else n[r.id] = r; return n; });
  const reload = () => { list.reload(); sum.reload(); setSel({}); };
  const s = sum.data;

  const Tab = ({ id, label, n, sub, tone }: { id: Bucket; label: string; n?: number; sub?: string; tone?: string }) => (
    <button onClick={() => { setBucket(id); setFrom(''); setTo(''); reset(); }} className={`rounded-lg border px-4 py-2.5 text-left transition-colors ${bucket === id && !from && !to ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === 'red' && n ? 'text-rose-700' : 'text-slate-900'}`}>{n ?? '—'}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </button>
  );

  return (
    <>
      <PageHeader title="AMC / CMC service schedule" subtitle="Every planned service visit of the contracts, by month. Tick the visits, choose the engineer (the branch's own engineers come first) and assign: a job is made for each." />
      {msg && <div className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tab id="overdue" label="Late" n={s?.overdue} sub="due date passed, not done" tone="red" />
        <Tab id="month" label={monthName(s?.months.current) || 'This month'} n={s?.month.total} sub={s ? `${s.month.unassigned} not assigned` : undefined} />
        <Tab id="next" label={monthName(s?.months.next) || 'Next month'} n={s?.next.total} sub={s ? `${s.next.unassigned} not assigned` : undefined} />
        <Tab id="later" label="Later" n={s?.later.total} sub={s ? `${s.later.unassigned} not assigned` : undefined} />
        <Tab id="all" label="All visits" />
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input className="w-64" placeholder="Search client, station, contract or serial…" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} />
          <Select className="w-52" value={zoneId} onChange={(e) => { setZoneId(e.target.value); reset(); }}><option value="">All branches</option>{(zones.data || []).map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select>
          <Select className="w-48" value={type} onChange={(e) => { setType(e.target.value); reset(); }}><option value="">All contract types</option>{(types.data || []).map((t: any) => <option key={t.code} value={t.code}>{t.label}</option>)}</Select>
          <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}><option value="">Any status</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
          <span className="flex items-center gap-1.5 text-sm text-slate-500">From<Input type="date" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />to<Input type="date" className="w-40" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} /></span>
        </div>
        {can && chosen.length > 0 && (
          <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm">
            <span><b>{chosen.length}</b> visit{chosen.length > 1 ? 's' : ''} selected</span>
            <span className="flex gap-2"><Button variant="secondary" onClick={() => setSel({})}>Clear</Button><Button onClick={() => setAssigning(true)}>Assign an engineer…</Button></span>
          </div>
        )}
        {list.error && <ErrorNote message={list.error} />}
        {list.loading && !list.data ? <Spinner /> : (
          <>
            <Table head={[can ? <input key="all" type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setSel(allOn ? {} : Object.fromEntries(selectable.map((r) => [r.id, r])))} /> : '', 'Due', 'Visit', 'Client / station', 'Machine', 'Contract', 'Engineer', 'Status', '']} empty={rows.length === 0}>
              {rows.map((r) => (
                <tr key={r.id} className={sel[r.id] ? 'bg-indigo-50/60' : ''}>
                  <Td>{can && r.status === 'planned' && <input type="checkbox" aria-label="Select visit" checked={!!sel[r.id]} onChange={() => toggle(r)} />}</Td>
                  <Td className="whitespace-nowrap font-medium">{fmtDate(r.dueDate)}{r.overdue && <div><Badge tone="red">Late</Badge></div>}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{r.seq} of {r.of}</Td>
                  <Td><Link href={`/clients/${r.client.id}`} className="font-medium text-indigo-700 hover:underline">{r.client.companyName}</Link><div className="text-xs text-slate-400">{r.site?.siteName}{r.site?.zone ? ` · ${r.site.zone.name}` : ''}</div></Td>
                  <Td className="text-xs">{r.machine?.name || '—'}<div className="font-mono text-slate-400">{r.machine?.serial}</div></Td>
                  <Td className="text-xs">{r.contract.number}<div className="text-slate-400">{r.contract.type}</div></Td>
                  <Td>{r.engineer ? <span className="font-medium text-slate-800">{r.engineer.name}</span> : <span className="text-slate-400">—</span>}{r.job && <div className="text-xs"><Link href={`/jobs/${r.job.id}`} className="text-indigo-600 hover:underline">{r.job.jobNumber}</Link> <span className="text-slate-400">{r.job.status}</span></div>}</Td>
                  <Td><Badge tone={STATUS[r.status][0] ? STATUS[r.status][1] : 'slate'}>{STATUS[r.status][0]}</Badge>{r.note && <div className="mt-1 text-xs text-slate-400">{r.note}</div>}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {can && r.status === 'planned' && <span className="inline-flex gap-2"><button className="text-xs font-medium text-indigo-600 hover:underline" onClick={() => { setSel({ [r.id]: r }); setAssigning(true); }}>Assign</button><button className="text-xs text-slate-500 hover:underline" onClick={async () => { await post(`/amc/schedule/${r.id}/skip`, {}); reload(); }}>Skip</button></span>}
                    {can && r.status === 'skipped' && <button className="text-xs text-slate-500 hover:underline" onClick={async () => { await post(`/amc/schedule/${r.id}/unskip`); reload(); }}>Bring back</button>}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={list.data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </Card>
      {assigning && <AssignModal visits={chosen} onClose={() => setAssigning(false)} onDone={(m) => { setAssigning(false); setMsg(m); reload(); }} />}
    </>
  );
}

function AssignModal({ visits, onClose, onDone }: { visits: any[]; onClose(): void; onDone(m: string): void }) {
  const first0 = visits[0];
  const [eng, setEng] = useState(''); const [time, setTime] = useState('10:00');
  const [when, setWhen] = useState(first0 && first0.dueDate >= todayIST() ? first0.dueDate : todayIST()); // the day the engineer will go
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [fails, setFails] = useState<{ visitId: string; error?: string }[]>([]);
  const first = visits[0];
  const date = when;
  const branches = useMemo(() => [...new Set(visits.map((v) => v.site?.zone?.name).filter(Boolean))], [visits]);
  async function submit() {
    setBusy(true); setErr(''); setFails([]);
    try {
      const r = await post('/amc/schedule/assign', { visitIds: visits.map((v) => v.id), engineerId: eng, date: when, time });
      if (r.failed) { setFails(r.results.filter((x: any) => x.error)); if (!r.assigned) { setBusy(false); return; } }
      onDone(`${r.assigned} visit${r.assigned === 1 ? '' : 's'} assigned${r.failed ? `, ${r.failed} could not be (see the list)` : ''}.`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Assign ${visits.length} visit${visits.length > 1 ? 's' : ''}`} wide>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{visits.length === 1 ? `${first.client.companyName} · ${first.site?.siteName ?? ''} · due ${fmtDate(first.dueDate)}` : `${visits.length} visits${branches.length ? ` in ${branches.slice(0, 3).join(', ')}${branches.length > 3 ? '…' : ''}` : ''}`}</p>
        <div className="flex flex-wrap gap-4">
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">Date the engineer will go *</span><Input type="date" min={todayIST()} value={when} onChange={(e) => setWhen(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">Time</span><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
        {visits.length > 1 && <p className="text-xs text-slate-500">All {visits.length} visits are scheduled for this date. Assign them in groups if they must go on different days.</p>}
        <EngineerPicker value={eng} onChange={setEng} date={date} clientSiteId={first?.clientSiteId || undefined} label="Engineer" />
        <p className="text-xs text-slate-500">Each visit becomes a job of type “AMC Visit” on the date you choose (never in the past; the due date is only the planned month). The engineer sees it in the app and the job is linked to the contract.</p>
        {err && <ErrorNote message={err} />}
        {fails.length > 0 && <ul className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{fails.map((f) => <li key={f.visitId}>{visits.find((v) => v.id === f.visitId)?.client.companyName}: {f.error}</li>)}</ul>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!eng || !when || when < todayIST() || busy} onClick={submit}>Assign</Button></div>
      </div>
    </Modal>
  );
}

'use client';
import RowActions from '@/components/RowActions';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td } from '@/components/ui';
import { MachinePicker } from '@/components/pickers';
import { API, fmtDate, fmtDateTime, fmtMoney, post, qs, session } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

const tone = (s: string) => (s === 'expired' ? 'red' : s === 'expiring' ? 'amber' : s === 'active' ? 'green' : 'slate') as any;

export default function Page() { return <Suspense fallback={<Spinner />}><Contracts /></Suspense>; }

function Contracts() {
  const { user } = useAuth();
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') || '');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const q = useDebounced(search);
  const types = useFetch<any[]>('/lookups/contract-types');
  const { data, loading, error, reload } = useFetch<any>(`/contracts${qs({ status, type, search: q, page, limit })}`);
  const [renewing, setRenewing] = useState<any>(null);
  const [costOf, setCostOf] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const canRenew = user?.role === 'admin' || user?.role === 'ga_head';

  return (
    <>
      <PageHeader title="AMC / Contracts" subtitle="Warranty, AMC and on-call terms for every installed machine" actions={canRenew && <Button onClick={() => setCreating(true)}>+ New contract</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-xs" placeholder="Search contract, client or serial…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option><option value="active">Active</option><option value="expiring">Expiring (30 days)</option><option value="expired">Expired</option><option value="no_term">No term (on call)</option>
          </Select>
          <Select className="w-48" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">All types</option>{types.data?.map((t) => <option key={t.id} value={t.code}>{t.label}</option>)}
          </Select>
        </div>
        {error && <ErrorNote message={error} />}
        {loading && !data ? <Spinner /> : (
          <>
            <Table head={['Contract', 'Client / site', 'Machine', 'Type', 'Period', 'Visits left', 'Document', 'Status', 'Cost', '', 'Actions']} empty={data?.data.length === 0}>
              {data?.data.map((c: any) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap font-medium">{c.contractNumber}</Td>
                  <Td><Link href={`/clients/${c.client.id}`} className="text-indigo-600 hover:underline">{c.client.companyName}</Link><div className="text-xs text-slate-400">{c.siteProduct?.site.siteName}</div></Td>
                  <Td className="text-xs">{c.siteProduct?.rawModel || '—'}<div className="font-mono text-slate-400">{c.siteProduct?.serialNumber}</div></Td>
                  <Td><Badge tone="blue">{c.contractType.label}</Badge></Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(c.startDate)} → {fmtDate(c.endDate)}{c.daysToExpiry !== null && c.daysToExpiry >= 0 && <div className="text-slate-400">{c.daysToExpiry} days left</div>}</Td>
                  <Td>{c.visitsRemaining}</Td>
                  <Td><DocCell c={c} canEdit={canRenew} onChanged={reload} /></Td>
                  <Td><Badge tone={tone(c.status)}>{c.status.replace('_', ' ')}</Badge></Td>
                  <Td><button onClick={() => setCostOf(c)} className="text-xs font-medium text-indigo-600 hover:underline">Service cost</button></Td>
                  <Td>{canRenew && c.endDate && <button onClick={() => setRenewing(c)} className="text-xs font-medium text-indigo-600 hover:underline">Renew</button>}</Td>
                  <Td className="text-right"><RowActions entity="contracts" id={c.id} onChanged={reload} /></Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </Card>
      <NewContract open={creating} types={types.data || []} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />
      <CostModal c={costOf} canEdit={canRenew} onClose={() => setCostOf(null)} />
      <Renew c={renewing} onClose={() => setRenewing(null)} onDone={() => { setRenewing(null); reload(); }} />
    </>
  );
}

function Renew({ c, onClose, onDone }: { c: any; onClose(): void; onDone(): void }) {
  const [date, setDate] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<any>(null);
  if (c !== seen) { setSeen(c); setErr(''); if (c?.endDate) { const d = new Date(c.endDate); d.setUTCFullYear(d.getUTCFullYear() + 1); setDate(d.toISOString().slice(0, 10)); } }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post(`/contracts/${c.id}/renew`, { newEndDate: date }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={!!c} onClose={onClose} title={`Renew ${c?.contractNumber ?? ''}`}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-500">Current end date: <b>{fmtDate(c?.endDate)}</b>. The renewal is recorded in the contract history and free-service visits reset.</p>
        <Field label="New end date"><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Renew contract</Button></div>
      </form>
    </Modal>
  );
}

// Contract document (PDF / scanned copy): upload and download. Download goes through the API so it needs the login token.
function DocCell({ c, canEdit, onChanged }: { c: any; canEdit: boolean; onChanged(): void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function download() {
    setErr('');
    const res = await fetch(`${API}/contracts/${c.id}/document`, { headers: { Authorization: `Bearer ${session.get()?.accessToken}` } });
    if (!res.ok) { setErr('Could not download'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = c.documentName || 'contract'; a.click();
    URL.revokeObjectURL(url);
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`${API}/contracts/${c.id}/document`, { method: 'POST', headers: { Authorization: `Bearer ${session.get()?.accessToken}` }, body: fd });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message || 'Upload failed'); }
      onChanged();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="text-xs">
      {c.documentName && <button onClick={download} className="block max-w-[10rem] truncate text-indigo-600 hover:underline" title={c.documentName}>{c.documentName}</button>}
      {canEdit && (
        <label className="cursor-pointer text-slate-500 hover:text-indigo-600">
          {busy ? 'Uploading…' : c.documentName ? 'Replace' : 'Upload'}
          <input type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      )}
      {!c.documentName && !canEdit && '—'}
      {err && <div className="text-rose-600">{err}</div>}
    </div>
  );
}


// 7.3: cost of every service under the contract, running total, and the high-cost flag
function CostModal({ c, canEdit, onClose }: { c: any; canEdit: boolean; onClose(): void }) {
  const [v, setV] = useState(0);
  const { data, error, reload } = useFetch<any>(c ? `/contracts/${c.id}/costs` : null);
  const [amount, setAmount] = useState(''); const [notes, setNotes] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (!c) return null;
  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post(`/contracts/${c.id}/costs`, { amount: Number(amount), notes: notes || undefined }); setAmount(''); setNotes(''); setV(v + 1); reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Service cost — ${c.contractNumber}`} wide>
      {error && <ErrorNote message={error} />}
      {!data ? <Spinner /> : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">Contract value</div><div className="text-base font-semibold">{data.contract.value ? fmtMoney(data.contract.value) : 'Not recorded'}</div></div>
            <div className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">Service cost so far</div><div className="text-base font-semibold">{fmtMoney(data.totalCost)}</div></div>
            <div className={`rounded-md p-3 ${data.flagged ? 'bg-rose-50 text-rose-800' : 'bg-slate-50'}`}><div className="text-xs opacity-70">Cost vs value</div><div className="text-base font-semibold">{data.percentOfValue != null ? `${data.percentOfValue}%` : '—'}{data.flagged && ' · review'}</div></div>
          </div>
          {data.flagged && <p className="rounded-md bg-rose-50 p-3 text-rose-800">Service cost has reached {data.thresholdPercent}% of the contract value. Review this contract before the next renewal.</p>}
          {data.history.length === 0 ? <p className="text-slate-400">No cost recorded yet. Parts used on a visit are added automatically when the job is completed.</p> : (
            <div className="max-h-80 overflow-auto"><table className="w-full"><thead><tr className="text-left text-[11.5px] uppercase text-slate-500"><th className="sticky top-0 bg-white border-b border-slate-200 py-2 font-semibold">When</th><th className="sticky top-0 bg-white border-b border-slate-200 font-semibold">Job</th><th className="sticky top-0 bg-white border-b border-slate-200 font-semibold">Source</th><th className="sticky top-0 bg-white border-b border-slate-200 text-right font-semibold">Cost</th><th className="sticky top-0 bg-white border-b border-slate-200 text-right font-semibold">Running total</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{data.history.map((h: any) => <tr key={h.id}><td className="py-2 text-xs">{fmtDateTime(h.recordedAt)}</td><td className="text-xs">{h.jobNumber || '—'}</td><td className="text-xs">{h.source === 'auto' ? 'Parts (automatic)' : 'Entered'}{h.notes && <div className="text-slate-400">{h.notes}</div>}</td><td className="text-right tabular-nums">{fmtMoney(h.cost)}</td><td className="text-right tabular-nums">{fmtMoney(h.cumulative)}</td></tr>)}</tbody></table></div>
          )}
          {canEdit && (
            <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <Field label="Add a cost (₹)"><Input type="number" step="any" min={0} className="w-36" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <div className="min-w-48 flex-1"><Field label="What for"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. compressor replacement, travel" /></Field></div>
              <Button type="submit" disabled={busy || !amount}>Add</Button>
              {err && <div className="w-full"><ErrorNote message={err} /></div>}
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}


// 7.1: create a contract for a machine
function NewContract({ open, types, onClose, onDone }: { open: boolean; types: any[]; onClose(): void; onDone(): void }) {
  const [m, setM] = useState({ clientId: '', siteProductId: '', clientName: '' });
  const [type, setType] = useState(''); const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const [amount, setAmount] = useState(''); const [visits, setVisits] = useState(''); const [freq, setFreq] = useState(''); const [ext, setExt] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await post('/contracts', { clientId: m.clientId, siteProductId: m.siteProductId || undefined, contractTypeCode: type, startDate: start || undefined, endDate: end || undefined, amount: amount === '' ? undefined : Number(amount), freeServicesTotal: visits === '' ? undefined : Number(visits), visitFrequency: freq === '' ? undefined : Number(freq), externalContractNo: ext || undefined });
      setAmount(''); setVisits(''); setFreq(''); setExt(''); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New contract" wide>
      <form onSubmit={submit} className="space-y-3">
        <MachinePicker onChange={setM} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contract type"><Select required value={type} onChange={(e) => setType(e.target.value)}><option value="">— select —</option>{types.map((t: any) => <option key={t.id} value={t.code}>{t.label}</option>)}</Select></Field>
          <Field label="Contract value (₹)"><Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Start date"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End date"><Input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Visits included"><Input type="number" min={0} value={visits} onChange={(e) => setVisits(e.target.value)} /></Field>
          <Field label="Visits per year (frequency)"><Input type="number" min={1} value={freq} onChange={(e) => setFreq(e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field label="Contract reference number (optional)"><Input value={ext} onChange={(e) => setExt(e.target.value)} /></Field></div>
        </div>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !m.clientId || !type}>Create contract</Button></div>
      </form>
    </Modal>
  );
}

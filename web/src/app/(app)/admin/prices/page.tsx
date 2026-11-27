'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { fmtMoney, put } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

export default function PriceList() {
  return (
    <>
      <PageHeader title="Price list & travel rules" subtitle="One fixed price for each kind of job. The moment a job of that kind is completed, a draft bill is prepared (this price + any spares used) and waits in Invoices > Auto drafts for a senior person to review and issue." />
      <Prices />
      <div className="mt-4"><Travel /></div>
    </>
  );
}

function Prices() {
  const { data, loading, error, reload } = useFetch<any[]>('/billing/job-prices');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  async function save(id: string) {
    setBusy(id); setErr(''); setMsg('');
    try { const v = draft[id]; await put(`/billing/job-prices/${id}`, { price: v === '' ? null : Number(v) }); setDraft((d) => { const n = { ...d }; delete n[id]; return n; }); setMsg('Saved.'); reload(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  }
  return (
    <Card title="Fixed price for each type of job">
      {(error || err) && <ErrorNote message={error || err} />}{msg && <div className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
      {loading && !data ? <Spinner /> : (
        <Table head={['Type of job', 'Price (₹, before tax)', '']} empty={data?.length === 0}>
          {data?.map((t) => {
            const v = draft[t.id] ?? (t.defaultPrice == null ? '' : String(t.defaultPrice));
            return (
              <tr key={t.id}>
                <Td className="font-medium text-slate-800">{t.label}{!t.isActive && <span className="ml-2"><Badge>inactive</Badge></span>}<div className="font-mono text-xs font-normal text-slate-400">{t.code}</div></Td>
                <Td><div className="flex items-center gap-2"><Input type="number" min={0} step="0.01" className="w-44" placeholder="Not set" value={v} onChange={(e) => setDraft({ ...draft, [t.id]: e.target.value })} />{t.defaultPrice != null && draft[t.id] === undefined && <span className="text-xs text-slate-400">{fmtMoney(t.defaultPrice)}</span>}</div></Td>
                <Td className="text-right">{draft[t.id] !== undefined && <Button disabled={busy === t.id} onClick={() => save(t.id)}>Save</Button>}</Td>
              </tr>
            );
          })}
        </Table>
      )}
      <p className="mt-3 text-xs text-slate-400">A type with no price makes a draft with the charge left empty (or ₹0 for a visit covered by a contract). Spare parts are billed at the price set on each part. Tax is added from Billing Settings.</p>
    </Card>
  );
}

function Travel() {
  const { data, loading, error, reload } = useFetch<any>('/travel/settings');
  const [f, setF] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  useEffect(() => { if (data) setF({ ratePerKm: data.ratePerKm ?? '', toleranceKm: data.toleranceKm, tolerancePct: data.tolerancePct, arrivalRadiusM: data.arrivalRadiusM, atSiteRadiusM: data.atSiteRadiusM, delayedRequestHours: data.delayedRequestHours, requireTravelFlow: data.requireTravelFlow, demoMode: data.demoMode }); }, [data]);
  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      await put('/travel/settings', { ratePerKm: f.ratePerKm === '' ? null : Number(f.ratePerKm), toleranceKm: Number(f.toleranceKm), tolerancePct: Number(f.tolerancePct), arrivalRadiusM: Number(f.arrivalRadiusM), atSiteRadiusM: Number(f.atSiteRadiusM), delayedRequestHours: Number(f.delayedRequestHours), requireTravelFlow: !!f.requireTravelFlow, demoMode: !!f.demoMode });
      setMsg('Saved.'); reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Travel rules" actions={<Button disabled={busy} onClick={save}>Save</Button>}>
      {(error || err) && <ErrorNote message={error || err} />}{msg && <div className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
      {loading && !data ? <Spinner /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Travel allowance per km (₹)" hint="Paid to the engineer for approved kilometres. Leave empty until decided."><Input type="number" min={0} step="0.01" value={f.ratePerKm ?? ''} onChange={set('ratePerKm')} /></Field>
          <Field label="Extra km allowed over the best route" hint="Beyond this (or the % below, whichever is more) the engineer must give a reason"><Input type="number" min={0} step="0.1" value={f.toleranceKm ?? ''} onChange={set('toleranceKm')} /></Field>
          <Field label="…or this % of the best route"><Input type="number" min={0} max={100} value={f.tolerancePct ?? ''} onChange={set('tolerancePct')} /></Field>
          <Field label="QR scan must be within (metres) of the station" hint="Phone GPS is only accurate to some metres; 300 is a safe start"><Input type="number" min={10} value={f.arrivalRadiusM ?? ''} onChange={set('arrivalRadiusM')} /></Field>
          <Field label="'Already at the station' when within (metres)"><Input type="number" min={10} value={f.atSiteRadiusM ?? ''} onChange={set('atSiteRadiusM')} /></Field>
          <Field label="A request with no job is shown as delayed after (hours)"><Input type="number" min={1} value={f.delayedRequestHours ?? ''} onChange={set('delayedRequestHours')} /></Field>
          <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2 lg:col-span-3"><input type="checkbox" className="mt-1" checked={!!f.requireTravelFlow} onChange={(e) => setF({ ...f, requireTravelFlow: e.target.checked })} /><span><b>Refuse the old one-tap start.</b> When on, a job can only be started from the app with location (travel and QR scan). Switch on once all engineers use the new app.</span></label>
          <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2 lg:col-span-3"><input type="checkbox" className="mt-1" checked={!!f.demoMode} onChange={(e) => setF({ ...f, demoMode: e.target.checked })} /><span><b>Demo mode.</b> For showing the flow at a desk: the engineer still has to scan the right machine QR, but being at the site and the extra-km check are skipped. <b>Keep this off for real work.</b></span></label>
        </div>
      )}
    </Card>
  );
}

'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Input, Pagination, Spinner, Stat, Table, Td } from '@/components/ui';
import { api, fmtDateTime, fmtMoney, post, qs, todayIST } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

export const dur = (m?: number | null) => (m == null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim());
const km = (v?: number | null) => (v == null ? '—' : `${v.toFixed(1)} km`);
const MODE: Record<string, string> = { app_route: 'Used the app route', direct: 'Went on own', at_site: 'Already at site' };
const END: Record<string, string> = { completed: 'job finished', spare_hold: 'waiting for spares', other: 'stopped' };

export function ReviewBadge({ r }: { r: string }) {
  return r === 'pending' ? <Badge tone="amber">Needs a decision</Badge> : r === 'approved' ? <Badge tone="green">Approved</Badge> : r === 'rejected' ? <Badge tone="red">Not accepted</Badge> : <Badge tone="slate">Within limit</Badge>;
}

// Approve / reject a trip whose extra distance came with a reason
export function ReviewButtons({ jobId, legId, onDone }: { jobId: string; legId: string; onDone(): void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function decide(approve: boolean) {
    setBusy(true); setErr('');
    try { await post(`/jobs/${jobId}/travel/${legId}/review`, { approve }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex gap-1.5"><Button disabled={busy} onClick={() => decide(true)}>Accept</Button><Button variant="danger" disabled={busy} onClick={() => decide(false)}>Don&apos;t accept</Button></span>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </span>
  );
}

// ───────── one job: every trip, every work stretch, the totals ─────────
export function JobTravelCard({ jobId, canReview }: { jobId: string; canReview: boolean }) {
  const { data, loading, error, reload } = useFetch<any>(`/jobs/${jobId}/travel`);
  if (loading && !data) return <Card title="Travel and time"><Spinner /></Card>;
  if (error) return <Card title="Travel and time"><ErrorNote message={error} /></Card>;
  if (!data || (data.legs.length === 0 && data.sessions.length === 0)) return <Card title="Travel and time"><p className="text-sm text-slate-400">No trip or on-site time has been recorded for this job yet.</p></Card>;
  const t = data.totals;
  return (
    <Card title="Travel and time" actions={data.job.phase && <Badge tone="blue">{({ travelling: 'On the way', working: 'Working at site', on_hold: 'Waiting for spares' } as Record<string, string>)[data.job.phase] ?? data.job.phase}</Badge>}>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Trips" value={t.trips} sub={`${km(t.expectedKm)} expected`} />
        <Stat label="Distance travelled" value={km(t.actualKm)} sub={t.payableKm !== t.actualKm ? `${km(t.payableKm)} payable so far` : 'all payable'} />
        <Stat label="Travel time" value={dur(t.travelMinutes)} />
        <Stat label="Time at the machine" value={dur(t.workMinutes)} sub={t.amount != null ? `Travel claim ${fmtMoney(t.amount)}` : 'Per-km rate not set'} tone={t.pendingReview ? 'amber' : undefined} />
      </div>
      <Table head={['Trip', 'Engineer', 'How', 'Started', 'Expected', 'Actual', 'Time', 'Result']} empty={data.legs.length === 0}>
        {data.legs.map((l: any) => (
          <tr key={l.id}>
            <Td className="font-medium">{l.seq}</Td><Td>{l.engineer}</Td><Td className="text-xs">{MODE[l.mode] ?? l.mode}</Td>
            <Td className="whitespace-nowrap text-xs">{fmtDateTime(l.startedAt)}</Td>
            <Td className="tabular-nums">{km(l.expectedKm)}{l.routeSource === 'estimate' && <div className="text-[10px] text-slate-400">estimate</div>}</Td>
            <Td className="font-medium tabular-nums">{l.status === 'travelling' ? <span className="text-indigo-600">on the way</span> : km(l.actualKm)}{l.excessKm > 0 && <div className="text-xs font-normal text-rose-600">+{l.excessKm.toFixed(1)} km over</div>}</Td>
            <Td className="whitespace-nowrap">{dur(l.actualMinutes)}</Td>
            <Td>
              {l.status === 'arrived' && <ReviewBadge r={l.review} />}
              {l.arrivedBy === 'qr_override' && <div className="mt-1 text-xs text-amber-700">Arrival confirmed without a matching scan{l.arrivalDistanceM ? ` (${l.arrivalDistanceM} m away)` : ''}</div>}
              {l.reason && <div className="mt-1 max-w-xs text-xs text-slate-600">“{l.reason}”{l.reasonVoice && <span className="ml-1 text-slate-400">(spoken{l.reasonLang ? `, ${l.reasonLang}` : ''})</span>}</div>}
              {l.reviewNote && <div className="mt-1 text-xs text-slate-500">Note: {l.reviewNote}</div>}
              {canReview && l.review === 'pending' && <div className="mt-2"><ReviewButtons jobId={jobId} legId={l.id} onDone={reload} /></div>}
            </Td>
          </tr>
        ))}
      </Table>
      {data.sessions.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Time at the machine</div>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.sessions.map((s: any) => (
              <li key={s.id} className="flex justify-between py-1.5"><span>{fmtDateTime(s.startedAt)} → {s.endedAt ? fmtDateTime(s.endedAt) : <b className="text-indigo-600">still working</b>}</span><span className="text-slate-500">{dur(s.minutes)}{s.endReason ? ` · ${END[s.endReason] ?? s.endReason}` : ''}</span></li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ───────── one engineer: distance, days, claim ─────────
export function EngineerTravelCard({ engineerId }: { engineerId: string }) {
  const month = todayIST().slice(0, 7);
  const [from, setFrom] = useState(`${month}-01`); const [to, setTo] = useState(todayIST());
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(10);
  const { data, loading, error } = useFetch<any>(`/engineers/${engineerId}/travel${qs({ from, to, page, limit })}`);
  const [err, setErr] = useState('');
  async function exportCsv() {
    setErr('');
    try {
      const r = await api<{ csv: string }>('GET', `/engineers/${engineerId}/travel${qs({ from, to, format: 'csv' })}`);
      const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = `travel-${data?.engineer.userCode || 'engineer'}-${from}-${to}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <Card title="Travel and claim" actions={<div className="flex flex-wrap items-center gap-2"><Input type="date" className="w-40" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /><span className="text-slate-400">to</span><Input type="date" className="w-40" value={to} min={from} max={todayIST()} onChange={(e) => { setTo(e.target.value); setPage(1); }} /><Button variant="secondary" onClick={exportCsv}><Download size={15} /> CSV</Button></div>}>
      {(error || err) && <ErrorNote message={error || err} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Trips" value={data.totals.trips} />
            <Stat label="Distance travelled" value={km(data.totals.actualKm)} sub={`${km(data.totals.payableKm)} payable`} />
            <Stat label="Time on the road" value={dur(data.totals.minutes)} />
            <Stat label="Travel claim" value={data.totals.amount == null ? '—' : fmtMoney(data.totals.amount)} sub={data.ratePerKm == null ? 'Per-km rate not set' : `at ${fmtMoney(data.ratePerKm)} per km`} tone={data.totals.pendingReview ? 'amber' : undefined} />
          </div>
          {data.perDay.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {data.perDay.slice(0, 31).map((d: any) => <span key={d.date} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-700"><b>{d.date.slice(8)}</b>/{d.date.slice(5, 7)} · {d.km.toFixed(1)} km · {d.trips} trip{d.trips > 1 ? 's' : ''}</span>)}
            </div>
          )}
          <Table head={['Date', 'Job', 'Client / station', 'Expected', 'Actual', 'Payable', 'Claim', 'Result']} empty={data.legs.length === 0}>
            {data.legs.map((l: any) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap text-xs">{fmtDateTime(l.startedAt)}</Td>
                <Td className="font-medium">{l.job.jobNumber}</Td>
                <Td>{l.job.client}<div className="text-xs text-slate-400">{l.job.site}</div></Td>
                <Td className="tabular-nums">{km(l.expectedKm)}</Td><Td className="tabular-nums">{km(l.actualKm)}</Td><Td className="tabular-nums">{km(l.payableKm)}</Td>
                <Td className="tabular-nums">{l.amount == null ? '—' : fmtMoney(l.amount)}</Td>
                <Td><ReviewBadge r={l.review} />{l.reason && <div className="mt-1 max-w-[14rem] text-xs text-slate-500">“{l.reason}”</div>}</Td>
              </tr>
            ))}
          </Table>
          <Pagination meta={data.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
        </>
      )}
    </Card>
  );
}

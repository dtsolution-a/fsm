'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AuthImg from '@/components/AuthImage';
import { EngineerPicker, priorityTone, statusTone } from '@/components/pickers';
import { JobTravelCard } from '@/components/TravelCards';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { API, fmtDateTime, patch, post, qs, session, todayIST } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

const toLocalInput = (d?: string | null) => (d ? new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 16) : '');
const fromLocalInput = (v: string) => new Date(`${v}:00+05:30`).toISOString();

function AuthImage({ jobId, id, label }: { jobId: string; id: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null; let alive = true;
    fetch(`${API}/jobs/${jobId}/attachments/${id}`, { headers: { Authorization: `Bearer ${session.get()?.accessToken}` } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && alive) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [jobId, id]);
  return src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={label} className="h-28 w-28 rounded-lg border border-slate-200 object-cover" /></a> : <div className="h-28 w-28 animate-pulse rounded-lg bg-slate-100" />;
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { data: j, loading, error, reload } = useFetch<any>(`/jobs/${id}`);
  const [modal, setModal] = useState<'' | 'assign' | 'schedule' | 'times' | 'part' | 'cancel'>('');
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const manager = user?.role === 'admin' || user?.role === 'ga_head';

  async function act(path: string, body?: unknown, after?: () => void) {
    setBusy(true); setErr('');
    try { await post(path, body); setModal(''); after?.(); reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  if (loading && !j) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!j) return null;
  const finished = ['completed', 'closed', 'cancelled'].includes(j.status.code);
  const photos = (t: string) => j.attachments.filter((a: any) => a.type === t);

  return (
    <>
      <PageHeader title={j.jobNumber} subtitle={`${j.client.companyName}${j.site ? ' · ' + j.site.siteName : ''}`}
        actions={<Link href="/jobs" className="text-sm text-indigo-600 hover:underline">← All jobs</Link>} />
      {err && <div className="mb-3"><ErrorNote message={err} /></div>}

      {j.duplicateOf && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span>Possible duplicate of <Link className="font-medium underline" href={`/jobs/${j.duplicateOf.id}`}>{j.duplicateOf.jobNumber}</Link> (same client, site and machine).</span>
          {manager && <span className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => act(`/jobs/${id}/dismiss-duplicate`)}>Not a duplicate</Button><Button variant="danger" disabled={busy} onClick={() => act(`/jobs/${id}/merge-duplicate`)}>Merge (cancel this one)</Button></span>}
        </div>
      )}
      {j.closureApproval === 'pending' && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span><b>Backdated completion</b> — started {fmtDateTime(j.actualStart)}, completed {fmtDateTime(j.actualEnd)}. Needs GA Head approval before stock is deducted.</span>
          {manager && <span className="flex gap-2"><Button disabled={busy} onClick={() => act(`/jobs/${id}/closure/approve`)}>Approve</Button><Button variant="danger" disabled={busy} onClick={() => act(`/jobs/${id}/closure/reject`)}>Reject &amp; reopen</Button></span>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Job details" actions={<><Badge tone={priorityTone(j.priority.code)}>{j.priority.label}</Badge><Badge tone={statusTone(j.status.code)}>{j.status.label}</Badge></>}>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item k="Type" v={j.jobType.label} />
              <Item k="Ticket" v={j.serviceRequest?.ticketNumber || '—'} />
              <Item k="Machine" v={<>{j.siteProduct?.model?.name || j.siteProduct?.rawModel || '—'} <span className="font-mono text-xs text-slate-400">{j.siteProduct?.serialNumber}</span></>} />
              <Item k="Contract" v={j.contract ? `${j.contract.contractNumber} (${j.contract.contractType.label})` : 'No active contract (chargeable)'} />
              <Item k="Site" v={`${j.site?.address || j.site?.city || '—'}${j.site?.siteContactName ? ' · ' + j.site.siteContactName + ' ' + (j.site.siteContactPhone || '') : ''}`} />
              <Item k="Scheduled" v={fmtDateTime(j.scheduledStart)} />
              <Item k="Actual start" v={fmtDateTime(j.actualStart)} />
              <Item k="Actual end" v={fmtDateTime(j.actualEnd)} />
            </dl>
            {j.description && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{j.description}</p>}
            {j.closureNotes && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"><b>Closure notes:</b> {j.closureNotes}{j.signedByName && <> · signed by {j.signedByName}</>}</p>}
            {j.siteProduct && <p className="mt-3 text-xs"><Link className="text-indigo-600 hover:underline" href={`/machines/${j.siteProduct.id}`}>View full service history of this machine →</Link></p>}
          </Card>

          <Card title="Engineers" actions={manager && !finished && <Button variant="secondary" onClick={() => setModal('assign')}>{j.engineers.length ? 'Reassign' : 'Assign'}</Button>}>
            {j.engineers.length === 0 ? <p className="text-sm text-slate-400">No engineer assigned yet.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {j.engineers.map((e: any) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><b>{e.engineer.user.fullName}</b> <span className="text-slate-400">{e.engineer.user.phone}</span><Badge tone={e.role === 'primary' ? 'blue' : 'slate'}>{e.role}</Badge></span>
                    <span className="text-xs text-slate-500">
                      {e.declinedAt ? <span className="text-rose-600">Declined: {e.declineReason}</span> : e.acceptedAt ? `Accepted ${fmtDateTime(e.acceptedAt)}` : 'Not accepted yet'}
                      {e.contributionNotes && <> · {e.contributionNotes}</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Spare parts" actions={manager && !finished && <Button variant="secondary" onClick={() => setModal('part')}>+ Allocate part</Button>}>
            {j.partsUsed.length === 0 ? <p className="text-sm text-slate-400">No parts allocated or used.</p> : (
              <Table head={['Part', 'Qty', 'Engineer', 'State', '']}>
                {j.partsUsed.map((p: any) => (
                  <tr key={p.id}>
                    <Td>{p.sparePart.name}<div className="font-mono text-xs text-slate-400">{p.sparePart.partNumber}</div></Td>
                    <Td>{p.quantity}</Td><Td className="text-xs">{p.engineer.user.fullName}</Td>
                    <Td>{p.deductedAt ? <Badge tone="green">deducted from stock</Badge> : p.consumedAt ? (p.quantity === 0 ? <Badge>not used</Badge> : <Badge tone="amber">used — awaiting approval</Badge>) : <Badge tone="blue">allocated</Badge>}{p.returnQty > 0 && <div className={`mt-1 text-xs ${p.returnedAt ? 'text-emerald-700' : 'text-amber-700'}`}>{p.returnQty} {p.returnedAt ? 'received back at the hub' : 'to go back to the hub'}</div>}</Td>
                    <Td>{!p.deductedAt && manager && <button className="text-xs text-rose-600 hover:underline" onClick={async () => { try { await fetch(`${API}/jobs/${id}/parts/${p.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.get()?.accessToken}` } }); reload(); } catch {} }}>Remove</button>}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <JobTravelCard jobId={id} canReview={manager || user?.role === 'supervisor'} />

          {j.spareRequests?.length > 0 && (
            <Card title="Spare parts asked for by the engineer">
              <ul className="divide-y divide-slate-100 text-sm">
                {j.spareRequests.map((r: any) => (
                  <li key={r.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-800">{r.items.map((i: any) => `${i.quantity} × ${i.sparePart.name}`).join(', ')}</span><Badge tone={r.status === 'allocated' ? 'green' : r.status === 'requested' ? 'amber' : 'slate'}>{({ requested: 'Waiting for the hub', allocated: 'Given', rejected: 'Not available', cancelled: 'Cancelled' } as Record<string, string>)[r.status]}</Badge></div>
                    <div className="mt-0.5 text-xs text-slate-500">Asked {fmtDateTime(r.createdAt)}{r.note ? ` · “${r.note}”` : ''}{r.decisionNote ? ` · Office note: ${r.decisionNote}` : ''}{r.collectedAt ? ` · collected ${fmtDateTime(r.collectedAt)}` : ''}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {j.serviceRequest?.attachments?.length > 0 && (
            <Card title={`Photos sent with the request ${j.serviceRequest.ticketNumber}`}>
              <div className="flex flex-wrap gap-2">{j.serviceRequest.attachments.map((a: any) => <AuthImg key={a.id} path={`/service-requests/${j.serviceRequest.id}/attachments/${a.id}`} label="Request photo" />)}</div>
            </Card>
          )}

          {(photos('photo_before').length > 0 || photos('photo_after').length > 0 || photos('signature').length > 0) && (
            <Card title="Photos & signature">
              {(['photo_before', 'photo_after', 'signature'] as const).map((t) => photos(t).length > 0 && (
                <div key={t} className="mb-3"><div className="mb-1 text-xs font-medium uppercase text-slate-500">{t.replace('photo_', '').replace('_', ' ')}</div><div className="flex flex-wrap gap-2">{photos(t).map((a: any) => <AuthImage key={a.id} jobId={id} id={a.id} label={t} />)}</div></div>
              ))}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {manager && !finished && j.status.code !== 'pending_review' && (
            <Card title="Actions">
              <div className="flex flex-col gap-2">
                <Button variant="secondary" onClick={() => setModal('schedule')}>Reschedule</Button>
                {j.status.code === 'on_hold' ? <Button variant="secondary" disabled={busy} onClick={() => act(`/jobs/${id}/status`, { status: 'open' })}>Resume (set Open)</Button> : <Button variant="secondary" disabled={busy} onClick={() => act(`/jobs/${id}/status`, { status: 'on_hold' })}>Put on hold</Button>}
                <Button variant="secondary" onClick={() => setModal('times')}>Edit start / end time</Button>
                <Button variant="danger" onClick={() => setModal('cancel')}>Cancel job</Button>
              </div>
            </Card>
          )}
          {manager && j.status.code === 'completed' && <Card title="Actions"><Button disabled={busy} onClick={() => act(`/jobs/${id}/close`)}>Close job</Button><p className="mt-2 text-xs text-slate-400">Closing locks the job and prepares a draft invoice for you to fill in.</p></Card>}
          {manager && ['completed', 'closed'].includes(j.status.code) && <Card title="Billing"><Button variant="secondary" disabled={busy} onClick={async () => { setBusy(true); setErr(''); try { const inv = await post(`/jobs/${id}/invoice`); router.push(`/invoices/${inv.id}`); } catch (e: any) { setErr(e.message); setBusy(false); } }}>Open / create invoice</Button></Card>}
          <Card title="Timeline">
            <ol className="relative space-y-3 border-l border-slate-200 pl-4 text-sm">
              {j.history.map((h: any) => (
                <li key={h.id}><span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-indigo-500" />
                  <div className="font-medium capitalize">{h.toStatus.replace('_', ' ')}</div><div className="text-xs text-slate-400">{fmtDateTime(h.changedAt)}</div></li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Assign open={modal === 'assign'} job={j} onClose={() => setModal('')} onSave={(b) => act(`/jobs/${id}/assign`, b)} busy={busy} />
      <Modal open={modal === 'schedule'} onClose={() => setModal('')} title="Reschedule job">
        <Sched initial={toLocalInput(j.scheduledStart)} busy={busy} onSave={(v) => { setBusy(true); setErr(''); patch(`/jobs/${id}`, { scheduledStart: fromLocalInput(v) }).then(() => { setModal(''); reload(); }).catch((e) => setErr(e.message)).finally(() => setBusy(false)); }} label="New start" hint="The assigned engineers are notified immediately. Engineers on leave that day are blocked." />
      </Modal>
      <Modal open={modal === 'times'} onClose={() => setModal('')} title="Edit actual start / end">
        <TimesForm job={j} busy={busy} onSave={(b) => { setBusy(true); setErr(''); patch(`/jobs/${id}/times`, b).then(() => { setModal(''); reload(); }).catch((e) => setErr(e.message)).finally(() => setBusy(false)); }} />
      </Modal>
      <Modal open={modal === 'cancel'} onClose={() => setModal('')} title="Cancel job">
        <div className="space-y-3"><Field label="Reason"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setModal('')}>Keep job</Button><Button variant="danger" disabled={busy} onClick={() => act(`/jobs/${id}/cancel`, { note })}>Cancel job</Button></div></div>
      </Modal>
      <AllocatePart open={modal === 'part'} onClose={() => setModal('')} onSave={(b) => act(`/jobs/${id}/parts`, b)} busy={busy} />
    </>
  );
}

const Item = ({ k, v }: { k: string; v: React.ReactNode }) => <div><dt className="text-xs uppercase tracking-wide text-slate-400">{k}</dt><dd className="text-slate-800">{v}</dd></div>;

function Assign({ open, job, onClose, onSave, busy }: { open: boolean; job: any; onClose(): void; onSave(b: any): void; busy: boolean }) {
  const date = job.scheduledStart ? new Date(job.scheduledStart).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : undefined;
  const [p, setP] = useState(''); const [s, setS] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Assign engineers">
      <div className="space-y-3">
        <EngineerPicker date={date} value={p} onChange={setP} jobId={job.id} />
        <EngineerPicker date={date} value={s} onChange={setS} label="Supporting engineer (optional)" jobId={job.id} skip={p} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!p || busy || p === s} onClick={() => onSave({ primaryEngineerId: p, supportingEngineerIds: s ? [s] : [] })}>Assign &amp; notify</Button></div>
      </div>
    </Modal>
  );
}

function Sched({ initial, onSave, busy, label, hint }: { initial: string; onSave(v: string): void; busy: boolean; label: string; hint?: string }) {
  const [v, setV] = useState(initial);
  return <div className="space-y-3"><Field label={label} hint={hint}><Input type="datetime-local" min={`${todayIST()}T00:00`} value={v} onChange={(e) => setV(e.target.value)} /></Field><div className="flex justify-end"><Button disabled={!v || busy} onClick={() => onSave(v)}>Save</Button></div></div>;
}

function TimesForm({ job, onSave, busy }: { job: any; onSave(b: any): void; busy: boolean }) {
  const [a, setA] = useState(toLocalInput(job.actualStart)); const [b, setB] = useState(toLocalInput(job.actualEnd));
  return <div className="space-y-3"><Field label="Actual start"><Input type="datetime-local" value={a} onChange={(e) => setA(e.target.value)} /></Field><Field label="Actual end"><Input type="datetime-local" value={b} onChange={(e) => setB(e.target.value)} /></Field>
    <p className="text-xs text-slate-400">The engineer's app shows the corrected time right away.</p>
    <div className="flex justify-end"><Button disabled={busy} onClick={() => onSave({ actualStart: a ? fromLocalInput(a) : undefined, actualEnd: b ? fromLocalInput(b) : undefined })}>Save</Button></div></div>;
}

function AllocatePart({ open, onClose, onSave, busy }: { open: boolean; onClose(): void; onSave(b: any): void; busy: boolean }) {
  const [search, setSearch] = useState(''); const q = useDebounced(search);
  const parts = useFetch<any>(q.length >= 2 ? `/spare-parts${qs({ search: q, limit: 8, active: 'true' })}` : null);
  const whs = useFetch<any[]>('/warehouses');
  const [part, setPart] = useState<any>(null); const [wh, setWh] = useState(''); const [qty, setQty] = useState(1);
  const stock = useFetch<any>(part && wh ? `/inventory/stock${qs({ sparePartId: part.id, warehouseId: wh })}` : null);
  const have = stock.data?.data?.[0]?.availableQty ?? 0;
  return (
    <Modal open={open} onClose={onClose} title="Allocate spare part to this job">
      <div className="space-y-3">
        <Field label="Part">{part ? <div className="flex justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm"><span>{part.name} <span className="font-mono text-xs text-slate-400">{part.partNumber}</span></span><button className="text-xs text-indigo-600" onClick={() => setPart(null)}>Change</button></div> : <>
          <Input placeholder="Search part number or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {parts.data?.data?.length > 0 && <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 text-sm">{parts.data.data.map((p: any) => <li key={p.id}><button className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50" onClick={() => setPart(p)}>{p.name} <span className="font-mono text-xs text-slate-400">{p.partNumber}</span></button></li>)}</ul>}</>}
        </Field>
        <Field label="From warehouse" hint={part && wh ? `${have} available there` : undefined}><Select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">— select —</option>{whs.data?.filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="Quantity"><Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!part || !wh || qty < 1 || qty > have || busy} onClick={() => onSave({ sparePartId: part.id, warehouseId: wh, quantity: qty })}>Allocate</Button></div>
      </div>
    </Modal>
  );
}

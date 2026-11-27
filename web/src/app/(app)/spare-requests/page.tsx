'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td } from '@/components/ui';
import { fmtDateTime, post, qs } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

const STATUS: Record<string, [string, 'amber' | 'green' | 'red' | 'slate']> = { requested: ['Waiting', 'amber'], allocated: ['Given', 'green'], rejected: ['Not available', 'red'], cancelled: ['Cancelled', 'slate'] };

export default function SpareRequests() {
  const [status, setStatus] = useState('requested');
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const { data, loading, error, reload } = useFetch<any>(`/spare-requests${qs({ status, page, limit })}`);
  const [acting, setActing] = useState<any>(null);
  const [rejecting, setRejecting] = useState<any>(null);

  return (
    <>
      <PageHeader title="Spare part requests" subtitle="An engineer at a machine needs parts he does not have. His job waits until you give them from a hub; he is told where to collect and the job is rescheduled." />
      <Card actions={<Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="requested">Waiting for a decision</option><option value="allocated">Given</option><option value="rejected">Not available</option><option value="cancelled">Cancelled by engineer</option><option value="">All</option></Select>}>
        {error && <ErrorNote message={error} />}
        {loading && !data ? <Spinner /> : (
          <>
            <Table head={['Asked', 'Job', 'Client / station', 'Engineer', 'Parts', 'Status', '']} empty={data?.data.length === 0}>
              {data?.data.map((r: any) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</Td>
                  <Td><Link href={`/jobs/${r.job.id}`} className="font-medium text-indigo-700 hover:underline">{r.job.jobNumber}</Link></Td>
                  <Td>{r.job.client.companyName}<div className="text-xs text-slate-400">{r.job.site?.siteName}{r.job.site?.zone ? ` · ${r.job.site.zone.name}` : ''}</div></Td>
                  <Td>{r.engineer.user.fullName}<div className="text-xs text-slate-400">{r.engineer.user.phone}</div></Td>
                  <Td className="text-xs">{r.items.map((i: any) => <div key={i.id}>{i.quantity} × {i.sparePart.name} <span className="font-mono text-slate-400">{i.sparePart.partNumber}</span></div>)}{r.note && <div className="mt-1 italic text-slate-500">“{r.note}”</div>}</Td>
                  <Td><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>{r.decisionNote && <div className="mt-1 text-xs text-slate-500">{r.decisionNote}</div>}</Td>
                  <Td className="whitespace-nowrap text-right">{r.status === 'requested' && <span className="inline-flex gap-1.5"><Button onClick={() => setActing(r)}>Give from a hub</Button><Button variant="secondary" onClick={() => setRejecting(r)}>Not available</Button></span>}</Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </Card>
      {acting && <AllocateModal req={acting} onClose={() => setActing(null)} onDone={() => { setActing(null); reload(); }} />}
      {rejecting && <RejectModal req={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); reload(); }} />}
    </>
  );
}

function AllocateModal({ req, onClose, onDone }: { req: any; onClose(): void; onDone(): void }) {
  const { data, loading, error } = useFetch<any>(`/spare-requests/${req.id}/stock`);
  const [hub, setHub] = useState(''); const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const hubs: { id: string; name: string; city: string | null }[] = [];
  (data?.stock || []).forEach((s: any) => { if (!hubs.some((h) => h.id === s.warehouseId)) hubs.push({ id: s.warehouseId, name: s.warehouse, city: s.city }); });
  const avail = (partId: string) => (data?.stock || []).find((s: any) => s.warehouseId === hub && s.sparePartId === partId)?.availableQty ?? 0;
  async function submit() {
    setBusy(true); setErr('');
    try {
      await post(`/spare-requests/${req.id}/allocate`, { warehouseId: hub, hubNote: note || undefined, items: req.items.map((i: any) => ({ itemId: i.id, quantity: Math.min(qty[i.id] ?? i.quantity, avail(i.sparePartId)) })) });
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Give spares for ${req.job.jobNumber}`} wide>
      {loading && !data ? <Spinner /> : error ? <ErrorNote message={error} /> : (
        <div className="space-y-3">
          <Field label="Collect from which hub?" hint={hubs.length ? 'Only hubs that have at least one of these parts are listed' : 'No hub has these parts in stock. Receive stock first, or mark as not available.'}>
            <Select value={hub} onChange={(e) => setHub(e.target.value)}><option value="">Choose a hub…</option>{hubs.map((h) => <option key={h.id} value={h.id}>{h.name}{h.city ? ` — ${h.city}` : ''}</option>)}</Select>
          </Field>
          {hub && (
            <Table head={['Part', 'Asked', 'In stock there', 'Give']}>
              {req.items.map((i: any) => (
                <tr key={i.id}>
                  <Td>{i.sparePart.name}<div className="font-mono text-xs text-slate-400">{i.sparePart.partNumber}</div></Td><Td>{i.quantity}</Td>
                  <Td className={avail(i.sparePartId) < i.quantity ? 'font-semibold text-rose-600' : ''}>{avail(i.sparePartId)}</Td>
                  <Td><Input type="number" min={0} max={Math.min(i.quantity, avail(i.sparePartId))} className="w-20" value={qty[i.id] ?? Math.min(i.quantity, avail(i.sparePartId))} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })} /></Td>
                </tr>
              ))}
            </Table>
          )}
          <Field label="Message for the engineer (where exactly, whom to ask)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Gate 2, ask for Ramesh" /></Field>
          {err && <ErrorNote message={err} />}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!hub || busy} onClick={submit}>Give and tell the engineer</Button></div>
        </div>
      )}
    </Modal>
  );
}

function RejectModal({ req, onClose, onDone }: { req: any; onClose(): void; onDone(): void }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function submit() { setBusy(true); setErr(''); try { await post(`/spare-requests/${req.id}/reject`, { note: note || undefined }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  return (
    <Modal open onClose={onClose} title={`Spares not available for ${req.job.jobNumber}`}>
      <div className="space-y-3"><Field label="What should the engineer know?"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Part is on order, expected Friday" /></Field>
        {err && <ErrorNote message={err} />}<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={busy} onClick={submit}>Tell the engineer</Button></div></div>
    </Modal>
  );
}

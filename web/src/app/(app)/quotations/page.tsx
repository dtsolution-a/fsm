'use client';
import RowActions from '@/components/RowActions';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import LineEditor, { emptyLine, type Line } from '@/components/LineEditor';
import { MachinePicker } from '@/components/pickers';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { fmtDate, fmtMoney, post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

const tone = (s: string) => (({ draft: 'slate', sent: 'blue', approved: 'green', rejected: 'red', converted: 'green' }) as Record<string, any>)[s] || 'slate';

export default function Quotations() {
  const { user } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(20);
  const q = useDebounced(search);
  const { data, loading, error, reload } = useFetch<any>(`/quotations${qs({ status, search: q, page, limit })}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<any>(null);
  const can = user?.role === 'admin' || user?.role === 'ga_head';

  return (
    <>
      <PageHeader title="Quotations" subtitle="Quote a job before the work starts. When the client approves, one click creates the job and its invoice."
        actions={can && <Button onClick={() => setCreating(true)}>+ New quotation</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-xs" placeholder="Search number, client or title…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="converted">Converted</option>
          </Select>
        </div>
        {error && <ErrorNote message={error} />}
        {loading && !data ? <Spinner /> : <>
          <Table head={['Quotation', 'Client', 'Title', 'Valid until', 'Total', 'Status', 'Job / invoice', 'Actions']} empty={data?.data.length === 0}>
            {data?.data.map((x: any) => (
              <tr key={x.id} className="cursor-pointer" onClick={() => setOpen(x)}>
                <Td className="whitespace-nowrap font-medium text-indigo-700">{x.quotationNumber}</Td>
                <Td>{x.client.companyName}</Td><Td className="text-xs">{x.title || '—'}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDate(x.validUntil)}</Td>
                <Td className="whitespace-nowrap font-medium tabular-nums">{fmtMoney(x.total)}</Td>
                <Td><Badge tone={tone(x.status)}>{x.status}</Badge></Td>
                <Td className="text-xs">{x.job?.jobNumber || '—'}{x.invoices?.[0] && <div className="text-slate-400">{x.invoices[0].invoiceNumber}</div>}</Td>
                  <Td className="text-right"><RowActions entity="quotations" id={x.id} onChanged={reload} /></Td>
              </tr>
            ))}
          </Table>
          <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
        </>}
      </Card>
      <NewQuotation open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />
      <Detail q={open} can={can} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} onInvoice={(id) => router.push(`/invoices/${id}`)} />
    </>
  );
}

function NewQuotation({ open, onClose, onDone }: { open: boolean; onClose(): void; onDone(): void }) {
  const [m, setM] = useState({ clientId: '', siteProductId: '', clientName: '' });
  const [title, setTitle] = useState(''); const [valid, setValid] = useState(''); const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await post('/quotations', { clientId: m.clientId, siteProductId: m.siteProductId || undefined, title: title || undefined, notes: notes || undefined, validUntil: valid || undefined, lines: lines.map(({ note, ...l }) => l) });
      setLines([emptyLine()]); setTitle(''); setNotes(''); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New quotation" wide>
      <form onSubmit={submit} className="space-y-3">
        <MachinePicker onChange={setM} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Compressor overhaul" /></Field>
          <Field label="Valid until"><Input type="date" value={valid} onChange={(e) => setValid(e.target.value)} /></Field>
        </div>
        <LineEditor lines={lines} onChange={setLines} />
        <Field label="Notes / terms"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-xs text-slate-400">Tax is added from the rates saved in Billing settings.</p>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !m.clientId || lines.some((l) => !l.description.trim())}>Save as draft</Button></div>
      </form>
    </Modal>
  );
}

function Detail({ q, can, onClose, onChanged, onInvoice }: { q: any; can: boolean; onClose(): void; onChanged(): void; onInvoice(id: string): void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  if (!q) return null;
  async function act(path: string) {
    setBusy(true); setErr('');
    try { const r = await post(`/quotations/${q.id}/${path}`); if (path === 'convert') onInvoice(r.invoiceId); else onChanged(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const lines: Line[] = q.lineItems;
  return (
    <Modal open onClose={onClose} title={`${q.quotationNumber} · ${q.client.companyName}`} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={tone(q.status)}>{q.status}</Badge>{q.title && <span className="font-medium">{q.title}</span>}{q.validUntil && <span className="text-slate-500">valid until {fmtDate(q.validUntil)}</span>}</div>
        <LineEditor lines={lines} readOnly />
        <dl className="ml-auto w-64 space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{fmtMoney(q.subtotal)}</dd></div>
          {(q.taxBreakup || []).map((t: any) => <div key={t.taxLabel} className="flex justify-between"><dt className="text-slate-500">{t.taxLabel} @ {t.ratePercent}%</dt><dd className="tabular-nums">{fmtMoney(t.amount)}</dd></div>)}
          <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{fmtMoney(q.total)}</dd></div>
        </dl>
        {q.notes && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">{q.notes}</p>}
        {err && <ErrorNote message={err} />}
        {can && (
          <div className="flex flex-wrap justify-end gap-2">
            {q.status === 'draft' && <Button variant="secondary" disabled={busy} onClick={() => act('send')}>Send to client</Button>}
            {['draft', 'sent'].includes(q.status) && <><Button variant="danger" disabled={busy} onClick={() => act('reject')}>Rejected</Button><Button disabled={busy} onClick={() => act('approve')}>Client approved</Button></>}
            {q.status === 'approved' && <Button disabled={busy} onClick={() => act('convert')}>Convert to job + invoice</Button>}
            {q.status === 'converted' && q.invoices?.[0] && <Button variant="secondary" onClick={() => onInvoice(q.invoices[0].id)}>Open invoice {q.invoices[0].invoiceNumber}</Button>}
          </div>
        )}
      </div>
    </Modal>
  );
}

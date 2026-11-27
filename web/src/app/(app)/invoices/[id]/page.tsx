'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Mail, MessageCircle, Printer } from 'lucide-react';
import LineEditor, { type Line } from '@/components/LineEditor';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { fmtDate, fmtDateTime, fmtMoney, patch, post, todayIST } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/hooks';
import { invLabel, invTone } from '@/lib/billing';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: inv, loading, error, reload } = useFetch<any>(`/invoices/${id}`);
  const [lines, setLines] = useState<Line[]>([]);
  const [due, setDue] = useState(''); const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [info, setInfo] = useState('');
  const [paying, setPaying] = useState(false); const [cancelling, setCancelling] = useState(false);
  const can = user?.role === 'admin' || user?.role === 'ga_head';
  useEffect(() => { if (inv) { setLines(inv.lineItems); setDue(inv.dueDate ? inv.dueDate.slice(0, 10) : ''); setNotes(inv.notes || ''); } }, [inv]);

  if (loading && !inv) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!inv) return null;
  const draft = inv.status === 'draft';
  const balance = Number(inv.totalAmount) - Number(inv.paidAmount);

  async function run(fn: () => Promise<any>, after?: (r: any) => void) {
    setBusy(true); setErr(''); setInfo('');
    try { const r = await fn(); after?.(r); reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const save = () => run(() => patch(`/invoices/${id}`, { lines: lines.map(({ note, ...l }) => ({ ...l })), dueDate: due || null, notes }), () => setInfo('Saved'));
  const issue = () => run(async () => { await patch(`/invoices/${id}`, { lines: lines.map(({ note, ...l }) => ({ ...l })), dueDate: due || null, notes }); return post(`/invoices/${id}/issue`); }, () => setInfo('Invoice issued'));
  const share = (channel: 'email' | 'whatsapp') => run(() => post(`/invoices/${id}/share`, { channel }), (r) => {
    if (channel === 'whatsapp' && r.link) window.open(r.link, '_blank');
    setInfo(channel === 'email' ? (r.messageStatus === 'sent' ? `E-mail sent to ${r.to}` : `Saved in Messages for ${r.to}. E-mail sending is not connected yet.`) : 'WhatsApp opened with the message ready.');
  });

  return (
    <>
      <PageHeader title={inv.invoiceNumber} subtitle={`${inv.client.companyName}${inv.job ? ' · job ' + inv.job.jobNumber : ''}`}
        actions={<><Link href="/invoices" className="text-sm text-indigo-600 hover:underline">← All invoices</Link>{!draft && inv.status !== 'cancelled' && <Link href={`/invoices/${id}/print`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 text-[13.5px] font-medium text-slate-700 hover:bg-slate-50"><Printer size={15} /> Print / PDF</Link>}</>} />
      {err && <div className="mb-3"><ErrorNote message={err} /></div>}
      {info && <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Items" actions={<><Badge tone={invTone(inv.status)}>{invLabel(inv.status)}</Badge>{inv.isAmc && <Badge tone="blue">AMC / warranty cover</Badge>}</>}>
            {draft && inv.isAmc && <p className="mb-3 rounded-md bg-indigo-50 p-3 text-sm text-indigo-800">This visit is covered by a contract, so the lines are at 0. Edit them if something extra is chargeable, or issue as is.</p>}
            {draft && !inv.isAmc && lines.some((l) => Number(l.unitPrice) === 0) && <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">Some rates are 0. Enter the charges (and part prices) before issuing.</p>}
            <LineEditor lines={lines} onChange={setLines} readOnly={!draft || !can} />
            <dl className="ml-auto mt-4 w-72 space-y-1 text-sm">
              {inv.taxLines.map((t: any) => <div key={t.id} className="flex justify-between"><dt className="text-slate-500">{t.taxLabel} @ {t.ratePercent}%</dt><dd className="tabular-nums">{fmtMoney(t.amount)}</dd></div>)}
              {draft ? <p className="text-xs text-slate-400">Tax is calculated when you issue the invoice, from the rates in Billing settings.</p> : <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{fmtMoney(inv.totalAmount)}</dd></div>}
            </dl>
          </Card>
          <Card title="Payments" actions={can && !draft && inv.status !== 'cancelled' && balance > 0.004 && <Button onClick={() => setPaying(true)}>Record payment</Button>}>
            {inv.payments.length === 0 ? <p className="text-sm text-slate-400">No payments recorded.</p> : (
              <table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-[11.5px] uppercase text-slate-500"><th className="py-2 font-semibold">Date</th><th className="font-semibold">Method</th><th className="font-semibold">Reference</th><th className="text-right font-semibold">Amount</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{inv.payments.map((p: any) => <tr key={p.id}><td className="py-2">{fmtDateTime(p.paidAt)}</td><td className="capitalize">{(p.paymentMethod || '—').replace('_', ' ')}</td><td>{p.reference || '—'}</td><td className="text-right tabular-nums">{fmtMoney(p.amount)}</td></tr>)}</tbody></table>
            )}
            {!draft && <div className="mt-3 flex justify-end gap-6 border-t border-slate-100 pt-3 text-sm"><span>Paid <b className="tabular-nums">{fmtMoney(inv.paidAmount)}</b></span><span>Balance <b className={`tabular-nums ${balance > 0.004 ? 'text-rose-700' : 'text-emerald-700'}`}>{fmtMoney(Math.max(balance, 0))}</b></span></div>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Details">
            <dl className="space-y-3 text-sm">
              <div><dt className="text-xs uppercase text-slate-400">Issued</dt><dd>{fmtDate(inv.issuedAt)}</dd></div>
              <div><dt className="mb-1 text-xs uppercase text-slate-400">Due date</dt><dd>{draft && can ? <Input type="date" min={todayIST()} value={due} onChange={(e) => setDue(e.target.value)} /> : fmtDate(inv.dueDate)}</dd></div>
              {inv.job && <div><dt className="text-xs uppercase text-slate-400">Job</dt><dd><Link className="text-indigo-600 hover:underline" href={`/jobs/${inv.job.id}`}>{inv.job.jobNumber}</Link> · {inv.job.jobType.label}</dd></div>}
              {inv.job?.siteProduct && <div><dt className="text-xs uppercase text-slate-400">Machine</dt><dd>{inv.job.siteProduct.model?.name || inv.job.siteProduct.rawModel} <span className="font-mono text-xs text-slate-400">{inv.job.siteProduct.serialNumber}</span></dd></div>}
              <div><dt className="mb-1 text-xs uppercase text-slate-400">Notes</dt><dd>{draft && can ? <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /> : inv.notes || '—'}</dd></div>
              {inv.sharedVia.length > 0 && <div><dt className="text-xs uppercase text-slate-400">Shared via</dt><dd className="capitalize">{inv.sharedVia.join(', ')}</dd></div>}
            </dl>
          </Card>
          {can && (
            <Card title="Actions">
              <div className="flex flex-col gap-2">
                {draft && <><Button variant="secondary" disabled={busy} onClick={save}>Save draft</Button><Button disabled={busy} onClick={issue}>Issue invoice</Button></>}
                {!draft && inv.status !== 'cancelled' && <>
                  <Button variant="secondary" disabled={busy} onClick={() => share('email')}><Mail size={15} /> Send by e-mail</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => share('whatsapp')}><MessageCircle size={15} /> Share on WhatsApp</Button>
                </>}
                {inv.status !== 'cancelled' && inv.payments.length === 0 && <Button variant="danger" disabled={busy} onClick={() => setCancelling(true)}>Cancel invoice</Button>}
              </div>
            </Card>
          )}
        </div>
      </div>
      <PayModal open={paying} balance={balance} onClose={() => setPaying(false)} onDone={() => { setPaying(false); reload(); }} id={id} />
      <CancelModal open={cancelling} onClose={() => setCancelling(false)} onDone={() => { setCancelling(false); reload(); }} id={id} />
    </>
  );
}

function PayModal({ open, balance, id, onClose, onDone }: { open: boolean; balance: number; id: string; onClose(): void; onDone(): void }) {
  const [amount, setAmount] = useState(''); const [method, setMethod] = useState('bank_transfer'); const [ref, setRef] = useState(''); const [date, setDate] = useState(todayIST());
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post(`/invoices/${id}/payments`, { amount: Number(amount), paymentMethod: method, reference: ref || undefined, paidAt: new Date(`${date}T12:00:00+05:30`).toISOString() }); setAmount(''); setRef(''); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Record payment">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-500">Balance on this invoice: <b>{fmtMoney(balance)}</b></p>
        <Field label="Amount received (₹)"><Input type="number" step="any" min={0.01} max={balance} required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></Select></Field>
          <Field label="Date received"><Input type="date" max={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Reference (UTR / cheque no.)"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !amount}>Save payment</Button></div>
      </form>
    </Modal>
  );
}

function CancelModal({ open, id, onClose, onDone }: { open: boolean; id: string; onClose(): void; onDone(): void }) {
  const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Cancel invoice">
      <div className="space-y-3"><Field label="Reason"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Keep invoice</Button><Button variant="danger" onClick={async () => { try { await post(`/invoices/${id}/cancel`, { reason }); onDone(); } catch (e: any) { setErr(e.message); } }}>Cancel invoice</Button></div></div>
    </Modal>
  );
}

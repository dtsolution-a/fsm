'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { Button, Card, ErrorNote, Field, Input, PageHeader, Spinner, Textarea } from '@/components/ui';
import { put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/hooks';

// These are the details only the business can supply. Everything starts blank and the page lists what is still missing.
export default function BillingSettings() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch<any>('/billing/settings');
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const admin = user?.role === 'admin';
  useEffect(() => { if (data) setF({ ...data.settings, defaultDueDays: data.settings.defaultDueDays ?? '' }); }, [data]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!f) return null;
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const gaps: { field: string; why: string }[] = data.gaps;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setOk('');
    try {
      await put('/billing/settings', { ...f, defaultDueDays: f.defaultDueDays === '' ? undefined : Number(f.defaultDueDays), taxes: f.taxes.map((t: any) => ({ label: t.label, rate: Number(t.rate) })) });
      setOk('Saved'); reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Billing settings" subtitle="Company details, tax and payment terms printed on quotations and invoices" />
      <div className={`mb-4 rounded-lg border p-4 ${gaps.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
        {gaps.length === 0 ? <div className="flex items-center gap-2 text-sm font-medium text-emerald-800"><CheckCircle2 size={18} /> Everything needed for invoicing is filled in.</div> : (
          <>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle size={18} /> Waiting for details from the business ({gaps.length})</div>
            <ul className="list-disc space-y-0.5 pl-6 text-sm text-amber-900">{gaps.map((g) => <li key={g.field}>{g.why}</li>)}</ul>
          </>
        )}
      </div>
      <form onSubmit={save} className="space-y-4">
        <Card title="Company on the invoice">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company name"><Input value={f.companyName} onChange={(e) => set('companyName', e.target.value)} disabled={!admin} /></Field>
            <Field label="GSTIN"><Input value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} disabled={!admin} /></Field>
            <Field label="PAN"><Input value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} disabled={!admin} /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} disabled={!admin} /></Field>
            <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} disabled={!admin} /></Field>
            <div className="sm:col-span-2"><Field label="Address"><Textarea rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} disabled={!admin} /></Field></div>
          </div>
        </Card>
        <Card title="Tax">
          <p className="mb-3 text-sm text-slate-500">Add each tax that applies, e.g. CGST 9 and SGST 9 (or IGST 18). It is added to every quotation and invoice. Leave empty if no tax applies.</p>
          <div className="space-y-2">
            {f.taxes.map((t: any, i: number) => (
              <div key={i} className="flex items-end gap-2">
                <Field label="Name"><Input value={t.label} onChange={(e) => set('taxes', f.taxes.map((x: any, j: number) => (j === i ? { ...x, label: e.target.value } : x)))} disabled={!admin} /></Field>
                <Field label="Rate %"><Input type="number" step="any" min={0} max={100} className="w-28" value={t.rate} onChange={(e) => set('taxes', f.taxes.map((x: any, j: number) => (j === i ? { ...x, rate: e.target.value } : x)))} disabled={!admin} /></Field>
                {admin && <button type="button" className="mb-1 rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => set('taxes', f.taxes.filter((_: any, j: number) => j !== i))} aria-label="Remove"><Trash2 size={16} /></button>}
              </div>
            ))}
          </div>
          {admin && <Button type="button" variant="secondary" className="mt-3" onClick={() => set('taxes', [...f.taxes, { label: '', rate: 0 }])}><Plus size={15} /> Add tax</Button>}
        </Card>
        <Card title="Bank details & terms">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Account name"><Input value={f.accountName} onChange={(e) => set('accountName', e.target.value)} disabled={!admin} /></Field>
            <Field label="Bank name"><Input value={f.bankName} onChange={(e) => set('bankName', e.target.value)} disabled={!admin} /></Field>
            <Field label="Account number"><Input value={f.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} disabled={!admin} /></Field>
            <Field label="IFSC"><Input value={f.ifsc} onChange={(e) => set('ifsc', e.target.value.toUpperCase())} disabled={!admin} /></Field>
            <div className="sm:col-span-2"><Field label="Payment terms / conditions"><Textarea rows={3} value={f.terms} onChange={(e) => set('terms', e.target.value)} disabled={!admin} /></Field></div>
            <div className="sm:col-span-2"><Field label="Invoice footer line"><Input value={f.footer} onChange={(e) => set('footer', e.target.value)} disabled={!admin} /></Field></div>
          </div>
        </Card>
        <Card title="Rules">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment due after (days)" hint="Blank = no due date, so invoices never become overdue by themselves"><Input type="number" min={0} max={365} value={f.defaultDueDays} onChange={(e) => set('defaultDueDays', e.target.value)} disabled={!admin} /></Field>
            <Field label="Flag a contract when service cost reaches (% of its value)"><Input type="number" min={1} max={1000} value={f.highCostPercent} onChange={(e) => set('highCostPercent', Number(e.target.value))} disabled={!admin} /></Field>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.autoInvoice} onChange={(e) => set('autoInvoice', e.target.checked)} disabled={!admin} /><span><b>Prepare a draft invoice automatically</b> when a job is closed</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.quotationPriceLocked} onChange={(e) => set('quotationPriceLocked', e.target.checked)} disabled={!admin} /><span><b>Quoted price is binding</b> — an invoice made from an approved quotation cannot change its rates</span></label>
          </div>
        </Card>
        {err && <ErrorNote message={err} />}
        {ok && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{ok}</div>}
        {admin ? <div className="flex justify-end"><Button type="submit" disabled={busy}>Save settings</Button></div> : <p className="text-sm text-slate-400">Only an administrator can change these.</p>}
      </form>
    </>
  );
}

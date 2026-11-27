'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import { ErrorNote, Spinner } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

// Print-ready invoice. "Print" opens the browser dialog: choose "Save as PDF" to get a PDF.
// Company name, address, GSTIN and bank details come from Billing settings and are simply left out while blank.
export default function PrintInvoice() {
  const { id } = useParams<{ id: string }>();
  const { data: inv, error } = useFetch<any>(`/invoices/${id}`);
  const cfg = useFetch<any>('/billing/settings');
  if (error) return <ErrorNote message={error} />;
  if (!inv || !cfg.data) return <Spinner />;
  const s = cfg.data.settings;
  const lines = inv.lineItems as any[];
  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/invoices/${id}`} className="text-sm text-indigo-600 hover:underline">← Back to invoice</Link>
        <button onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-indigo-600 px-4 text-[13.5px] font-medium text-white hover:bg-indigo-700"><Printer size={15} /> Print / Save as PDF</button>
      </div>
      <article className="rounded-lg border border-slate-200 bg-white p-10 text-[13px] text-slate-800 print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between border-b-2 border-indigo-900 pb-5">
          <div>
            <img src="/brand/shah-logo.png" alt="Shah Engineers & Consultants" className="h-14 w-auto" />
            <div className="mt-3 space-y-0.5 text-xs text-slate-600">
              {s.companyName && <div className="font-semibold text-slate-800">{s.companyName}</div>}
              {s.address && <div className="whitespace-pre-line">{s.address}</div>}
              {(s.phone || s.email) && <div>{[s.phone, s.email].filter(Boolean).join(' · ')}</div>}
              {s.gstin && <div>GSTIN: {s.gstin}</div>}{s.pan && <div>PAN: {s.pan}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tracking-wide text-indigo-900">{inv.isAmc && subtotal === 0 ? 'SERVICE VISIT RECORD' : 'TAX INVOICE'}</div>
            <dl className="mt-3 space-y-1 text-xs">
              <div><dt className="inline text-slate-500">Invoice no.: </dt><dd className="inline font-semibold">{inv.invoiceNumber}</dd></div>
              <div><dt className="inline text-slate-500">Date: </dt><dd className="inline">{fmtDate(inv.issuedAt)}</dd></div>
              {inv.dueDate && <div><dt className="inline text-slate-500">Due date: </dt><dd className="inline">{fmtDate(inv.dueDate)}</dd></div>}
              {inv.job && <div><dt className="inline text-slate-500">Job: </dt><dd className="inline">{inv.job.jobNumber}</dd></div>}
            </dl>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 py-5">
          <div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bill to</div><div className="mt-1 font-semibold">{inv.client.legalName || inv.client.companyName}</div><div className="text-xs text-slate-600">{inv.client.clientCode}{inv.client.phone ? ' · ' + inv.client.phone : ''}{inv.client.email ? ' · ' + inv.client.email : ''}</div></div>
          {inv.job && <div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Service</div><div className="mt-1">{inv.job.jobType.label}</div><div className="text-xs text-slate-600">{inv.job.site?.siteName}{inv.job.siteProduct ? ' · ' + (inv.job.siteProduct.model?.name || inv.job.siteProduct.rawModel) + (inv.job.siteProduct.serialNumber ? ' (' + inv.job.siteProduct.serialNumber + ')' : '') : ''}</div></div>}
        </section>

        <table className="w-full">
          <thead><tr className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600"><th className="px-3 py-2">#</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i} className="border-b border-slate-100"><td className="px-3 py-2 text-slate-500">{i + 1}</td><td className="px-3 py-2">{l.description}{l.note && <div className="text-[11px] text-slate-500">{l.note}</div>}</td><td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td><td className="px-3 py-2 text-right tabular-nums">{Number(l.unitPrice).toFixed(2)}</td><td className="px-3 py-2 text-right tabular-nums">{(l.quantity * l.unitPrice).toFixed(2)}</td></tr>)}</tbody>
        </table>

        <div className="mt-4 ml-auto w-72 space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums">{fmtMoney(subtotal)}</span></div>
          {inv.taxLines.map((t: any) => <div key={t.id} className="flex justify-between"><span className="text-slate-500">{t.taxLabel} @ {t.ratePercent}%</span><span className="tabular-nums">{fmtMoney(t.amount)}</span></div>)}
          <div className="flex justify-between border-t-2 border-indigo-900 pt-2 text-base font-bold"><span>Total</span><span className="tabular-nums">{fmtMoney(inv.totalAmount)}</span></div>
          {Number(inv.paidAmount) > 0 && <><div className="flex justify-between text-emerald-700"><span>Paid</span><span className="tabular-nums">{fmtMoney(inv.paidAmount)}</span></div><div className="flex justify-between font-semibold"><span>Balance due</span><span className="tabular-nums">{fmtMoney(Number(inv.totalAmount) - Number(inv.paidAmount))}</span></div></>}
        </div>

        {(s.bankName || s.terms || inv.notes) && (
          <footer className="mt-8 grid grid-cols-2 gap-6 border-t border-slate-200 pt-4 text-xs text-slate-600">
            <div>{s.bankName && <><div className="font-semibold uppercase text-slate-500">Bank details</div><div className="mt-1">{s.accountName && <div>{s.accountName}</div>}<div>{s.bankName}</div>{s.accountNumber && <div>A/c {s.accountNumber}</div>}{s.ifsc && <div>IFSC {s.ifsc}</div>}</div></>}{inv.notes && <div className="mt-3"><div className="font-semibold uppercase text-slate-500">Notes</div><div className="whitespace-pre-line">{inv.notes}</div></div>}</div>
            <div>{s.terms && <><div className="font-semibold uppercase text-slate-500">Terms</div><div className="mt-1 whitespace-pre-line">{s.terms}</div></>}</div>
          </footer>
        )}
        {s.footer && <p className="mt-6 text-center text-[11px] text-slate-400">{s.footer}</p>}
      </article>
    </div>
  );
}

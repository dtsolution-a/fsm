'use client';
import { useState } from 'react';
import { Card, ErrorNote, Field, Input, PageHeader, Select, Spinner, Stat, Table, Td } from '@/components/ui';
import { fmtMoney, qs, todayIST } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

export default function Finance() {
  const [from, setFrom] = useState(`${todayIST().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(todayIST());
  const [period, setPeriod] = useState('month');
  const { data: d, error, loading } = useFetch<any>(`/billing/summary${qs({ from, to, period })}`);
  const max = Math.max(1, ...(d?.series || []).flatMap((s: any) => [s.invoiced, s.collected]));
  const split = d?.amcVsAdhoc;

  return (
    <>
      <PageHeader title="Financial Summary" subtitle="Revenue invoiced and collected, receivables, and where the money comes from"
        actions={<div className="flex flex-wrap items-end gap-2"><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field><Field label="By"><Select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></Select></Field></div>} />
      {error && <ErrorNote message={error} />}
      {loading && !d ? <Spinner /> : d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Invoiced" value={fmtMoney(d.totals.invoiced)} sub={`${d.totals.invoiceCount} issued invoices`} />
            <Stat label="Collected" value={fmtMoney(d.totals.collected)} tone="green" sub="payments in this range" />
            <Stat label="Outstanding" value={fmtMoney(d.totals.outstanding)} tone={d.totals.outstanding ? 'amber' : 'green'} sub="all open invoices" />
            <Stat label="Overdue" value={fmtMoney(d.totals.overdue)} tone={d.totals.overdue ? 'red' : 'green'} sub="past due date" />
          </div>

          <Card title={`Invoiced vs collected (${period})`} className="mt-4">
            {d.series.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">No invoices issued in this range yet.</p> : (
              <div>
                <div className="flex h-52 items-end gap-5 border-b border-slate-200 px-2">
                  {d.series.map((s: any) => (
                    <div key={s.period} className="flex flex-1 flex-col items-center gap-1">
                      <div className="flex h-44 w-full items-end justify-center gap-1.5">
                        <div title={`Invoiced ${fmtMoney(s.invoiced)}`} className="w-1/3 max-w-10 rounded-t bg-indigo-600" style={{ height: `${(s.invoiced / max) * 100}%`, minHeight: s.invoiced ? 3 : 0 }} />
                        <div title={`Collected ${fmtMoney(s.collected)}`} className="w-1/3 max-w-10 rounded-t bg-emerald-500" style={{ height: `${(s.collected / max) * 100}%`, minHeight: s.collected ? 3 : 0 }} />
                      </div>
                      <div className="text-xs text-slate-500">{s.period}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-5 text-xs text-slate-500"><span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-indigo-600" /> Invoiced</span><span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Collected</span></div>
              </div>
            )}
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="AMC / CMC vs ad-hoc">
              <dl className="space-y-3 text-sm">
                <Row k="Ad-hoc invoices (chargeable work)" v={fmtMoney(split.adhoc)} />
                <Row k="Invoices covered by AMC / warranty" v={fmtMoney(split.amcCoveredInvoices)} />
                <Row k={`AMC / warranty contracts started in range (${split.amcContractsStarted})`} v={fmtMoney(split.amcContractValueStarted)} />
              </dl>
              <p className="mt-3 text-xs text-slate-400">Contract value is the amount recorded on each contract; it is not counted in “Invoiced”.</p>
            </Card>
            <Breakdown title="By job type" rows={d.byJobType} />
            <Breakdown title="By client" rows={d.byClient} />
            <Breakdown title="By product type" rows={d.byProduct} />
            <Breakdown title="By engineer (primary)" rows={d.byEngineer} />
          </div>
        </>
      )}
    </>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => <div className="flex items-center justify-between gap-4"><dt className="text-slate-600">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>;

function Breakdown({ title, rows }: { title: string; rows: { label: string; amount: number; invoices: number }[] }) {
  return (
    <Card title={title}>
      <Table head={['', 'Invoices', 'Amount']} empty={rows.length === 0}>
        {rows.map((r) => <tr key={r.label}><Td className="max-w-[16rem] truncate">{r.label}</Td><Td>{r.invoices}</Td><Td className="font-medium tabular-nums">{fmtMoney(r.amount)}</Td></tr>)}
      </Table>
    </Card>
  );
}

'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, ErrorNote, Input, PageHeader, Pagination, Spinner, Stat, Table, Tabs, Td } from '@/components/ui';
import { fmtDate, fmtDateTime, fmtMoney, qs } from '@/lib/api';
import { useFetch, usePaged } from '@/lib/hooks';

export default function Receivables() {
  const [tab, setTab] = useState<'outstanding' | 'payments'>('outstanding');
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState('');
  const out = useFetch<any>('/billing/outstanding');
  const needle = search.trim().toLowerCase();
  const opg = usePaged((out.data?.clients || []).filter((c: any) => !needle || `${c.client} ${c.code}`.toLowerCase().includes(needle)), 25);
  const pays = useFetch<any>(`/payments${qs({ page, limit })}`);
  return (
    <>
      <PageHeader title="Receivables & Payments" subtitle="Who owes what, how overdue it is, and every payment received" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total outstanding" value={fmtMoney(out.data?.totalBalance ?? 0)} sub={`${out.data?.clients?.length ?? 0} clients`} />
        <Stat label="Overdue" value={fmtMoney(out.data?.totalOverdue ?? 0)} tone={out.data?.totalOverdue ? 'red' : 'green'} sub="past the due date" />
      </div>
      <Tabs<'outstanding' | 'payments'> value={tab} onChange={setTab} tabs={[{ id: 'outstanding', label: 'Outstanding by client' }, { id: 'payments', label: 'Payments received' }]} />
      {tab === 'outstanding' && (
        <Card actions={<Input className="w-60" placeholder="Search client or code…" value={search} onChange={(e) => { setSearch(e.target.value); opg.reset(); }} />}>
          {out.error && <ErrorNote message={out.error} />}
          {out.loading && !out.data ? <Spinner /> : (<>
            <Table head={['Client', 'Open invoices', 'Invoiced', 'Received', 'Balance', 'Overdue', 'Oldest due']} empty={opg.meta.total === 0}>
              {opg.rows.map((c: any) => (
                <tr key={c.clientId}>
                  <Td><Link className="font-medium text-indigo-700 hover:underline" href={`/invoices?client=${c.clientId}`}>{c.client}</Link><div className="text-xs text-slate-400">{c.code}</div></Td>
                  <Td>{c.invoices}</Td><Td className="tabular-nums">{fmtMoney(c.invoiced)}</Td><Td className="tabular-nums">{fmtMoney(c.paid)}</Td>
                  <Td className="font-semibold tabular-nums">{fmtMoney(c.balance)}</Td>
                  <Td>{c.overdue > 0 ? <Badge tone="red">{fmtMoney(c.overdue)}</Badge> : '—'}</Td>
                  <Td className="whitespace-nowrap text-xs">{c.oldestDue ? fmtDate(c.oldestDue) : '—'}</Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={opg.meta} onPage={opg.setPage} onLimit={opg.setLimit} />
          </>          )}
        </Card>
      )}
      {tab === 'payments' && (
        <Card>
          {pays.error && <ErrorNote message={pays.error} />}
          {pays.loading && !pays.data ? <Spinner /> : <>
            <Table head={['Received', 'Invoice', 'Client', 'Method', 'Reference', 'Amount']} empty={pays.data?.data.length === 0}>
              {pays.data?.data.map((p: any) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(p.paidAt)}</Td>
                  <Td className="font-medium">{p.invoice.invoiceNumber}</Td><Td>{p.invoice.client.companyName}</Td>
                  <Td className="text-xs capitalize">{(p.paymentMethod || '—').replace('_', ' ')}</Td><Td className="text-xs">{p.reference || '—'}</Td>
                  <Td className="font-semibold tabular-nums">{fmtMoney(p.amount)}</Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={pays.data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>}
        </Card>
      )}
    </>
  );
}

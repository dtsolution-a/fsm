'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Input, PageHeader, Pagination, Spinner, Table, Tabs, Td } from '@/components/ui';
import { download, fmtDate, fmtMoney, todayIST } from '@/lib/api';
import { useFetch, usePaged } from '@/lib/hooks';

type Tab = 'summary' | 'pending' | 'expiring' | 'highcost' | 'yearly';
const PATH: Record<Exclude<Tab, 'highcost' | 'yearly'>, string> = { summary: '/amc/reports/summary', pending: '/amc/reports/pending-visits', expiring: '/amc/reports/expiring' };
const tone = (s: string) => (({ active: 'green', expiring: 'amber', expired: 'red', no_term: 'slate' }) as Record<string, any>)[s] || 'slate';

export default function AmcReports() {
  const [tab, setTab] = useState<Tab>('summary');
  const [err, setErr] = useState('');
  const csvOk = tab !== 'yearly' && tab !== 'highcost';

  return (
    <>
      <PageHeader title="AMC / CMC Reports" subtitle="Contract-wise summary, pending visits, expiring contracts, service cost against contract value, and year-on-year history"
        actions={csvOk && <Button variant="secondary" onClick={() => download(`${PATH[tab as keyof typeof PATH]}?format=csv`, `amc-${tab}-${todayIST()}.csv`).catch((e) => setErr(e.message))}><Download size={15} /> Export CSV</Button>} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'summary', label: 'Contract summary' }, { id: 'pending', label: 'Pending visits' }, { id: 'expiring', label: 'Expiring (30 days)' }, { id: 'highcost', label: 'High-cost contracts' }, { id: 'yearly', label: 'Year on year' }]} />
      {err && <ErrorNote message={err} />}
      <Body key={tab} tab={tab} />
    </>
  );
}

// One component per tab (remounted on tab change) so a tab never renders another tab's data
function Body({ tab }: { tab: Tab }) {
  const url = tab === 'yearly' ? '/amc/reports/revenue-by-year' : tab === 'highcost' ? '/amc/high-cost' : PATH[tab];
  const { data, loading, error } = useFetch<any[]>(url);
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const pg = usePaged((data || []).filter((r: any) => tab === 'yearly' || !needle || `${r.contractNumber} ${r.client} ${r.site} ${r.serialNumber}`.toLowerCase().includes(needle)), 25);
  return (
    <>
      {error && <ErrorNote message={error} />}
      <Card>
        {tab !== 'yearly' && <div className="mb-3"><Input className="max-w-xs" placeholder="Search contract, client or serial…" value={search} onChange={(e) => { setSearch(e.target.value); pg.reset(); }} /></div>}
        {loading && !data ? <Spinner /> : tab === 'yearly' ? (
          <Table head={['Year', 'Contracts started', 'Total contract value', 'Split by type']} empty={data?.length === 0}>
            {data?.map((y: any) => <tr key={y.year}><Td className="font-semibold">{y.year}</Td><Td>{y.contracts}</Td><Td className="font-medium tabular-nums">{fmtMoney(y.value)}</Td><Td className="text-xs">{Object.entries(y.byType).map(([k, v]) => `${k}: ${fmtMoney(v as number)}`).join('  ·  ')}</Td></tr>)}
          </Table>
        ) : (
          <Table head={['Contract', 'Client / site', 'Machine', 'Type', 'Period', 'Value', 'Visits (done / total)', 'Pending', 'Service cost', 'Status']} empty={pg.meta.total === 0}>
            {pg.rows.map((r: any) => (
              <tr key={r.contractId}>
                <Td className="whitespace-nowrap font-medium">{r.contractNumber}</Td>
                <Td>{r.client}<div className="text-xs text-slate-400">{r.site}</div></Td>
                <Td className="text-xs">{r.machine}<div className="font-mono text-slate-400">{r.serialNumber}</div></Td>
                <Td className="text-xs">{r.type}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</Td>
                <Td className="tabular-nums">{r.value ? fmtMoney(r.value) : '—'}</Td>
                <Td>{r.visitsDone} / {r.visitsContracted}</Td>
                <Td>{r.visitsPending > 0 ? <Badge tone="amber">{r.visitsPending}</Badge> : 0}</Td>
                <Td className="tabular-nums">{fmtMoney(r.cost)}{r.costPercent != null && <div className={`text-xs ${r.costPercent >= 80 ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>{r.costPercent}% of value</div>}</Td>
                <Td><Badge tone={tone(r.status)}>{r.status.replace('_', ' ')}</Badge></Td>
              </tr>
            ))}
          </Table>
        )}
        {tab !== 'yearly' && <Pagination meta={pg.meta} onPage={pg.setPage} onLimit={pg.setLimit} />}
        {data && data.length >= 2000 && <p className="mt-3 text-xs text-slate-400">Showing the first 2,000 contracts. Use the CSV export filters for more.</p>}
      </Card>
    </>
  );
}

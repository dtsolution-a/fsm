'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Pagination, Select, Spinner, Stat, Table, Tabs, Td } from '@/components/ui';
import { download, qs, todayIST } from '@/lib/api';
import { useFetch, usePaged } from '@/lib/hooks';

type Tab = 'jobs' | 'engineers' | 'clients' | 'products';
const v = (x: any, suffix = '') => (x === null || x === undefined || x === '' ? '—' : `${x}${suffix}`);

export default function Reports() {
  const [tab, setTab] = useState<Tab>('jobs');
  const [from, setFrom] = useState(`${todayIST().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayIST());
  const [by, setBy] = useState('day');
  const [repeat, setRepeat] = useState(7);
  const [err, setErr] = useState('');
  const params = { from, to, by, repeatDays: repeat };

  return (
    <>
      <PageHeader title="Reports" subtitle="Job performance, engineer scorecards, client service frequency and installed products"
        actions={<Button variant="secondary" onClick={() => download(`/reports/${tab}${qs({ ...(tab === 'products' ? {} : params), format: 'csv' })}`, `${tab}-report-${todayIST()}.csv`).catch((e) => setErr(e.message))}><Download size={15} /> Export CSV</Button>} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'jobs', label: 'Jobs' }, { id: 'engineers', label: 'Engineers' }, { id: 'clients', label: 'Clients' }, { id: 'products', label: 'Products' }]} />
      {tab !== 'products' && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} max={todayIST()} onChange={(e) => setTo(e.target.value)} /></Field>
          {tab === 'jobs' && <Field label="Group by"><Select value={by} onChange={(e) => setBy(e.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></Select></Field>}
          <Field label="Repeat window (days)" hint="A job is a first-time fix if the machine had no new job within this many days"><Input type="number" min={1} max={90} className="w-24" value={repeat} onChange={(e) => setRepeat(Number(e.target.value) || 7)} /></Field>
        </div>
      )}
      {err && <ErrorNote message={err} />}
      <Body key={tab} tab={tab} query={tab === 'products' ? {} : params} />
    </>
  );
}

// One component per tab (remounted on tab change) so a tab never renders another tab's data
function Body({ tab, query }: { tab: Tab; query: Record<string, string | number> }) {
  const { data, loading, error } = useFetch<any>(`/reports/${tab}${qs(query)}`);
  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  return tab === 'jobs' ? <Jobs d={data} /> : tab === 'engineers' ? <Engineers d={data} /> : tab === 'clients' ? <Clients d={data} /> : <Products d={data} />;
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; jobs: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.jobs));
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="text-sm text-slate-400">No jobs in this range.</p> : (
        <ul className="space-y-2">{rows.slice(0, 10).map((r) => (
          <li key={r.label} className="text-sm"><div className="mb-0.5 flex justify-between gap-3"><span className="truncate text-slate-700">{r.label}</span><span className="font-semibold tabular-nums">{r.jobs}</span></div><div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-indigo-600" style={{ width: `${(r.jobs / max) * 100}%` }} /></div></li>
        ))}</ul>
      )}
    </Card>
  );
}

function Jobs({ d }: { d: any }) {
  const [js, setJs] = useState('');
  const jn = js.trim().toLowerCase();
  const jpg = usePaged(d.rows.filter((r: any) => !jn || `${r.jobNumber} ${r.client} ${r.site} ${r.machine} ${r.engineer} ${r.status}`.toLowerCase().includes(jn)), 25);
  const s = d.summary;
  const max = Math.max(1, ...d.series.flatMap((x: any) => [x.created, x.completed]));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Jobs raised" value={s.total} sub={`${s.completed} completed · ${s.open} open · ${s.cancelled} cancelled`} />
        <Stat label="First-time fix" value={s.firstTimeFixRate == null ? '—' : `${s.firstTimeFixRate}%`} tone={s.firstTimeFixRate != null && s.firstTimeFixRate < 70 ? 'amber' : 'green'} sub={`of ${s.firstTimeFixBasis} finished jobs`} />
        <Stat label="Avg response" value={v(s.avgResponseHours, ' h')} sub="request raised to engineer starts" />
        <Stat label="Avg resolution" value={v(s.avgResolutionHours, ' h')} sub={`on site ${v(s.avgOnSiteHours, ' h')} on average`} />
      </div>
      {s.overdue > 0 && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{s.overdue} open job(s) are past their scheduled time.</p>}
      <Card title={`Raised vs completed (${d.range.by})`} className="mt-4">
        {d.series.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No jobs in this range.</p> : (
          <div className="flex h-40 items-end gap-3 overflow-x-auto border-b border-slate-200 px-1">
            {d.series.map((x: any) => (
              <div key={x.period} className="flex min-w-10 flex-1 flex-col items-center gap-1">
                <div className="flex h-32 items-end gap-1"><div title={`Raised ${x.created}`} className="w-3 rounded-t bg-indigo-600" style={{ height: `${(x.created / max) * 100}%`, minHeight: x.created ? 3 : 0 }} /><div title={`Completed ${x.completed}`} className="w-3 rounded-t bg-emerald-500" style={{ height: `${(x.completed / max) * 100}%`, minHeight: x.completed ? 3 : 0 }} /></div>
                <div className="text-[10.5px] text-slate-500">{x.period.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-4 text-xs text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-indigo-600" />Raised</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />Completed</span></div>
      </Card>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Breakdown title="By status" rows={d.byStatus} /><Breakdown title="By engineer" rows={d.byEngineer} /><Breakdown title="By job type" rows={d.byJobType} />
        <Breakdown title="By client" rows={d.byClient} /><Breakdown title="By site" rows={d.bySite} /><Breakdown title="By product type" rows={d.byProduct} />
      </div>
      <Card title={`Job list (${d.rows.length})`} className="mt-4" actions={<Input className="w-60" placeholder="Search job, client, engineer…" value={js} onChange={(e) => { setJs(e.target.value); jpg.reset(); }} />}>
        <Table head={['Job', 'Raised', 'Client / site', 'Machine', 'Type', 'Engineer', 'Status', 'Response h', 'Resolution h', 'First-time fix']} empty={jpg.meta.total === 0}>
          {jpg.rows.map((r: any) => (
            <tr key={r.jobNumber}><Td className="whitespace-nowrap font-medium">{r.jobNumber}</Td><Td className="whitespace-nowrap text-xs">{r.created}</Td><Td>{r.client}<div className="text-xs text-slate-400">{r.site}</div></Td><Td className="text-xs">{r.machine}</Td><Td className="text-xs">{r.jobType}</Td><Td className="text-xs">{r.engineer}</Td><Td className="text-xs">{r.status}</Td><Td>{v(r.responseHours)}</Td><Td>{v(r.resolutionHours)}</Td><Td>{r.firstTimeFix ? <Badge tone={r.firstTimeFix === 'Yes' ? 'green' : 'amber'}>{r.firstTimeFix}</Badge> : '—'}</Td></tr>
          ))}
        </Table>
        <Pagination meta={jpg.meta} onPage={jpg.setPage} onLimit={jpg.setLimit} />
      </Card>
    </>
  );
}

function Engineers({ d }: { d: any }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active engineers" value={d.totals.engineers} /><Stat label="Jobs completed" value={d.totals.jobsCompleted} tone="green" />
        <Stat label="Pending jobs" value={d.totals.jobsPending} /><Stat label="Overdue" value={d.totals.overdue} tone={d.totals.overdue ? 'red' : 'green'} />
      </div>
      <Card title="Performance scorecard" className="mt-4">
        <Table head={['Engineer', 'Zone', 'Assigned', 'Completed', 'Primary / support', 'Avg on-site h', 'First-time fix', 'Pending', 'Overdue', 'Declined', 'Days present', 'Late', 'Leave days']} empty={d.rows.length === 0}>
          {d.rows.map((r: any) => (
            <tr key={r.engineer}><Td className="whitespace-nowrap font-medium">{r.engineer}</Td><Td className="text-xs">{r.zone || '—'}</Td><Td>{r.jobsAssigned}</Td><Td className="font-semibold">{r.jobsCompleted}</Td><Td>{r.asPrimary} / {r.asSupporting}</Td><Td>{v(r.avgOnSiteHours)}</Td><Td>{r.firstTimeFixRate == null ? '—' : <Badge tone={r.firstTimeFixRate >= 70 ? 'green' : 'amber'}>{r.firstTimeFixRate}%</Badge>}</Td><Td>{r.pending}</Td><Td>{r.overdue ? <Badge tone="red">{r.overdue}</Badge> : 0}</Td><Td>{r.declined}</Td><Td>{r.daysPresent}</Td><Td>{r.lateDays}</Td><Td>{r.leaveDays}</Td></tr>
          ))}
        </Table>
      </Card>
      <Card title="Workforce today" className="mt-4">
        <Table head={['Engineer', 'Zone', 'Today', 'Jobs today']} empty={d.workforce.length === 0}>
          {d.workforce.map((w: any) => <tr key={w.engineer}><Td className="font-medium">{w.engineer}</Td><Td className="text-xs">{w.zone || '—'}</Td><Td><Badge tone={w.today === 'Checked in' ? 'green' : w.today === 'On leave' ? 'slate' : 'amber'}>{w.today}</Badge></Td><Td>{w.jobsToday}</Td></tr>)}
        </Table>
      </Card>
    </>
  );
}

function Clients({ d }: { d: any }) {
  return (
    <Card title="Service frequency by client">
      <Table head={['Client', 'Jobs', 'Machines serviced', 'Last job', 'Avg days between jobs', 'Repeat breakdowns', 'Avg rating']} empty={d.rows.length === 0}>
        {d.rows.map((r: any) => (
          <tr key={r.code}><Td><span className="font-medium">{r.client}</span><div className="text-xs text-slate-400">{r.code}</div></Td><Td className="font-semibold">{r.jobs}</Td><Td>{r.machinesServiced}</Td><Td className="whitespace-nowrap text-xs">{r.lastJob}</Td><Td>{v(r.avgDaysBetweenJobs)}</Td><Td>{r.repeatBreakdowns ? <Badge tone="amber">{r.repeatBreakdowns}</Badge> : 0}</Td><Td>{r.avgRating == null ? '—' : `${r.avgRating} (${r.ratingsCount})`}</Td></tr>
        ))}
      </Table>
    </Card>
  );
}

function Products({ d }: { d: any }) {
  const [ps, setPs] = useState('');
  const pn = ps.trim().toLowerCase();
  const ppg = usePaged(d.rows.filter((r: any) => !pn || `${r.brand} ${r.productType} ${r.model}`.toLowerCase().includes(pn)), 25);
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Machines installed" value={d.totalUnits.toLocaleString()} /><Stat label="Distinct models" value={d.rows.length} /></div>
      <Card title="Installed base by model" actions={<Input className="w-56" placeholder="Search brand or model…" value={ps} onChange={(e) => { setPs(e.target.value); ppg.reset(); }} />}>
        <Table head={['Brand', 'Product type', 'Model', 'Units installed', 'Clients']} empty={ppg.meta.total === 0}>
          {ppg.rows.map((r: any, i: number) => <tr key={i}><Td>{r.brand}</Td><Td>{r.productType}</Td><Td className="font-medium">{r.model}</Td><Td className="font-semibold tabular-nums">{r.unitsInstalled}</Td><Td className="tabular-nums">{r.clients}</Td></tr>)}
        </Table>
        <Pagination meta={ppg.meta} onPage={ppg.setPage} onLimit={ppg.setLimit} />
      </Card>
    </>
  );
}

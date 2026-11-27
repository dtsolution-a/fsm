'use client';
import Link from 'next/link';
import { Badge, Card, ErrorNote, PageHeader, Spinner, Stat, Table, Td } from '@/components/ui';
import { fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

export default function Dashboard() {
  const { data: d, error, loading } = useFetch<any>('/dashboard');
  const ops = useFetch<any>('/jobs/dashboard');
  const inv = useFetch<any>('/inventory/summary');
  const rec = useFetch<any>('/billing/outstanding');
  const drafts = useFetch<any>('/invoices?status=draft&limit=1');
  const jc = (code: string) => ops.data?.jobsByStatus?.find((s: any) => s.code === code)?.count ?? 0;
  if (loading && !d) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!d) return null;
  const fbPct = (n: number) => (d.feedback.total ? Math.round((n / d.feedback.total) * 100) : 0);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live overview of clients, contracts and field staff" />

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/receivables"><Stat label="Receivable" value={rec.data ? `₹ ${Number(rec.data.totalBalance).toLocaleString('en-IN')}` : '—'} sub={`${rec.data?.clients?.length ?? 0} clients owe money`} /></Link>
        <Link href="/receivables"><Stat label="Overdue" value={rec.data ? `₹ ${Number(rec.data.totalOverdue).toLocaleString('en-IN')}` : '—'} tone={rec.data?.totalOverdue ? 'red' : 'green'} sub="past due date" /></Link>
        <Link href="/invoices?status=draft"><Stat label="Draft invoices" value={drafts.data?.meta?.total ?? '—'} tone={drafts.data?.meta?.total ? 'amber' : undefined} sub="waiting for rates" /></Link>
        <Link href="/quotations"><Stat label="Quotations" value="Open" sub="create and track" /></Link>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/service-requests"><Stat label="Open service requests" value={ops.data?.openRequests ?? '—'} sub="waiting for a job" tone={ops.data?.openRequests ? 'amber' : undefined} /></Link>
        <Link href="/jobs"><Stat label="Jobs in progress" value={jc('in_progress')} sub={`${jc('assigned') + jc('rescheduled')} assigned · ${jc('open')} unassigned`} /></Link>
        <Link href="/jobs"><Stat label="Closure approvals" value={ops.data?.pendingApprovals ?? '—'} sub="backdated completions" tone={ops.data?.pendingApprovals ? 'red' : undefined} /></Link>
        <Link href="/inventory"><Stat label="Low-stock lines" value={inv.data?.lowStockLines ?? '—'} sub="at or below reorder level" tone={inv.data?.lowStockLines ? 'red' : 'green'} /></Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active clients" value={d.clients.toLocaleString()} sub={`${d.sites.toLocaleString()} sites`} />
        <Stat label="Installed units" value={d.units.toLocaleString()} sub={`${d.models.toLocaleString()} models in catalog`} />
        <Stat label="Active contracts" value={d.contracts.active.toLocaleString()} sub={`${d.contracts.expired} expired`} />
        <Stat label="Expiring in 30 days" value={d.contracts.expiring30} tone={d.contracts.expiring30 ? 'amber' : undefined} sub="renewal reminders at 30 / 15 / 7 days" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Today's attendance" actions={<Link href="/attendance" className="text-xs text-indigo-600 hover:underline">Open console</Link>}>
          <div className="grid grid-cols-2 gap-3 text-center">
            <Mini label="Checked in" v={d.engineers.checkedIn - d.engineers.late} tone="green" />
            <Mini label="Late" v={d.engineers.late} tone="amber" />
            <Mini label="On leave" v={d.engineers.onLeave} />
            <Mini label="Not checked in" v={d.engineers.notCheckedIn} tone={d.engineers.notCheckedIn ? 'red' : undefined} />
          </div>
          <p className="mt-3 text-center text-xs text-slate-400">{d.engineers.total} active engineers{d.pendingLeaves ? ` · ${d.pendingLeaves} leave request(s) waiting` : ''}</p>
        </Card>

        <Card title="Customer feedback">
          {d.feedback.total === 0 ? <p className="py-6 text-center text-sm text-slate-400">No feedback recorded yet</p> : (
            <div className="space-y-3">
              <Bar label="Happy" pct={fbPct(d.feedback.happy)} n={d.feedback.happy} color="bg-emerald-500" />
              <Bar label="Neutral" pct={fbPct(d.feedback.neutral)} n={d.feedback.neutral} color="bg-amber-400" />
              <Bar label="Unhappy" pct={fbPct(d.feedback.unhappy)} n={d.feedback.unhappy} color="bg-rose-500" />
              <p className="text-xs text-slate-400">Ratings of 2★ or below alert the GA Head automatically.</p>
            </div>
          )}
        </Card>

        <Card title="Catalog">
          <dl className="space-y-2 text-sm">
            <Row k="Product models" v={d.models.toLocaleString()} />
            <Row k="Spare parts" v={d.parts.toLocaleString()} />
            <Row k="Client sites" v={d.sites.toLocaleString()} />
          </dl>
        </Card>
      </div>

      <Card title="Contracts expiring in the next 30 days" className="mt-4" actions={<Link href="/contracts?status=expiring" className="text-xs text-indigo-600 hover:underline">View all</Link>}>
        <Table head={['Contract', 'Client', 'Type', 'Ends']} empty={d.expiringSoon.length === 0}>
          {d.expiringSoon.map((c: any) => (
            <tr key={c.id}>
              <Td><Link href="/contracts" className="font-medium text-indigo-600 hover:underline">{c.contractNumber}</Link></Td>
              <Td>{c.client.companyName}</Td>
              <Td><Badge tone="blue">{c.contractType.label}</Badge></Td>
              <Td>{fmtDate(c.endDate)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

const Mini = ({ label, v, tone }: { label: string; v: number; tone?: 'green' | 'amber' | 'red' }) => (
  <div className="rounded-lg bg-slate-50 py-3">
    <div className={`text-2xl font-semibold ${tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-rose-600' : 'text-slate-800'}`}>{v}</div>
    <div className="text-xs text-slate-500">{label}</div>
  </div>
);
const Bar = ({ label, pct, n, color }: { label: string; pct: number; n: number; color: string }) => (
  <div>
    <div className="mb-1 flex justify-between text-xs text-slate-600"><span>{label}</span><span>{n} ({pct}%)</span></div>
    <div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} /></div>
  </div>
);
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-800">{v}</dd></div>;

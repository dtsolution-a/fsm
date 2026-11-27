'use client';
import RowActions from '@/components/RowActions';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import CreateJob from '@/components/CreateJob';
import { priorityTone, statusTone } from '@/components/pickers';
import { Badge, Button, Card, ErrorNote, Input, PageHeader, Pagination, Select, Spinner, Stat, Table, Td } from '@/components/ui';
import { fmtDateTime, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

const VIEWS = [
  { id: 'all', label: 'All jobs', status: '' },
  { id: 'open', label: 'Open / unassigned', status: 'open' },
  { id: 'active', label: 'Assigned / in progress', status: 'assigned,in_progress,rescheduled' },
  { id: 'review', label: 'Needs approval', status: 'pending_review' },
  { id: 'done', label: 'Completed', status: 'completed,closed' },
];

export default function Jobs() {
  const { user } = useAuth();
  const router = useRouter();
  const [view, setView] = useState('all');
  const [dup, setDup] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const status = VIEWS.find((v) => v.id === view)!.status;
  const { data, loading, error, reload } = useFetch<any>(`/jobs${qs({ status, search: q, duplicates: dup ? 'true' : '', page, limit })}`);
  const dash = useFetch<any>('/jobs/dashboard');
  const canCreate = user?.role === 'admin' || user?.role === 'ga_head';

  return (
    <>
      <PageHeader title="Jobs" subtitle="Create, dispatch and track every field job"
        actions={<>{<Link href="/dispatch" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Dispatch calendar</Link>}{canCreate && <Button onClick={() => setCreating(true)}>+ New job</Button>}</>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open requests" value={dash.data?.openRequests ?? '—'} sub="waiting for a job" tone={dash.data?.openRequests ? 'amber' : undefined} />
        <Stat label="Closure approvals" value={dash.data?.pendingApprovals ?? '—'} sub="backdated completions" tone={dash.data?.pendingApprovals ? 'red' : undefined} />
        <Stat label="Possible duplicates" value={dash.data?.duplicates ?? '—'} tone={dash.data?.duplicates ? 'amber' : undefined} />
        <Stat label="In progress now" value={dash.data?.jobsByStatus?.find((s: any) => s.code === 'in_progress')?.count ?? '—'} />
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-xs" placeholder="Search job no., client or work…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select className="w-52" value={view} onChange={(e) => { setView(e.target.value); setPage(1); }}>{VIEWS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={dup} onChange={(e) => { setDup(e.target.checked); setPage(1); }} /> Duplicates only</label>
        </div>
        {error && <ErrorNote message={error} />}
        {loading && !data ? <Spinner /> : (
          <>
            <Table head={['Job', 'Client / site', 'Machine', 'Type', 'Scheduled', 'Engineer(s)', 'Priority', 'Status', 'Actions']} empty={data?.data.length === 0}>
              {data?.data.map((j: any) => (
                <tr key={j.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/jobs/${j.id}`)}>
                  <Td className="whitespace-nowrap font-medium text-indigo-700">{j.jobNumber}{j.duplicateOfJobId && <span className="ml-1"><Badge tone="amber">duplicate?</Badge></span>}</Td>
                  <Td>{j.client.companyName}<div className="text-xs text-slate-400">{j.site?.siteName}</div></Td>
                  <Td className="text-xs">{j.siteProduct?.model?.name || j.siteProduct?.rawModel || '—'}<div className="font-mono text-slate-400">{j.siteProduct?.serialNumber}</div></Td>
                  <Td className="text-xs">{j.jobType.label}</Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(j.scheduledStart)}</Td>
                  <Td className="text-xs">{j.engineers.filter((e: any) => !e.declinedAt).map((e: any) => <div key={e.id}>{e.engineer.user.fullName}{e.role === 'primary' ? '' : ' (support)'}</div>)}{j.engineers.length === 0 && <span className="text-slate-400">Unassigned</span>}</Td>
                  <Td><Badge tone={priorityTone(j.priority.code)}>{j.priority.label}</Badge></Td>
                  <Td><Badge tone={statusTone(j.status.code)}>{j.status.label}</Badge></Td>
                  <Td className="text-right"><RowActions entity="jobs" id={j.id} viewHref={`/jobs/${j.id}`} onChanged={reload} /></Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </Card>
      <CreateJob open={creating} onClose={() => setCreating(false)} onDone={(j) => router.push(`/jobs/${j.id}`)} />
    </>
  );
}

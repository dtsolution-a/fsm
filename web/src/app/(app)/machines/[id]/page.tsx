'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import RowActions from '@/components/RowActions';
import { Badge, Card, ErrorNote, Input, PageHeader, Pagination, Spinner } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/api';
import { useFetch, usePaged } from '@/lib/hooks';

// Service history of one machine (what the engineer sees before the job, 3.4)
export default function Machine() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, reload } = useFetch<any>(`/machines/${id}/history`);
  const router = useRouter();
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const pg = usePaged((data?.jobs || []).filter((j: any) => !needle || `${j.jobNumber} ${j.description || ''} ${j.closureNotes || ''} ${j.jobType?.label || ''}`.toLowerCase().includes(needle)), 10);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const m = data.machine;
  return (
    <>
      <PageHeader title={m.model || 'Machine'} subtitle={`${m.client} · ${m.site} · Serial ${m.serialNumber || '—'}`} actions={<><Link href="/jobs" className="text-sm text-indigo-600 hover:underline">← Jobs</Link><RowActions entity="machines" id={id} canView={false} onChanged={reload} onDeleted={() => router.replace('/clients')} /><Link href={`/machines/${id}/qr`} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3.5 text-[13.5px] font-medium text-slate-700 hover:bg-slate-50">Print QR sticker</Link></>} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {m.warrantyExpiry && <Badge tone="blue">Warranty until {fmtDate(m.warrantyExpiry)}</Badge>}
        {m.contracts.map((c: any) => <Badge key={c.id} tone="green">{c.contractType.label}: {c.contractNumber} → {fmtDate(c.endDate)}</Badge>)}
      </div>
      <Card title={`Service history (${data.jobs.length})`} actions={data.jobs.length > 10 && <Input className="w-56" placeholder="Search visits…" value={search} onChange={(e) => { setSearch(e.target.value); pg.reset(); }} />}>
        {data.jobs.length === 0 ? <p className="text-sm text-slate-400">No jobs recorded for this machine yet.</p> : (
          <ol className="space-y-4">
            {pg.rows.map((j: any) => (
              <li key={j.id} className="rounded-lg border border-slate-100 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/jobs/${j.id}`} className="font-medium text-indigo-700 hover:underline">{j.jobNumber}</Link><span className="text-xs text-slate-400">{j.jobType.label} · {j.status.label} · {fmtDateTime(j.actualEnd || j.scheduledStart)}</span></div>
                {j.description && <p className="mt-1 text-slate-700">{j.description}</p>}
                {j.closureNotes && <p className="mt-1 text-emerald-700">Resolution: {j.closureNotes}</p>}
                <div className="mt-1 text-xs text-slate-500">{j.engineers.map((e: any) => `${e.engineer.user.fullName}${e.role === 'supporting' ? ' (support)' : ''}`).join(', ') || 'No engineer'}{j.partsUsed.length > 0 && ` · Parts: ${j.partsUsed.map((p: any) => `${p.quantity}× ${p.sparePart.name}`).join(', ')}`}</div>
              </li>
            ))}
          </ol>
        )}
        <Pagination meta={pg.meta} onPage={pg.setPage} onLimit={pg.setLimit} />
      </Card>
    </>
  );
}

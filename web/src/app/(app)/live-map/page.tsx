'use client';
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { Card, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { fmtDateTime } from '@/lib/api';
import { useState } from 'react';
import { Input, Pagination } from '@/components/ui';
import { useFetch, usePaged } from '@/lib/hooks';

// Leaflet touches `window`, so it is client-only. Markers render on canvas for speed.
const LiveMap = dynamic(() => import('@/components/LiveMap').then((m) => m.LiveMap), { ssr: false, loading: () => <Spinner /> });

export default function LiveMapPage() {
  const { data, error, loading, reload } = useFetch<any[]>('/engineers/live');
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const pg = usePaged((data || []).filter((e) => !needle || String(e.name).toLowerCase().includes(needle)), 10);
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);

  return (
    <>
      <PageHeader title="Live map" subtitle="Latest known position of every engineer (last 2 hours). Refreshes every 15 seconds." />
      {error && <ErrorNote message={error} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="h-[70vh] overflow-hidden rounded-xl border border-slate-200 bg-white">
          {loading && !data ? <Spinner /> : <LiveMap engineers={data || []} />}
        </div>
        <Card title={`On the map (${data?.length ?? 0})`} className="max-h-[70vh] overflow-y-auto">
          {(data?.length ?? 0) > 10 && <div className="mb-2"><Input placeholder="Search engineer…" value={search} onChange={(e) => { setSearch(e.target.value); pg.reset(); }} /></div>}
          {data?.length === 0 && <p className="text-sm text-slate-400">No engineer has reported a location in the last 2 hours.</p>}
          <ul className="divide-y divide-slate-100">
            {pg.rows.map((e) => <li key={e.engineerId} className="py-2 text-sm"><div className="font-medium text-slate-800">{e.name}</div><div className="text-xs text-slate-400">{fmtDateTime(e.recordedAt)}</div></li>)}
          </ul>
          <Pagination meta={pg.meta} onPage={pg.setPage} onLimit={pg.setLimit} />
        </Card>
      </div>
    </>
  );
}

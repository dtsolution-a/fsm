'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Input, PageHeader, Select, Spinner } from '@/components/ui';
import { post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

const SitesMap = dynamic(() => import('@/components/ZoneMap').then((m) => m.SitesMap), { ssr: false, loading: () => <Spinner /> });
const ZonesMap = dynamic(() => import('@/components/ZoneMap').then((m) => m.ZonesMap), { ssr: false, loading: () => <Spinner /> });

export default function ZoneMap() {
  const { user } = useAuth();
  const canLocate = user?.role === 'admin' || user?.role === 'ga_head';
  const [zoneId, setZoneId] = useState(''); const [filter, setFilter] = useState('all'); const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const zones = useFetch<any[]>('/map/zones');
  const sites = useFetch<any>(zoneId ? `/map/sites${qs({ zoneId, filter, search: q })}` : null);
  const status = useFetch<any>('/map/geocode/status');
  const [err, setErr] = useState('');

  // a person with one branch lands straight in it
  useEffect(() => { if (!zoneId && zones.data?.length === 1) setZoneId(zones.data[0].zoneId); }, [zones.data, zoneId]);
  // keep the progress of "locate stations" fresh while it runs
  useEffect(() => {
    if (!status.data?.running) return;
    const t = setInterval(() => { status.reload(); }, 3000);
    return () => clearInterval(t);
  }, [status.data?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (status.data && !status.data.running && status.data.finishedAt) { zones.reload(); if (zoneId) sites.reload(); } }, [status.data?.running]); // eslint-disable-line react-hooks/exhaustive-deps

  async function locate() { setErr(''); try { await post('/map/geocode', { places: 150 }); status.reload(); } catch (e: any) { setErr(e.message); } }
  const total = (zones.data || []).reduce((a, z) => ({ sites: a.sites + z.sites, mapped: a.mapped + z.mapped, req: a.req + z.openRequests, jobs: a.jobs + z.openJobs, late: a.late + z.delayed }), { sites: 0, mapped: 0, req: 0, jobs: 0, late: 0 });
  const zoneName = zones.data?.find((z) => z.zoneId === zoneId)?.zone;

  return (
    <>
      <PageHeader title="Zone map" subtitle="Where your service stations are, how many requests are open and which are late. Red = something delayed, amber = work open, green = nothing pending."
        actions={canLocate && <Button variant="secondary" disabled={status.data?.running} onClick={locate}><MapPin size={15} /> {status.data?.running ? `Locating ${status.data.done}/${status.data.total}…` : 'Locate stations'}</Button>} />
      {err && <div className="mb-3"><ErrorNote message={err} /></div>}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Mini label="Stations" value={total.sites.toLocaleString()} /><Mini label="On the map" value={total.mapped.toLocaleString()} sub={total.sites - total.mapped > 0 ? `${(total.sites - total.mapped).toLocaleString()} without a position` : undefined} />
        <Mini label="Open requests" value={total.req} tone="amber" /><Mini label="Open jobs" value={total.jobs} tone="amber" /><Mini label="Delayed" value={total.late} tone={total.late ? 'red' : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card title="Branches" className="max-h-[68vh] overflow-y-auto">
          {zones.loading && !zones.data ? <Spinner /> : (
            <ul className="space-y-1 text-sm">
              {(zones.data || []).length > 1 && <li><button onClick={() => setZoneId('')} className={`w-full rounded-md px-2.5 py-2 text-left ${!zoneId ? 'bg-indigo-50 font-medium text-indigo-700' : 'hover:bg-slate-50'}`}>All branches</button></li>}
              {(zones.data || []).map((z) => (
                <li key={z.zoneId}>
                  <button onClick={() => setZoneId(z.zoneId)} className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left ${z.zoneId === zoneId ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}>
                    <span className="min-w-0"><span className="block truncate font-medium">{z.zone}</span><span className="text-xs text-slate-400">{z.sites} stations{z.mapped < z.sites ? ` · ${z.mapped} located` : ''}</span></span>
                    <span className="flex shrink-0 gap-1">{z.delayed > 0 && <Badge tone="red">{z.delayed}</Badge>}{z.openRequests + z.openJobs > 0 && <Badge tone="amber">{z.openRequests + z.openJobs}</Badge>}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div>
          {zoneId && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-700">{zoneName}</span>
              <Select className="w-44" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All stations</option><option value="open">With open work</option><option value="delayed">Delayed only</option></Select>
              <Input className="w-56" placeholder="Search station or client…" value={search} onChange={(e) => setSearch(e.target.value)} />
              {sites.data && <span className="text-xs text-slate-500">{sites.data.matched} shown{sites.data.unmapped > 0 ? ` · ${sites.data.unmapped} stations have no position yet` : ''}</span>}
            </div>
          )}
          <div className="h-[62vh] overflow-hidden rounded-xl border border-slate-200 bg-white">
            {!zoneId ? <ZonesMap zones={zones.data || []} onPick={setZoneId} /> : sites.loading && !sites.data ? <Spinner /> : <SitesMap sites={sites.data?.sites || []} />}
          </div>
          {!zoneId && total.mapped === 0 && <p className="mt-2 text-sm text-slate-500">No station has a position yet. {canLocate ? 'Press “Locate stations”: it finds each pincode / town on OpenStreetMap (only the pincode or town name is sent) and marks the stations there. Exact positions are learned when an engineer scans the machine QR at the station, or can be typed on the site.' : 'Ask an admin to locate the stations.'}</p>}
          {status.data && !status.data.running && status.data.finishedAt && <p className="mt-2 text-xs text-slate-400">Last locating run: {status.data.found} places found, {status.data.failed} not found.</p>}
        </div>
      </div>
    </>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'red' | 'amber' }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-4 py-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone === 'red' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</div>{sub && <div className="text-xs text-slate-400">{sub}</div>}</div>;
}

'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { use, useState } from 'react';
import { EngineerTravelCard } from '@/components/TravelCards';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner } from '@/components/ui';
import { fmtDateTime, post, todayIST } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/hooks';

const RouteMap = dynamic(() => import('@/components/LiveMap').then((m) => m.RouteMap), { ssr: false, loading: () => <Spinner /> });

export default function EngineerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const e = useFetch<any>(`/engineers/${id}`);
  const [date, setDate] = useState(todayIST());
  const route = useFetch<any>(`/engineers/${id}/route?date=${date}`);
  const x = e.data;

  if (e.loading && !x) return <Spinner />;
  if (e.error) return <ErrorNote message={e.error} />;
  if (!x) return null;

  async function toggle() { await post(`/engineers/${id}/${x.isActive ? 'deactivate' : 'activate'}`); e.reload(); }

  return (
    <>
      <div className="mb-2 text-sm"><Link href="/engineers" className="text-indigo-600 hover:underline">← Engineers</Link></div>
      <PageHeader title={x.user.fullName} subtitle={`${x.user.userCode || 'no user ID'}${x.designation ? ' · ' + x.designation : ''}`}
        actions={<><Badge tone={x.isActive ? 'green' : 'slate'}>{x.isActive ? 'Active' : 'Inactive'}</Badge>{user?.role === 'admin' && <Button variant={x.isActive ? 'danger' : 'secondary'} onClick={toggle}>{x.isActive ? 'Deactivate' : 'Reactivate'}</Button>}</>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Profile">
          <dl className="space-y-2 text-sm">
            <Row k="Phone" v={x.user.phone} /><Row k="Email" v={x.user.email} /><Row k="City" v={x.city} />
            <Row k="Primary zone" v={x.primaryZone?.name} /><Row k="Employee code" v={x.employeeCode} />
          </dl>
        </Card>
        <Card title="Zones covered">
          <div className="flex flex-wrap gap-1.5">{x.zones.map((z: any) => <Badge key={z.zoneId} tone="blue">{z.zone.name}</Badge>)}{x.zones.length === 0 && <span className="text-sm text-slate-400">None assigned</span>}</div>
        </Card>
        <Card title="Skills">
          <div className="flex flex-wrap gap-1.5">{x.skills.map((s: any) => <Badge key={s.skillCategoryId} tone="green">{s.skill.label}</Badge>)}{x.skills.length === 0 && <span className="text-sm text-slate-400">No skills tagged — needed for auto-suggest when jobs go live</span>}</div>
        </Card>
      </div>

      <div className="mt-4"><EngineerTravelCard engineerId={id} /></div>

      <Card title="Route history" className="mt-4" actions={<Field label=""><Input type="date" value={date} max={todayIST()} onChange={(ev) => setDate(ev.target.value)} className="w-44" /></Field>}>
        {route.loading && !route.data ? <Spinner /> : route.data?.points.length ? (
          <>
            <div className="h-96"><RouteMap points={route.data.points} /></div>
            <p className="mt-2 text-xs text-slate-400">{route.data.points.length} points · first {fmtDateTime(route.data.points[0].at)} · last {fmtDateTime(route.data.points.at(-1).at)}</p>
          </>
        ) : <p className="py-10 text-center text-sm text-slate-400">No GPS points recorded on this date</p>}
      </Card>
    </>
  );
}
const Row = ({ k, v }: { k: string; v?: string | null }) => <div className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-800">{v || '—'}</dd></div>;

'use client';
import Link from 'next/link';
import { useState } from 'react';
import { statusTone } from '@/components/pickers';
import { Badge, Button, Card, ErrorNote, PageHeader, Select, Spinner } from '@/components/ui';
import { patch, qs, todayIST } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/hooks';

const addDays = (ymd: string, n: number) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const weekStart = (ymd: string) => { const d = new Date(`${ymd}T00:00:00Z`); return addDays(ymd, -((d.getUTCDay() + 6) % 7)); };
const istDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const istTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// Drag a job card onto another day to reschedule it (04.3). The engineer is notified; leave conflicts are blocked by the server.
export default function Dispatch() {
  const { user } = useAuth();
  const [start, setStart] = useState(weekStart(todayIST()));
  const [eng, setEng] = useState('');
  const [msg, setMsg] = useState('');
  const [drag, setDrag] = useState<any>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const cal = useFetch<any>(`/jobs/calendar${qs({ from: days[0], to: days[6] })}`);
  const unassigned = useFetch<any>(`/jobs${qs({ status: 'open', limit: 20 })}`);
  const engineers = useFetch<any>('/engineers?limit=200&active=true');
  const canEdit = user?.role === 'admin' || user?.role === 'ga_head';

  async function drop(day: string) {
    if (!drag || !canEdit) return;
    const j = drag; setDrag(null); setMsg('');
    const time = j.scheduledStart ? istTime(j.scheduledStart) : '10:00';
    if (j.scheduledStart && istDay(j.scheduledStart) === day) return;
    try { await patch(`/jobs/${j.id}`, { scheduledStart: new Date(`${day}T${time}:00+05:30`).toISOString() }); cal.reload(); unassigned.reload(); }
    catch (e: any) { setMsg(e.message); }
  }
  const jobs = (cal.data?.jobs || []).filter((j: any) => !eng || j.engineers.some((e: any) => e.engineerId === eng && !e.declinedAt));

  return (
    <>
      <PageHeader title="Dispatch calendar" subtitle={canEdit ? 'Drag a job onto another day to reschedule it' : 'Weekly schedule'}
        actions={<><Select className="w-48" value={eng} onChange={(e) => setEng(e.target.value)}><option value="">All engineers</option>{engineers.data?.data?.map((e: any) => <option key={e.id} value={e.id}>{e.user.fullName}</option>)}</Select>
          <Button variant="secondary" onClick={() => setStart(addDays(start, -7))}>← Prev</Button><Button variant="secondary" onClick={() => setStart(weekStart(todayIST()))}>Today</Button><Button variant="secondary" onClick={() => setStart(addDays(start, 7))}>Next →</Button></>} />
      {msg && <div className="mb-3"><ErrorNote message={msg} /></div>}
      {cal.loading && !cal.data ? <Spinner /> : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => {
            const dayJobs = jobs.filter((j: any) => istDay(j.scheduledStart) === d);
            const leaves = (cal.data?.leaves || []).filter((l: any) => l.startDate.slice(0, 10) <= d && l.endDate.slice(0, 10) >= d);
            return (
              <div key={d} onDragOver={(e) => canEdit && e.preventDefault()} onDrop={() => drop(d)}
                className={`min-h-48 rounded-xl border p-2 ${d === todayIST() ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}>
                <div className="mb-2 text-xs font-semibold text-slate-600">{new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })}</div>
                {leaves.map((l: any) => <div key={l.id} className="mb-1 rounded border border-dashed border-slate-300 bg-slate-50 px-1.5 py-1 text-[11px] text-slate-500">{l.engineer.user.fullName} · on leave</div>)}
                <div className="space-y-1.5">
                  {dayJobs.map((j: any) => <Card2 key={j.id} j={j} onDrag={() => setDrag(j)} draggable={canEdit} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Card title="Open jobs — not yet assigned" className="mt-4">
        {unassigned.data?.data?.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unassigned.data.data.map((j: any) => <Card2 key={j.id} j={j} onDrag={() => setDrag(j)} draggable={canEdit} showDate />)}
          </div>
        ) : <p className="text-sm text-slate-400">Every open job has an engineer.</p>}
      </Card>
    </>
  );
}

function Card2({ j, onDrag, draggable, showDate }: { j: any; onDrag(): void; draggable?: boolean; showDate?: boolean }) {
  const eng = j.engineers.filter((e: any) => !e.declinedAt)[0]?.engineer.user.fullName || 'Unassigned';
  return (
    <div draggable={draggable} onDragStart={onDrag} className={`rounded-md border border-slate-200 border-l-[3px] border-l-indigo-600 bg-white p-2 text-xs ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}>
      <div className="flex items-start justify-between gap-1">
        <Link href={`/jobs/${j.id}`} className="whitespace-nowrap text-[11px] font-semibold text-indigo-700 hover:underline">{j.jobNumber.replace('JOB-', '')}</Link>
      </div>
      <div className="mt-1 truncate font-medium text-slate-800">{j.client.companyName}</div>
      <div className="mt-0.5 truncate text-slate-500">{j.scheduledStart ? istTime(j.scheduledStart) : 'No time'}{showDate && j.scheduledStart ? ` · ${istDay(j.scheduledStart)}` : ''} · {eng}</div>
      <div className="mt-1.5"><Badge tone={statusTone(j.status.code)}>{j.status.label}</Badge></div>
    </div>
  );
}

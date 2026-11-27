'use client';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, PageHeader, Pagination, Select, Spinner } from '@/components/ui';
import { api, fmtDateTime, patch } from '@/lib/api';
import { useFetch, usePaged } from '@/lib/hooks';

const titles: Record<string, string> = {
  negative_feedback: 'Negative client feedback',
  backdated_attempt: 'Backdated entry attempt blocked',
  new_service_request: 'New service request',
  contract_expiry: 'Contract renewal reminder',
  low_stock: 'Low stock',
};
function describe(n: any) {
  const p = n.payload || {};
  if (n.eventCode === 'negative_feedback') return `${p.rating}★ rating${p.comment ? ` — “${p.comment}”` : ''}`;
  if (n.eventCode === 'contract_expiry') return `${p.contractNumber} (${p.client}) — ${p.type} ends on ${p.endDate}, in ${p.days} days`;
  if (n.eventCode === 'backdated_attempt') return `${p.by} tried to enter a past-dated ${String(p.entity || '').replace('_', ' ')}${p.claimedDate ? ` (${p.claimedDate})` : p.startDate ? ` (${p.startDate})` : ''}. It was rejected.`;
  return JSON.stringify(p);
}

export default function Notifications() {
  const { data, loading, error, reload } = useFetch<any>('/notifications');
  const [only, setOnly] = useState('');
  const pg = usePaged((data?.items || []).filter((n: any) => only !== 'unread' || !n.isRead), 15);
  async function readAll() { await patch('/notifications/read-all'); reload(); }
  async function read(id: string) { await patch(`/notifications/${id}/read`); reload(); }
  async function remove(id: string) { await api('DELETE', `/notifications/${id}`); reload(); }
  async function clearRead() { await api('DELETE', '/notifications'); reload(); }

  return (
    <>
      <PageHeader title="Notifications" subtitle="Alerts that need the GA Head's attention" actions={<div className="flex gap-2"><Select className="w-36" value={only} onChange={(e) => { setOnly(e.target.value); pg.reset(); }}><option value="">All</option><option value="unread">Unread only</option></Select>{data?.unread > 0 && <Button variant="secondary" onClick={readAll}>Mark all read</Button>}<Button variant="secondary" onClick={clearRead}>Clear read</Button></div>} />
      {error && <ErrorNote message={error} />}
      <Card>
        {loading && !data ? <Spinner /> : pg.meta.total === 0 ? <p className="py-10 text-center text-sm text-slate-400">You're all caught up</p> : (
          <><ul className="divide-y divide-slate-100">
            {pg.rows.map((n: any) => (
              <li key={n.id} className={`flex items-start justify-between gap-3 py-3 ${n.isRead ? 'opacity-60' : ''}`}>
                <div>
                  <div className="flex items-center gap-2"><span className="text-sm font-medium text-slate-800">{titles[n.eventCode] || n.eventCode}</span>{!n.isRead && <Badge tone="red">New</Badge>}</div>
                  <p className="mt-0.5 text-sm text-slate-600">{describe(n)}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{fmtDateTime(n.createdAt)}</p>
                </div>
                <span className="flex shrink-0 items-center gap-2">{!n.isRead && <button onClick={() => read(n.id)} className="text-xs text-indigo-600 hover:underline">Mark read</button>}<button onClick={() => remove(n.id)} title="Delete" aria-label="Delete" className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button></span>
              </li>
            ))}
          </ul>
          <Pagination meta={pg.meta} onPage={pg.setPage} onLimit={pg.setLimit} /></>
        )}
      </Card>
    </>
  );
}

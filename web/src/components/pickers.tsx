'use client';
import { useState } from 'react';
import { Field, Input, Select } from '@/components/ui';
import { qs } from '@/lib/api';
import { useDebounced, useFetch } from '@/lib/hooks';

// Client search -> machine picker. Used by the service request and job forms.
export function MachinePicker({ onChange }: { onChange(v: { clientId: string; siteProductId: string; clientName: string }): void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const clients = useFetch<any>(q.length >= 2 ? `/clients${qs({ search: q, limit: 8, active: 'true' })}` : null);
  const [client, setClient] = useState<any>(null);
  const units = useFetch<any[]>(client ? `/clients/${client.id}/products` : null);

  return (
    <div className="space-y-3">
      <Field label="Client">
        {client ? (
          <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm">
            <span className="font-medium">{client.companyName}</span>
            <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => { setClient(null); setSearch(''); onChange({ clientId: '', siteProductId: '', clientName: '' }); }}>Change</button>
          </div>
        ) : (
          <>
            <Input placeholder="Type 2+ letters of the client name…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {clients.data?.data?.length > 0 && (
              <ul className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
                {clients.data.data.map((c: any) => (
                  <li key={c.id}><button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50" onClick={() => { setClient(c); onChange({ clientId: c.id, siteProductId: '', clientName: c.companyName }); }}>{c.companyName} <span className="text-xs text-slate-400">{c.clientCode}</span></button></li>
                ))}
              </ul>
            )}
          </>
        )}
      </Field>
      {client && (
        <Field label="Machine" hint={units.data && units.data.length === 0 ? 'This client has no machines on record' : undefined}>
          <Select defaultValue="" onChange={(e) => onChange({ clientId: client.id, siteProductId: e.target.value, clientName: client.companyName })}>
            <option value="">— select machine —</option>
            {units.data?.map((u: any) => (
              <option key={u.id} value={u.id}>{u.site.siteName} · {u.model?.name || u.rawModel || 'Unknown model'} · {u.serialNumber || 'no serial'}</option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}

export function EngineerPicker({ date, value, onChange, label = 'Primary engineer', jobId, serviceRequestId, siteProductId, clientSiteId, skip }: {
  date?: string; value: string; onChange(id: string): void; label?: string; jobId?: string; serviceRequestId?: string; siteProductId?: string; clientSiteId?: string; skip?: string;
}) {
  const { data } = useFetch<any[]>(`/jobs/suggest-engineers${qs({ date, jobId, serviceRequestId, siteProductId, clientSiteId })}`);
  const list = (data || []).filter((e) => e.engineerId !== skip);
  const zone = list.find((e) => e.targetZone)?.targetZone as string | undefined;
  const mine = list.filter((e) => e.inZone); const others = list.filter((e) => !e.inZone);
  const opt = (e: any) => <option key={e.engineerId} value={e.engineerId}>{e.name}{e.zone && !e.inZone ? ` (${e.zone})` : ''} · {e.jobsThatDay} job{e.jobsThatDay === 1 ? '' : 's'}{e.checkedIn ? ' · in' : ''}</option>;
  return (
    <Field label={label} hint={zone ? `Engineers of ${zone} are listed first, then the others. Within each group: checked-in first, then lightest workload. Engineers on leave are not listed.` : 'Sorted by availability: checked-in first, then lightest workload. Engineers on leave are not listed.'}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— unassigned —</option>
        {zone ? (
          <>
            <optgroup label={`In ${zone} (${mine.length})`}>{mine.map(opt)}</optgroup>
            <optgroup label={`Other branches (${others.length})`}>{others.map(opt)}</optgroup>
          </>
        ) : list.map(opt)}
      </Select>
    </Field>
  );
}

export const statusTone = (code: string) =>
  (({ open: 'amber', assigned: 'blue', in_progress: 'blue', rescheduled: 'amber', on_hold: 'slate', pending_review: 'amber', completed: 'green', closed: 'green', cancelled: 'slate' }) as Record<string, any>)[code] || 'slate';

export const priorityTone = (code: string) =>
  (({ low: 'slate', medium: 'blue', high: 'amber', critical: 'red' }) as Record<string, any>)[code] || 'slate';

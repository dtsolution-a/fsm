'use client';
import { useState } from 'react';
import { Badge, Card, ErrorNote, Input, PageHeader, Pagination, Spinner, Stat, Table, Td } from '@/components/ui';
import { fmtDateTime, todayIST } from '@/lib/api';
import { useFetch, usePaged } from '@/lib/hooks';

const label: Record<string, [string, any]> = {
  checked_in: ['Checked in', 'green'], late: ['Late', 'amber'], not_checked_in: ['Not checked in', 'red'], on_leave: ['On leave', 'blue'],
};

export default function Attendance() {
  const [date, setDate] = useState(todayIST());
  const { data, loading, error } = useFetch<any>(`/attendance?date=${date}`);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const rows = (data?.rows || []).filter((r: any) => (!filter || r.status === filter) && (!needle || `${r.name} ${r.userCode} ${r.zone || ''}`.toLowerCase().includes(needle)));
  const pg = usePaged(rows, 25);
  const s = data?.summary;

  return (
    <>
      <PageHeader title="Attendance" subtitle="Daily check-in console. Backdated entries are blocked at the server and reported to the GA Head."
        actions={<Input type="date" className="w-44" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />} />
      {error && <ErrorNote message={error} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Total staff" value={s.total} />
            <Stat label="Checked in" value={s.checked_in || 0} tone="green" />
            <Stat label="Late" value={s.late || 0} tone="amber" />
            <Stat label="On leave" value={s.on_leave || 0} />
            <Stat label="Not checked in" value={s.not_checked_in || 0} tone={s.not_checked_in ? 'red' : undefined} />
          </div>
          <Card actions={
            <div className="flex gap-2">
              <Input className="w-56" placeholder="Search name, ID or branch…" value={search} onChange={(e) => { setSearch(e.target.value); pg.reset(); }} />
              <select className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm" value={filter} onChange={(e) => { setFilter(e.target.value); pg.reset(); }}>
                <option value="">All</option>{Object.entries(label).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>}>
            <Table head={['Engineer', 'Zone', 'Status', 'Check-in', 'Check-out', 'Times in', 'Worked']} empty={rows.length === 0}>
              {pg.rows.map((r: any) => (
                <tr key={r.engineerId}>
                  <Td className="font-medium text-slate-800">{r.name}<div className="text-xs font-normal text-slate-400">{r.userCode}</div></Td>
                  <Td>{r.zone || '—'}</Td>
                  <Td><Badge tone={label[r.status][1]}>{label[r.status][0]}</Badge></Td>
                  <Td>{fmtDateTime(r.checkInAt)}</Td>
                  <Td>{r.onDuty ? <Badge tone="green">On duty</Badge> : fmtDateTime(r.checkOutAt)}</Td>
                  <Td>{r.sessions ? `${r.sessions}×` : '—'}</Td>
                  <Td>{r.workedMinutes ? `${Math.floor(r.workedMinutes / 60)}h ${String(r.workedMinutes % 60).padStart(2, '0')}m` : '—'}</Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={pg.meta} onPage={pg.setPage} onLimit={pg.setLimit} />
          </Card>
        </>
      )}
    </>
  );
}

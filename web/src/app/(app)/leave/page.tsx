'use client';
import { useState } from 'react';
import RowActions from '@/components/RowActions';
import { Badge, Button, Card, ErrorNote, Input, PageHeader, Pagination, Select, Spinner, Table, Td } from '@/components/ui';
import { fmtDate, patch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFetch, usePaged } from '@/lib/hooks';

const tone = { pending: 'amber', approved: 'green', rejected: 'red' } as const;

export default function Leave() {
  const { user } = useAuth();
  const [status, setStatus] = useState('pending');
  const { data, loading, error, reload } = useFetch<any[]>(`/leave-requests${status ? `?status=${status}` : ''}`);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const pg = usePaged((data || []).filter((l) => !needle || `${l.engineer.user.fullName} ${l.reason || ''}`.toLowerCase().includes(needle)), 25);
  const canDecide = user?.role === 'admin' || user?.role === 'ga_head';

  async function decide(id: string, what: 'approve' | 'reject') {
    setErr('');
    try { await patch(`/leave-requests/${id}/${what}`); reload(); } catch (e: any) { setErr(e.message); reload(); }
  }

  return (
    <>
      <PageHeader title="Leave requests" subtitle="Engineers apply from the mobile app. Backdated leave is rejected automatically."
        actions={<Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); pg.reset(); }}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></Select>} />
      {(error || err) && <ErrorNote message={error || err} />}
      <Card>
        <div className="mb-3"><Input className="max-w-xs" placeholder="Search engineer or reason…" value={search} onChange={(e) => { setSearch(e.target.value); pg.reset(); }} /></div>
        {loading && !data ? <Spinner /> : (<>
          <Table head={['Engineer', 'From', 'To', 'Reason', 'Status', '', 'Actions']} empty={pg.meta.total === 0}>
            {pg.rows.map((l) => (
              <tr key={l.id}>
                <Td className="font-medium text-slate-800">{l.engineer.user.fullName}</Td>
                <Td>{fmtDate(l.startDate)}</Td><Td>{fmtDate(l.endDate)}</Td>
                <Td className="max-w-xs text-slate-500">{l.reason || '—'}</Td>
                <Td><Badge tone={tone[l.status as keyof typeof tone]}>{l.status}</Badge></Td>
                <Td>{canDecide && l.status === 'pending' && <div className="flex gap-2"><Button onClick={() => decide(l.id, 'approve')}>Approve</Button><Button variant="danger" onClick={() => decide(l.id, 'reject')}>Reject</Button></div>}</Td>
                <Td className="text-right"><RowActions entity="leave-requests" id={l.id} onChanged={reload} /></Td>
              </tr>
            ))}
          </Table>
          <Pagination meta={pg.meta} onPage={pg.setPage} onLimit={pg.setLimit} />
        </>)}
      </Card>
    </>
  );
}

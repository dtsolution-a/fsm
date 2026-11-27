'use client';
import { useState } from 'react';
import { Badge, Card, ErrorNote, PageHeader, Pagination, Spinner, Table, Td } from '@/components/ui';
import { fmtDateTime, qs } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

const tone = (a: string) => (a === 'flag' ? 'red' : a === 'create' ? 'green' : a === 'login' ? 'slate' : 'blue') as any;

export default function Activity() {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useFetch<any>(`/activity-logs${qs({ page, limit: 40 })}`);
  return (
    <>
      <PageHeader title="Activity log" subtitle="Who changed what and when. Entries cannot be edited or deleted." />
      {error && <ErrorNote message={error} />}
      <Card>
        {loading && !data ? <Spinner /> : (
          <>
            <Table head={['When', 'Action', 'Record', 'Details']} empty={data?.data.length === 0}>
              {data?.data.map((l: any) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}</Td>
                  <Td><Badge tone={tone(l.action)}>{l.action}</Badge></Td>
                  <Td className="text-xs">{l.entityType}<div className="font-mono text-slate-400">{l.entityId.slice(0, 8)}</div></Td>
                  <Td className="max-w-md truncate text-xs text-slate-500">{l.afterState ? JSON.stringify(l.afterState).slice(0, 140) : ''}</Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={data?.meta} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

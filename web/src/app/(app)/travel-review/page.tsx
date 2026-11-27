'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Card, ErrorNote, PageHeader, Pagination, Spinner, Table, Td } from '@/components/ui';
import { ReviewButtons } from '@/components/TravelCards';
import { fmtDateTime, qs } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

const km = (v?: number | null) => (v == null ? '—' : `${v.toFixed(1)} km`);

export default function TravelReview() {
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const { data, loading, error, reload } = useFetch<any>(`/travel/review-queue${qs({ page, limit })}`);
  return (
    <>
      <PageHeader title="Travel claims to decide" subtitle="Trips where the engineer travelled more than the best route allows, or confirmed arrival without a matching scan. Until you decide, only the allowed distance is payable." />
      <Card>
        {error && <ErrorNote message={error} />}
        {loading && !data ? <Spinner /> : (
          <>
            <Table head={['Arrived', 'Engineer', 'Job', 'Expected', 'Actual', 'Extra', 'Reason given', 'Decision']} empty={data?.data.length === 0}>
              {data?.data.map((l: any) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(l.endedAt)}</Td>
                  <Td className="font-medium text-slate-800">{l.engineer}</Td>
                  <Td><Link className="font-medium text-indigo-700 hover:underline" href={`/jobs/${l.job.id}`}>{l.job.jobNumber}</Link><div className="text-xs text-slate-400">{l.job.client}</div></Td>
                  <Td className="tabular-nums">{km(l.expectedKm)}</Td><Td className="tabular-nums font-medium">{km(l.actualKm)}</Td>
                  <Td className={`tabular-nums ${l.excessKm > 0 ? 'font-semibold text-rose-600' : ''}`}>{l.excessKm > 0 ? `+${l.excessKm.toFixed(1)} km` : '—'}</Td>
                  <Td className="max-w-xs text-xs text-slate-700">{l.reason ? <>“{l.reason}”{l.reasonVoice && <span className="ml-1 text-slate-400">(spoken{l.reasonLang ? `, ${l.reasonLang}` : ''})</span>}</> : '—'}{l.arrivedBy === 'qr_override' && <div className="mt-1 text-amber-700">Arrival confirmed without a matching scan{l.arrivalDistanceM ? ` (${l.arrivalDistanceM} m away)` : ''}</div>}</Td>
                  <Td><ReviewButtons jobId={l.job.id} legId={l.id} onDone={reload} /></Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </Card>
    </>
  );
}

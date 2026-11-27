'use client';
import RowActions from '@/components/RowActions';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Spinner, Table, Td } from '@/components/ui';
import { post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

export default function SpareParts() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(30);
  const q = useDebounced(search);
  const { data, loading, error, reload } = useFetch<any>(`/spare-parts${qs({ search: q, category, page, limit, active: 'true' })}`);
  const [adding, setAdding] = useState(false);
  const cats = ['Breakdown Repair', 'Installation/Commissioning', 'Preventive Maintenance', 'Service', 'WARRANTY SERVICE'];

  return (
    <>
      <PageHeader title="Spare Parts" subtitle="Parts catalog imported from QuikAllot materials master"
        actions={user?.role === 'admin' && <Button onClick={() => setAdding(true)}>+ New part</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-sm" placeholder="Search part number or name…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <select className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">All job categories</option>{cats.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {error && <ErrorNote message={error} />}
        {loading && !data ? <Spinner /> : (
          <>
            <Table head={['Part no.', 'Name', 'HSN', 'Job category', 'For product', 'Actions']} empty={data?.data.length === 0}>
              {data?.data.map((p: any) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap font-mono text-xs">{p.partNumber}</Td>
                  <Td className="font-medium text-slate-800">{p.name}</Td>
                  <Td className="font-mono text-xs">{p.hsnCode || '—'}</Td>
                  <Td>{p.jobCategory ? <Badge>{p.jobCategory}</Badge> : '—'}</Td>
                  <Td className="text-xs">{p.rawProductName || '—'}</Td>
                  <Td className="text-right"><RowActions entity="spare-parts" id={p.id} onChanged={reload} /></Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </Card>
      <NewPart open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
    </>
  );
}

function NewPart({ open, onClose, onDone }: { open: boolean; onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ partNumber: '', name: '', hsnCode: '', jobCategory: '', unit: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post('/spare-parts', Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()))); setF({ partNumber: '', name: '', hsnCode: '', jobCategory: '', unit: '' }); onDone(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New spare part">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Part number *"><Input required value={f.partNumber} onChange={set('partNumber')} /></Field>
        <Field label="Name *"><Input required value={f.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HSN code" hint="Kept as text so leading zeros survive"><Input value={f.hsnCode} onChange={set('hsnCode')} /></Field>
          <Field label="Unit"><Input value={f.unit} onChange={set('unit')} placeholder="pcs, kg…" /></Field>
        </div>
        <Field label="Job category"><Input value={f.jobCategory} onChange={set('jobCategory')} /></Field>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Create</Button></div>
      </form>
    </Modal>
  );
}

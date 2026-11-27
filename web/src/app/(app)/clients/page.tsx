'use client';
import RowActions from '@/components/RowActions';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td } from '@/components/ui';
import { post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

export default function ClientsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const q = useDebounced(search);
  const { data, loading, error, reload } = useFetch<any>(`/clients${qs({ search: q, active, page, limit })}`);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader title="Clients & Sites" subtitle="One record per company, with every site underneath it"
        actions={user?.role === 'admin' && <Button onClick={() => setCreating(true)}>+ New client</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-xs" placeholder="Search company, code or site…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select className="w-40" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}>
            <option value="true">Active</option><option value="false">Inactive</option><option value="">All</option>
          </Select>
        </div>
        {error && <ErrorNote message={error} />}
        {loading && !data ? <Spinner /> : (
          <>
            <Table head={['Code', 'Company', 'Sites', 'Contracts', 'Contact', 'Status', 'Actions']} empty={data?.data.length === 0}>
              {data?.data.map((c: any) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap text-slate-500">{c.clientCode}</Td>
                  <Td><Link href={`/clients/${c.id}`} className="font-medium text-indigo-600 hover:underline">{c.companyName}</Link>{c.legalName && <div className="text-xs text-slate-400">{c.legalName}</div>}</Td>
                  <Td>{c._count.sites}</Td>
                  <Td>{c._count.contracts}</Td>
                  <Td className="text-xs">{c.phone || '—'}<div className="text-slate-400">{c.email}</div></Td>
                  <Td><Badge tone={c.isActive ? 'green' : 'slate'}>{c.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                  <Td className="text-right"><RowActions entity="clients" id={c.id} viewHref={`/clients/${c.id}`} onChanged={reload} /></Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </Card>
      <NewClient open={creating} onClose={() => setCreating(false)} onDone={(id) => { reload(); router.push(`/clients/${id}`); }} />
    </>
  );
}

function NewClient({ open, onClose, onDone }: { open: boolean; onClose(): void; onDone(id: string): void }) {
  const [f, setF] = useState({ companyName: '', legalName: '', contactPerson: '', phone: '', email: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body: any = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
      const c = await post('/clients', body);
      setF({ companyName: '', legalName: '', contactPerson: '', phone: '', email: '' });
      onClose(); onDone(c.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New client">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Company name *"><Input required value={f.companyName} onChange={set('companyName')} /></Field>
        <Field label="Legal / short name"><Input value={f.legalName} onChange={set('legalName')} /></Field>
        <Field label="Contact person"><Input value={f.contactPerson} onChange={set('contactPerson')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        </div>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create client'}</Button></div>
      </form>
    </Modal>
  );
}

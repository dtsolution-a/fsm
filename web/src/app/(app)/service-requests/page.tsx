'use client';
import RowActions from '@/components/RowActions';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import CreateJob from '@/components/CreateJob';
import { MachinePicker, priorityTone } from '@/components/pickers';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import AuthImage from '@/components/AuthImage';
import { fmtDateTime, post, postForm, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

export default function ServiceRequests() {
  const { user } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const q = useDebounced(search);
  const { data, loading, error, reload } = useFetch<any>(`/service-requests${qs({ status, search: q, page, limit })}`);
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState<any>(null);
  const [viewing, setViewing] = useState<any>(null);
  const canJob = user?.role === 'admin' || user?.role === 'ga_head';

  return (
    <>
      <PageHeader title="Service Requests" subtitle="Every request gets a ticket number automatically — from the QR code on the machine, phone, web or the mobile app"
        actions={<Button onClick={() => setAdding(true)}>+ Log request</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-xs" placeholder="Search ticket, client or issue…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option><option value="open">Open (no job yet)</option><option value="converted">Converted to job</option>
          </Select>
        </div>
        {error && <ErrorNote message={error} />}
        {loading && !data ? <Spinner /> : (
          <>
            <Table head={['Ticket', 'Received', 'Client / site', 'Machine', 'Issue', 'Priority', 'Channel', 'Job', '', 'Actions']} empty={data?.data.length === 0}>
              {data?.data.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap font-medium">{r.ticketNumber}</Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</Td>
                  <Td>{r.client.companyName}<div className="text-xs text-slate-400">{r.site?.siteName}{r.contactName ? ` · ${r.contactName} ${r.contactPhone || ''}` : ''}</div></Td>
                  <Td className="text-xs">{r.siteProduct?.model?.name || r.siteProduct?.rawModel || '—'}<div className="font-mono text-slate-400">{r.siteProduct?.serialNumber}</div></Td>
                  <Td className="max-w-xs text-xs">{r.issueDescription || '—'}{r.attachments?.length > 0 && <button className="mt-1 block text-indigo-600 hover:underline" onClick={() => setViewing(r)}>📷 {r.attachments.length} photo{r.attachments.length > 1 ? 's' : ''}</button>}</Td>
                  <Td><Badge tone={priorityTone(r.priority.code)}>{r.priority.label}</Badge></Td>
                  <Td className="text-xs capitalize">{r.sourceChannel.replace('_', ' ')}</Td>
                  <Td className="text-xs">{r.jobs[0] ? <button className="text-indigo-600 hover:underline" onClick={() => router.push(`/jobs/${r.jobs[0].id}`)}>{r.jobs[0].jobNumber}</button> : '—'}</Td>
                  <Td>{canJob && r.status === 'open' && <Button onClick={() => setConverting(r)}>Create job</Button>}</Td>
                  <Td className="text-right"><RowActions entity="requests" id={r.id} onChanged={reload} /></Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          </>
        )}
      </Card>
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={`Photos — ${viewing?.ticketNumber || ''}`}>
        <div className="flex flex-wrap gap-2">{viewing?.attachments.map((a: any) => <AuthImage key={a.id} path={`/service-requests/${viewing.id}/attachments/${a.id}`} label="Request photo" size={150} />)}</div>
      </Modal>
      <NewRequest open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
      <CreateJob open={!!converting} request={converting} onClose={() => setConverting(null)} onDone={(j) => router.push(`/jobs/${j.id}`)} />
    </>
  );
}

function NewRequest({ open, onClose, onDone }: { open: boolean; onClose(): void; onDone(): void }) {
  const [m, setM] = useState({ clientId: '', siteProductId: '', clientName: '' });
  const [issue, setIssue] = useState(''); const [prio, setPrio] = useState('medium'); const [channel, setChannel] = useState('phone');
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const created = await post('/service-requests', { clientId: m.clientId, siteProductId: m.siteProductId || undefined, issueDescription: issue, priorityCode: prio, sourceChannel: channel, contactName: name || undefined, contactPhone: phone || undefined });
      if (files.length) {
        const fd = new FormData(); files.forEach((f) => fd.append('images', f, f.name));
        try { await postForm(`/service-requests/${created.id}/attachments`, fd); } catch (e: any) { setErr(`Request saved, but photos failed: ${e.message}`); setBusy(false); setFiles([]); setIssue(''); return; }
      }
      setIssue(''); setName(''); setPhone(''); setFiles([]); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Log a service request" wide>
      <form onSubmit={submit} className="space-y-3">
        <MachinePicker onChange={setM} />
        <Field label="Issue"><Textarea rows={3} required value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="What is wrong with the machine?" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Priority"><Select value={prio} onChange={(e) => setPrio(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></Select></Field>
          <Field label="Received via"><Select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="phone">Phone call</option><option value="web">Web form</option><option value="whatsapp">WhatsApp</option><option value="portal">Customer portal</option></Select></Field>
          <Field label="Caller name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Caller phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
        <Field label={`Photos (optional, up to 5 — reduced to 150 KB each automatically)${files.length ? ` · ${files.length} selected` : ''}`}>
          <input type="file" accept="image/*" multiple className="text-sm" onChange={(e) => { const l = Array.from(e.target.files || []).slice(0, 5); setFiles(l); if ((e.target.files?.length || 0) > 5) setErr('Only the first 5 photos are kept.'); }} />
        </Field>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !m.clientId}>Register request</Button></div>
      </form>
    </Modal>
  );
}

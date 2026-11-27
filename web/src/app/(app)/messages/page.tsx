'use client';
import RowActions from '@/components/RowActions';
import { useState } from 'react';
import { CheckCircle2, CircleSlash, Mail, MessageCircle, Smartphone } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td } from '@/components/ui';
import { fmtDateTime, post, qs } from '@/lib/api';
import { useDebounced, useFetch } from '@/lib/hooks';

const tone = (s: string) => (({ sent: 'green', failed: 'red', not_configured: 'amber', queued: 'slate' }) as Record<string, any>)[s] || 'slate';
const label = (s: string) => ({ not_configured: 'not connected' } as Record<string, string>)[s] || s;

export default function Messages() {
  const [status, setStatus] = useState(''); const [channel, setChannel] = useState(''); const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const q = useDebounced(search);
  const st = useFetch<any>('/messages/status');
  const { data, loading, error, reload } = useFetch<any>(`/messages${qs({ status, channel, search: q, page, limit })}`);
  const [open, setOpen] = useState<any>(null); const [busy, setBusy] = useState(false);
  const Ch = ({ ok, name, icon: I }: { ok?: boolean; name: string; icon: any }) => (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'}`}>
      <I size={16} /> <span className="font-medium">{name}</span> {ok ? <CheckCircle2 size={15} className="ml-auto" /> : <><CircleSlash size={15} className="ml-auto text-slate-400" /><span className="text-xs text-slate-400">not connected</span></>}
    </div>
  );
  async function retry(id: string) { setBusy(true); try { await post(`/messages/${id}/retry`); reload(); setOpen(null); } finally { setBusy(false); } }

  return (
    <>
      <PageHeader title="Messages" subtitle="Everything sent (or waiting to be sent) to clients: confirmations, dispatch, completion, invoices, reminders" />
      <div className="mb-4 grid gap-3 sm:grid-cols-3"><Ch ok={st.data?.email} name="E-mail (SMTP)" icon={Mail} /><Ch ok={st.data?.whatsapp} name="WhatsApp gateway" icon={MessageCircle} /><Ch ok={st.data?.sms} name="SMS gateway" icon={Smartphone} /></div>
      {st.data && !(st.data.email && st.data.whatsapp && st.data.sms) && <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Channels marked “not connected” are saved here but not delivered. Once the client chooses a provider and its details are added to the server settings, use <b>Send again</b> on any message.</p>}
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-xs" placeholder="Search recipient or text…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="sent">Sent</option><option value="not_configured">Not connected</option><option value="failed">Failed</option></Select>
          <Select className="w-40" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}><option value="">All channels</option><option value="email">E-mail</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></Select>
        </div>
        {error && <ErrorNote message={error} />}
        {loading && !data ? <Spinner /> : <>
          <Table head={['When', 'Channel', 'To', 'Event', 'Subject / message', 'Status', 'Actions']} empty={data?.data.length === 0}>
            {data?.data.map((m: any) => (
              <tr key={m.id} className="cursor-pointer" onClick={() => setOpen(m)}>
                <Td className="whitespace-nowrap text-xs">{fmtDateTime(m.createdAt)}</Td><Td className="text-xs capitalize">{m.channel}</Td><Td className="text-xs">{m.toAddress}</Td>
                <Td className="text-xs">{m.eventCode.replace(/_/g, ' ')}</Td><Td className="max-w-sm truncate text-xs">{m.subject || m.body}</Td>
                <Td><Badge tone={tone(m.status)}>{label(m.status)}</Badge></Td>
                  <Td className="text-right"><RowActions entity="messages" id={m.id} canEdit={false} onChanged={reload} /></Td>
              </tr>
            ))}
          </Table>
          <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
        </>}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.subject || 'Message'} wide>
        {open && <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-4 text-slate-500"><span>To: <b className="text-slate-800">{open.toAddress}</b></span><span className="capitalize">Channel: {open.channel}</span><Badge tone={tone(open.status)}>{label(open.status)}</Badge></div>
          <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-[13px] text-slate-700">{open.body}</pre>
          {open.error && <p className="text-xs text-slate-500">{open.error}</p>}
          {open.status !== 'sent' && <div className="flex justify-end"><Button disabled={busy} onClick={() => retry(open.id)}>Send again</Button></div>}
        </div>}
      </Modal>
    </>
  );
}

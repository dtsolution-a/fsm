'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import RowActions from '@/components/RowActions';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Tabs, Td, Textarea } from '@/components/ui';
import { fmtDate, post, patch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFetch, usePaged } from '@/lib/hooks';

type Tab = 'sites' | 'units' | 'feedback';

export default function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const client = useFetch<any>(`/clients/${id}`);
  const sites = useFetch<any[]>(`/clients/${id}/sites`);
  const units = useFetch<any[]>(`/clients/${id}/products`);
  const fb = useFetch<any[]>(user?.role === 'admin' || user?.role === 'ga_head' ? `/clients/${id}/feedback` : null);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('sites');
  const [siteSearch, setSiteSearch] = useState(''); const [unitSearch, setUnitSearch] = useState('');
  const sn = siteSearch.trim().toLowerCase(); const un = unitSearch.trim().toLowerCase();
  const sitePg = usePaged((sites.data || []).filter((s) => !sn || `${s.siteName} ${s.address || ''} ${s.city || ''} ${s.zoneLabel || ''}`.toLowerCase().includes(sn)), 10);
  const unitPg = usePaged((units.data || []).filter((u) => !un || `${u.serialNumber || ''} ${u.rawModel || ''} ${u.rawProduct || ''} ${u.site.siteName} ${u.model?.name || ''}`.toLowerCase().includes(un)), 10);
  const [siteModal, setSiteModal] = useState<any | 'new' | null>(null);
  const [fbModal, setFbModal] = useState(false);
  const c = client.data;

  if (client.loading && !c) return <Spinner />;
  if (client.error) return <ErrorNote message={client.error} />;
  if (!c) return null;

  async function toggle() {
    await post(`/clients/${id}/${c.isActive ? 'deactivate' : 'activate'}`);
    client.reload();
  }

  return (
    <>
      <div className="mb-2 text-sm"><Link href="/clients" className="text-indigo-600 hover:underline">← Clients</Link></div>
      <PageHeader title={c.companyName} subtitle={`${c.clientCode}${c.legalName ? ' · ' + c.legalName : ''}`}
        actions={<>
          <Badge tone={c.isActive ? 'green' : 'slate'}>{c.isActive ? 'Active' : 'Inactive'}</Badge>
          {isAdmin && <Button variant={c.isActive ? 'danger' : 'secondary'} onClick={toggle}>{c.isActive ? 'Deactivate' : 'Reactivate'}</Button>}
          <RowActions entity="clients" id={id} canView={false} onChanged={() => client.reload()} onDeleted={() => router.replace('/clients')} />
        </>} />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Info label="Contact" value={c.contactPerson || '—'} />
        <Info label="Phone" value={c.phone || '—'} />
        <Info label="Email" value={c.email || '—'} />
      </div>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'sites', label: 'Sites', count: c._count.sites },
        { id: 'units', label: 'Machines & contracts', count: units.data?.length },
        { id: 'feedback', label: 'Feedback', count: fb.data?.length },
      ]} />

      {tab === 'sites' && (
        <Card actions={<div className="flex gap-2"><Input className="w-56" placeholder="Search site, city or branch…" value={siteSearch} onChange={(e) => { setSiteSearch(e.target.value); sitePg.reset(); }} />{isAdmin && <Button onClick={() => setSiteModal('new')}>+ Add site</Button>}</div>}>
          {sites.loading && !sites.data ? <Spinner /> : (<>
            <Table head={['Site', 'State', 'Branch', 'Machines', 'GPS', 'Actions']} empty={sitePg.meta.total === 0}>
              {sitePg.rows.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium text-slate-800">{s.siteName}{s.address && <div className="text-xs font-normal text-slate-400">{s.address}</div>}</Td>
                  <Td>{s.state || '—'}</Td>
                  <Td>{s.zone?.name || s.zoneLabel || '—'}</Td>
                  <Td>{s._count.siteProducts}</Td>
                  <Td>{s.latitude ? <Badge tone="green">Mapped</Badge> : <Badge>Not set</Badge>}</Td>
                  <Td className="text-right"><RowActions entity="sites" id={s.id} onChanged={() => { sites.reload(); client.reload(); }} /></Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={sitePg.meta} onPage={sitePg.setPage} onLimit={sitePg.setLimit} />
          </>)}
        </Card>
      )}

      {tab === 'units' && (
        <Card actions={<Input className="w-64" placeholder="Search serial, model or site…" value={unitSearch} onChange={(e) => { setUnitSearch(e.target.value); unitPg.reset(); }} />}>
          {units.loading && !units.data ? <Spinner /> : (<>
            <Table head={['Machine', 'Serial no.', 'Site', 'Contract', 'Ends', 'Visits left', '', 'Actions']} empty={unitPg.meta.total === 0}>
              {unitPg.rows.map((u) => {
                const k = u.contracts[0];
                const m = u.model;
                return (
                  <tr key={u.id}>
                    <Td className="text-slate-800">
                      {m ? `${m.variant.productType.brand.name} · ${m.variant.productType.name}` : u.rawProduct || '—'}
                      <div className="text-xs text-slate-400">{m ? `${m.variant.name} · ${m.name}` : `${u.rawSubProduct || ''} ${u.rawModel || ''}`.trim()}</div>
                    </Td>
                    <Td className="font-mono text-xs">{u.serialNumber || '—'}</Td>
                    <Td>{u.site.siteName}</Td>
                    <Td>{k ? <Badge tone="blue">{k.contractType.label}</Badge> : '—'}</Td>
                    <Td>{k ? fmtDate(k.endDate) : '—'}</Td>
                    <Td>{k ? Math.max(0, k.freeServicesTotal - k.freeServicesCompleted) : '—'}</Td>
                    <Td className="whitespace-nowrap text-xs"><Link className="font-medium text-indigo-600 hover:underline" href={`/machines/${u.id}`}>History</Link><span className="mx-1.5 text-slate-300">|</span><Link className="font-medium text-indigo-600 hover:underline" href={`/machines/${u.id}/qr`}>QR sticker</Link></Td>
                    <Td className="text-right"><RowActions entity="machines" id={u.id} onChanged={() => { units.reload(); sites.reload(); }} /></Td>
                  </tr>
                );
              })}
            </Table>
            <Pagination meta={unitPg.meta} onPage={unitPg.setPage} onLimit={unitPg.setLimit} />
          </>)}
        </Card>
      )}

      {tab === 'feedback' && (
        <Card actions={<Button onClick={() => setFbModal(true)}>+ Record feedback</Button>}>
          {fb.data?.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">No feedback recorded</p> : (
            <ul className="divide-y divide-slate-100">
              {fb.data?.map((f) => (
                <li key={f.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-500">{'★'.repeat(f.rating)}<span className="text-slate-300">{'★'.repeat(5 - f.rating)}</span></span>
                    {f.rating <= 2 && <Badge tone="red">GA Head alerted</Badge>}
                    <span className="text-xs text-slate-400">{fmtDate(f.createdAt)} · via {f.submittedVia}</span>
                  </div>
                  {f.comment && <p className="mt-1 text-sm text-slate-700">{f.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <SiteModal clientId={id} site={siteModal} onClose={() => setSiteModal(null)} onDone={() => { setSiteModal(null); sites.reload(); client.reload(); }} />
      <FeedbackModal clientId={id} open={fbModal} onClose={() => setFbModal(false)} onDone={() => { setFbModal(false); fb.reload(); }} />
    </>
  );
}

const Info = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-0.5 text-sm font-medium text-slate-800">{value}</div></div>
);

function SiteModal({ clientId, site, onClose, onDone }: { clientId: string; site: any | 'new' | null; onClose(): void; onDone(): void }) {
  const editing = site && site !== 'new' ? site : null;
  const empty = { siteName: '', address: '', state: '', city: '', pincode: '', latitude: '', longitude: '', siteContactName: '', siteContactPhone: '' };
  const [f, setF] = useState(empty); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState<any>(null);
  if (site !== lastKey) { setLastKey(site); setErr(''); setF(editing ? Object.fromEntries(Object.keys(empty).map((k) => [k, editing[k] == null ? '' : String(editing[k])])) as any : empty); }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body: any = {};
      for (const [k, v] of Object.entries(f)) { if (v.trim() === '') continue; body[k] = k === 'latitude' || k === 'longitude' ? Number(v) : v.trim(); }
      if (editing) await patch(`/clients/${clientId}/sites/${editing.id}`, body); else await post(`/clients/${clientId}/sites`, body);
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={!!site} onClose={onClose} title={editing ? 'Edit site' : 'Add site'} wide>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Site name *"><Input required value={f.siteName} onChange={set('siteName')} /></Field>
        <Field label="Address"><Textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="State"><Input value={f.state} onChange={set('state')} /></Field>
          <Field label="City"><Input value={f.city} onChange={set('city')} /></Field>
          <Field label="Pincode"><Input value={f.pincode} onChange={set('pincode')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" hint="e.g. 21.1702"><Input type="number" step="any" value={f.latitude} onChange={set('latitude')} /></Field>
          <Field label="Longitude" hint="e.g. 72.8311"><Input type="number" step="any" value={f.longitude} onChange={set('longitude')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Site contact"><Input value={f.siteContactName} onChange={set('siteContactName')} /></Field>
          <Field label="Site phone"><Input value={f.siteContactPhone} onChange={set('siteContactPhone')} /></Field>
        </div>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save site'}</Button></div>
      </form>
    </Modal>
  );
}

function FeedbackModal({ clientId, open, onClose, onDone }: { clientId: string; open: boolean; onClose(): void; onDone(): void }) {
  const [rating, setRating] = useState(5); const [comment, setComment] = useState(''); const [via, setVia] = useState('phone');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post(`/clients/${clientId}/feedback`, { rating, comment: comment || undefined, submittedVia: via }); setComment(''); setRating(5); onDone(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Record client feedback">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Rating" hint="2 stars or below notifies the GA Head immediately">
          <Select value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}</Select>
        </Field>
        <Field label="Received via"><Select value={via} onChange={(e) => setVia(e.target.value)}>{['phone', 'portal', 'sms_link', 'mobile_app', 'visit'].map((v) => <option key={v}>{v}</option>)}</Select></Field>
        <Field label="Comment"><Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

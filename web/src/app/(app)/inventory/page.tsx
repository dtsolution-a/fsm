'use client';
import Link from 'next/link';
import { useState } from 'react';
import RowActions from '@/components/RowActions';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Stat, Table, Tabs, Td, Textarea } from '@/components/ui';
import { fmtDateTime, patch, post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch, usePaged } from '@/lib/hooks';

type Tab = 'stock' | 'movements' | 'defective' | 'orders' | 'returns' | 'audits' | 'warehouses';

export default function Inventory() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('stock');
  const summary = useFetch<any>('/inventory/summary');
  const whs = useFetch<any[]>('/warehouses');
  const can = user?.role === 'admin' || user?.role === 'ga_head';
  const sum = (k: string) => (summary.data?.warehouses || []).reduce((a: number, w: any) => a + w[k], 0);
  return (
    <>
      <PageHeader title="Inventory & Warehouses" subtitle="Available, pending and defective stock are tracked separately — pending orders never disappear until received" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Available units" value={sum('available').toLocaleString()} sub={`${summary.data?.warehouses?.length ?? 0} warehouses with stock`} />
        <Stat label="Pending (on order)" value={sum('pending').toLocaleString()} tone={sum('pending') ? 'amber' : undefined} />
        <Stat label="Defective" value={sum('defective').toLocaleString()} tone={sum('defective') ? 'red' : undefined} />
        <Stat label="Low-stock lines" value={summary.data?.lowStockLines ?? '—'} tone={summary.data?.lowStockLines ? 'red' : undefined} sub="at or below reorder level" />
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'stock', label: 'Stock' }, { id: 'movements', label: 'Movement log' }, { id: 'defective', label: 'Defective' }, { id: 'orders', label: 'Purchase orders' }, { id: 'returns', label: 'To come back' }, { id: 'audits', label: 'Audits' }, { id: 'warehouses', label: 'Warehouses' }]} />
      {tab === 'stock' && <Stock whs={whs.data || []} can={can} onChanged={summary.reload} />}
      {tab === 'movements' && <Movements whs={whs.data || []} />}
      {tab === 'defective' && <Defective whs={whs.data || []} can={can} onChanged={summary.reload} />}
      {tab === 'orders' && <Orders whs={whs.data || []} can={can} onChanged={summary.reload} />}
      {tab === 'returns' && <Returns onChanged={summary.reload} />}
      {tab === 'warehouses' && <Warehouses whs={whs.data || []} onChanged={() => { whs.reload(); summary.reload(); }} />}
      {tab === 'audits' && <Audits whs={whs.data || []} can={can} onChanged={summary.reload} />}
    </>
  );
}

// Spares an engineer was given but did not use: they have to go back to the hub, and the hub confirms when they arrive
function Returns({ onChanged }: { onChanged(): void }) {
  const [status, setStatus] = useState('pending'); const [search, setSearch] = useState(''); const q = useDebounced(search);
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(25);
  const { data, loading, error, reload } = useFetch<any>(`/inventory/returns${qs({ status, search: q, page, limit })}`);
  const [err, setErr] = useState('');
  async function receive(id: string) { setErr(''); try { await post(`/inventory/returns/${id}/receive`); reload(); onChanged(); } catch (e: any) { setErr(e.message); } }
  return (
    <Card actions={<div className="flex gap-2"><Input className="w-56" placeholder="Search job, part or engineer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /><Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="pending">Still to come back</option><option value="done">Received back</option></Select></div>}>
      {(error || err) && <ErrorNote message={error || err} />}
      {loading && !data ? <Spinner /> : (
        <>
          <Table head={['Since', 'Job', 'Engineer', 'Part', 'Quantity', 'Hub', status === 'done' ? 'Received' : '']} empty={data?.data.length === 0}>
            {data?.data.map((r: any) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.since)}</Td>
                <Td><Link href={`/jobs/${r.job.id}`} className="font-medium text-indigo-700 hover:underline">{r.job.jobNumber}</Link><div className="text-xs text-slate-400">{r.job.client.companyName}</div></Td>
                <Td>{r.engineer.fullName}<div className="text-xs text-slate-400">{r.engineer.phone}</div></Td>
                <Td>{r.part.name}<div className="font-mono text-xs text-slate-400">{r.part.partNumber}</div></Td>
                <Td className="font-semibold tabular-nums">{r.quantity}</Td>
                <Td>{r.hub ? `${r.hub.name}${r.hub.city ? ` — ${r.hub.city}` : ''}` : <span className="text-slate-400">the hub it came from</span>}</Td>
                <Td className="text-right">{r.returnedAt ? <span className="text-xs text-slate-500">{fmtDateTime(r.returnedAt)}</span> : <Button onClick={() => receive(r.id)}>Received back</Button>}</Td>
              </tr>
            ))}
          </Table>
          <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
        </>
      )}
    </Card>
  );
}

function Warehouses({ whs, onChanged }: { whs: any[]; onChanged(): void }) {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const pg = usePaged(whs.filter((w) => !needle || `${w.name} ${w.city || ''} ${w.state || ''} ${w.type || ''}`.toLowerCase().includes(needle)), 10);
  return (
    <Card actions={<Input className="w-60" placeholder="Search warehouse or city…" value={search} onChange={(e) => { setSearch(e.target.value); pg.reset(); }} />}>
      <Table head={['Warehouse', 'Type', 'City', 'State', 'Actions']} empty={pg.meta.total === 0}>
        {pg.rows.map((w) => (
          <tr key={w.id}>
            <Td className="font-medium text-slate-800">{w.name}</Td><Td>{w.type || '—'}</Td><Td>{w.city || '—'}</Td><Td>{w.state || '—'}</Td>
            <Td className="text-right"><RowActions entity="warehouses" id={w.id} onChanged={onChanged} /></Td>
          </tr>
        ))}
      </Table>
      <Pagination meta={pg.meta} onPage={pg.setPage} onLimit={pg.setLimit} />
    </Card>
  );
}

function PartPick({ value, onChange }: { value: any; onChange(p: any): void }) {
  const [s, setS] = useState(''); const q = useDebounced(s);
  const r = useFetch<any>(q.length >= 2 ? `/spare-parts${qs({ search: q, limit: 8, active: 'true' })}` : null);
  if (value) return <div className="flex justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm"><span>{value.name} <span className="font-mono text-xs text-slate-400">{value.partNumber}</span></span><button type="button" className="text-xs text-indigo-600" onClick={() => onChange(null)}>Change</button></div>;
  return <><Input placeholder="Search part number or name…" value={s} onChange={(e) => setS(e.target.value)} />
    {r.data?.data?.length > 0 && <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm shadow-sm">{r.data.data.map((p: any) => <li key={p.id}><button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50" onClick={() => onChange(p)}>{p.name} <span className="font-mono text-xs text-slate-400">{p.partNumber}</span></button></li>)}</ul>}</>;
}
const WhSelect = ({ whs, value, onChange, label = 'Warehouse' }: any) => <Field label={label}><Select value={value} onChange={(e) => onChange(e.target.value)}><option value="">— select —</option>{whs.filter((w: any) => w.isActive).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>;

function useSubmit(done: () => void) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(''); try { await fn(); done(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return { err, busy, run, setErr };
}

// ───────── Stock ─────────
function Stock({ whs, can, onChanged }: { whs: any[]; can: boolean; onChanged(): void }) {
  const [limit, setLimit] = useState(25);
  const [wh, setWh] = useState(''); const [low, setLow] = useState(false); const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, loading, error, reload } = useFetch<any>(`/inventory/stock${qs({ warehouseId: wh, low: low ? 'true' : '', search: q, page, limit })}`);
  const [modal, setModal] = useState<'' | 'in' | 'out' | 'transfer'>('');
  const done = () => { setModal(''); reload(); onChanged(); };
  return (
    <Card actions={can && <><Button onClick={() => setModal('in')}>+ Stock in</Button><Button variant="secondary" onClick={() => setModal('out')}>Issue stock</Button><Button variant="secondary" onClick={() => setModal('transfer')}>Transfer</Button></>}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search part…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Select className="w-52" value={wh} onChange={(e) => { setWh(e.target.value); setPage(1); }}><option value="">All warehouses</option>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={low} onChange={(e) => { setLow(e.target.checked); setPage(1); }} /> Low stock only</label>
      </div>
      {error && <ErrorNote message={error} />}
      {loading && !data ? <Spinner /> : <>
        <Table head={['Part', 'Warehouse', 'Available', 'Pending', 'Defective', 'Reorder at', '']} empty={data?.data.length === 0}>
          {data?.data.map((s: any) => { const isLow = s.reorderThreshold > 0 && s.availableQty <= s.reorderThreshold; return (
            <tr key={s.id} className="hover:bg-slate-50">
              <Td>{s.sparePart.name}<div className="font-mono text-xs text-slate-400">{s.sparePart.partNumber}</div></Td>
              <Td className="text-xs">{s.warehouse.name}</Td>
              <Td className="font-semibold">{s.availableQty}</Td>
              <Td>{s.pendingQty > 0 ? <Badge tone="amber">{s.pendingQty} on order</Badge> : 0}</Td>
              <Td>{s.defectiveQty > 0 ? <Badge tone="red">{s.defectiveQty}</Badge> : 0}</Td>
              <Td>{s.reorderThreshold || '—'}</Td>
              <Td>{isLow && <Badge tone="red">Low stock</Badge>}</Td>
            </tr>); })}
        </Table>
        <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
      </>}
      <StockForm kind="in" open={modal === 'in'} whs={whs} onClose={() => setModal('')} onDone={done} />
      <StockForm kind="out" open={modal === 'out'} whs={whs} onClose={() => setModal('')} onDone={done} />
      <StockForm kind="transfer" open={modal === 'transfer'} whs={whs} onClose={() => setModal('')} onDone={done} />
    </Card>
  );
}

function StockForm({ kind, open, whs, onClose, onDone }: { kind: 'in' | 'out' | 'transfer'; open: boolean; whs: any[]; onClose(): void; onDone(): void }) {
  const [part, setPart] = useState<any>(null); const [wh, setWh] = useState(''); const [to, setTo] = useState('');
  const [qty, setQty] = useState(1); const [reason, setReason] = useState(''); const [thr, setThr] = useState('');
  const { err, busy, run } = useSubmit(() => { setPart(null); setQty(1); setReason(''); onDone(); });
  const title = kind === 'in' ? 'Receive stock' : kind === 'out' ? 'Issue stock' : 'Transfer between warehouses';
  const submit = (e: React.FormEvent) => { e.preventDefault(); run(() => kind === 'in'
    ? post('/inventory/stock-in', { warehouseId: wh, sparePartId: part.id, quantity: qty, reason: reason || undefined, reorderThreshold: thr === '' ? undefined : Number(thr) })
    : kind === 'out' ? post('/inventory/stock-out', { warehouseId: wh, sparePartId: part.id, quantity: qty, reason: reason || 'Issued' })
    : post('/inventory/transfer', { fromWarehouseId: wh, toWarehouseId: to, sparePartId: part.id, quantity: qty, reason: reason || undefined })); };
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Part"><PartPick value={part} onChange={setPart} /></Field>
        <WhSelect whs={whs} value={wh} onChange={setWh} label={kind === 'transfer' ? 'From warehouse' : 'Warehouse'} />
        {kind === 'transfer' && <WhSelect whs={whs.filter((w) => w.id !== wh)} value={to} onChange={setTo} label="To warehouse" />}
        <Field label="Quantity"><Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
        {kind === 'in' && <Field label="Reorder alert level (optional)" hint="You get a low-stock alert when available stock drops to this number"><Input type="number" min={0} value={thr} onChange={(e) => setThr(e.target.value)} /></Field>}
        <Field label={kind === 'out' ? 'Reason (e.g. issued to engineer)' : 'Note'}><Input required={kind === 'out'} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !part || !wh || (kind === 'transfer' && !to)}>Confirm</Button></div>
      </form>
    </Modal>
  );
}

// ───────── Movements ─────────
function Movements({ whs }: { whs: any[] }) {
  const [limit, setLimit] = useState(25);
  const [wh, setWh] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(1);
  const { data, loading, error } = useFetch<any>(`/inventory/movements${qs({ warehouseId: wh, from, to, page, limit })}`);
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select className="w-52" value={wh} onChange={(e) => { setWh(e.target.value); setPage(1); }}><option value="">All warehouses</option>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
      </div>
      {error && <ErrorNote message={error} />}
      {loading && !data ? <Spinner /> : <>
        <Table head={['When', 'Part', 'Warehouse', 'Type', 'Qty', 'Reason']} empty={data?.data.length === 0}>
          {data?.data.map((m: any) => <tr key={m.id}><Td className="whitespace-nowrap text-xs">{fmtDateTime(m.createdAt)}</Td><Td>{m.sparePart.name}<div className="font-mono text-xs text-slate-400">{m.sparePart.partNumber}</div></Td><Td className="text-xs">{m.warehouse.name}</Td><Td className="text-xs capitalize">{m.movementType.replace('_', ' ')}</Td><Td className={m.quantity < 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>{m.quantity > 0 ? '+' : ''}{m.quantity}</Td><Td className="text-xs">{m.reason || '—'}</Td></tr>)}
        </Table>
        <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
      </>}
    </Card>
  );
}

// ───────── Defective ─────────
function Defective({ whs, can, onChanged }: { whs: any[]; can: boolean; onChanged(): void }) {
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch<any>(`/inventory/defective${qs({ page, limit })}`);
  const [open, setOpen] = useState(false); const [part, setPart] = useState<any>(null); const [wh, setWh] = useState(''); const [qty, setQty] = useState(1); const [notes, setNotes] = useState('');
  const { err, busy, run } = useSubmit(() => { setOpen(false); setPart(null); reload(); onChanged(); });
  const set = async (id: string, status: string) => { try { await patch(`/inventory/defective/${id}`, { status }); reload(); onChanged(); } catch {} };
  const tone = (s: string) => (s === 'disposed' ? 'slate' : s === 'replacement_initiated' ? 'blue' : 'red') as any;
  return (
    <Card actions={can && <Button onClick={() => setOpen(true)}>+ Log defective item</Button>}>
      {error && <ErrorNote message={error} />}
      {loading && !data ? <Spinner /> : <>
        <Table head={['Logged', 'Part', 'Warehouse', 'Qty', 'Job', 'Notes', 'Status', '']} empty={data?.data.length === 0}>
          {data?.data.map((d: any) => <tr key={d.id}><Td className="whitespace-nowrap text-xs">{fmtDateTime(d.createdAt)}</Td><Td>{d.sparePart.name}<div className="font-mono text-xs text-slate-400">{d.sparePart.partNumber}</div></Td><Td className="text-xs">{d.warehouse.name}</Td><Td>{d.quantity}</Td><Td className="text-xs">{d.job?.jobNumber || '—'}</Td><Td className="max-w-[12rem] text-xs">{d.notes || '—'}</Td><Td><Badge tone={tone(d.status)}>{d.status.replace('_', ' ')}</Badge></Td>
            <Td>{can && d.status !== 'disposed' && <span className="flex gap-2 text-xs">{d.status === 'logged' && <button className="text-indigo-600 hover:underline" onClick={() => set(d.id, 'replacement_initiated')}>Replace</button>}<button className="text-rose-600 hover:underline" onClick={() => set(d.id, 'disposed')}>Dispose</button></span>}</Td></tr>)}
        </Table>
        <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
      </>}
      <Modal open={open} onClose={() => setOpen(false)} title="Log defective item">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => post('/inventory/defective', { warehouseId: wh, sparePartId: part.id, quantity: qty, notes: notes || undefined })); }}>
          <Field label="Part"><PartPick value={part} onChange={setPart} /></Field>
          <WhSelect whs={whs} value={wh} onChange={setWh} />
          <Field label="Quantity"><Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
          <Field label="What is wrong"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {err && <ErrorNote message={err} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || !part || !wh}>Log item</Button></div>
        </form>
      </Modal>
    </Card>
  );
}

// ───────── Purchase orders ─────────
function Orders({ whs, can, onChanged }: { whs: any[]; can: boolean; onChanged(): void }) {
  const [limit, setLimit] = useState(25);
  const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch<any>(`/purchase-orders${qs({ status, page, limit })}`);
  const [creating, setCreating] = useState(false); const [receiving, setReceiving] = useState<any>(null);
  const tone = (s: string) => (s === 'received' ? 'green' : s === 'in_transit' ? 'blue' : 'amber') as any;
  const done = () => { setCreating(false); setReceiving(null); reload(); onChanged(); };
  return (
    <Card actions={can && <Button onClick={() => setCreating(true)}>+ New purchase order</Button>}>
      <div className="mb-4"><Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All orders</option><option value="ordered">Ordered</option><option value="in_transit">In transit</option><option value="received">Received</option></Select></div>
      {error && <ErrorNote message={error} />}
      {loading && !data ? <Spinner /> : <>
        <Table head={['PO', 'Created', 'Warehouse', 'Items (received / ordered)', 'Status', '']} empty={data?.data.length === 0}>
          {data?.data.map((p: any) => <tr key={p.id}><Td className="whitespace-nowrap font-medium">{p.poNumber}</Td><Td className="whitespace-nowrap text-xs">{fmtDateTime(p.createdAt)}</Td><Td className="text-xs">{p.warehouse.name}</Td>
            <Td className="text-xs">{p.items.map((i: any) => <div key={i.id}>{i.sparePart.name}: <b>{i.quantityReceived}</b> / {i.quantityOrdered}</div>)}</Td>
            <Td><Badge tone={tone(p.status)}>{p.status.replace('_', ' ')}</Badge></Td>
            <Td>{can && p.status !== 'received' && <span className="flex gap-2 text-xs">{p.status === 'ordered' && <button className="text-slate-600 hover:underline" onClick={async () => { try { await post(`/purchase-orders/${p.id}/in-transit`); reload(); } catch {} }}>Mark in transit</button>}<button className="font-medium text-indigo-600 hover:underline" onClick={() => setReceiving(p)}>Receive</button></span>}</Td></tr>)}
        </Table>
        <Pagination meta={data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
      </>}
      <NewPo open={creating} whs={whs} onClose={() => setCreating(false)} onDone={done} />
      <Receive po={receiving} onClose={() => setReceiving(null)} onDone={done} />
    </Card>
  );
}

function NewPo({ open, whs, onClose, onDone }: { open: boolean; whs: any[]; onClose(): void; onDone(): void }) {
  const [wh, setWh] = useState(''); const [lines, setLines] = useState<{ part: any; qty: number }[]>([]); const [part, setPart] = useState<any>(null); const [qty, setQty] = useState(1);
  const { err, busy, run } = useSubmit(() => { setLines([]); onDone(); });
  return (
    <Modal open={open} onClose={onClose} title="New purchase order" wide>
      <div className="space-y-3">
        <WhSelect whs={whs} value={wh} onChange={setWh} label="Deliver to warehouse" />
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem_auto] sm:items-end">
            <Field label="Part"><PartPick value={part} onChange={setPart} /></Field>
            <Field label="Qty"><Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
            <Button type="button" variant="secondary" disabled={!part || qty < 1 || lines.some((l) => l.part.id === part?.id)} onClick={() => { setLines([...lines, { part, qty }]); setPart(null); setQty(1); }}>Add</Button>
          </div>
          {lines.length > 0 && <ul className="mt-3 divide-y divide-slate-100 text-sm">{lines.map((l, i) => <li key={i} className="flex justify-between py-1.5"><span>{l.part.name} <span className="font-mono text-xs text-slate-400">{l.part.partNumber}</span></span><span>{l.qty} <button className="ml-2 text-xs text-rose-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}>remove</button></span></li>)}</ul>}
        </div>
        <p className="text-xs text-slate-400">The ordered quantity shows as <b>pending</b> in that warehouse until you receive it.</p>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !wh || lines.length === 0} onClick={() => run(() => post('/purchase-orders', { warehouseId: wh, items: lines.map((l) => ({ sparePartId: l.part.id, quantity: l.qty })) }))}>Create order</Button></div>
      </div>
    </Modal>
  );
}

function Receive({ po, onClose, onDone }: { po: any; onClose(): void; onDone(): void }) {
  const [q, setQ] = useState<Record<string, number>>({});
  const { err, busy, run } = useSubmit(() => { setQ({}); onDone(); });
  if (!po) return null;
  const lines = Object.entries(q).filter(([, v]) => v > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
  return (
    <Modal open onClose={onClose} title={`Receive ${po.poNumber}`}>
      <div className="space-y-3">
        {po.items.map((i: any) => { const rem = i.quantityOrdered - i.quantityReceived; return (
          <div key={i.id} className="flex items-center justify-between gap-3 text-sm"><span>{i.sparePart.name}<div className="text-xs text-slate-400">{rem} still expected</div></span>
            <Input className="w-24" type="number" min={0} max={rem} disabled={rem === 0} value={q[i.id] ?? ''} placeholder="0" onChange={(e) => setQ({ ...q, [i.id]: Number(e.target.value) })} /></div>); })}
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || lines.length === 0} onClick={() => run(() => post(`/purchase-orders/${po.id}/receive`, { lines }))}>Receive into stock</Button></div>
      </div>
    </Modal>
  );
}

// ───────── Audits ─────────
function Audits({ whs, can, onChanged }: { whs: any[]; can: boolean; onChanged(): void }) {
  const { data, loading, error, reload } = useFetch<any[]>('/inventory/audits');
  const [open, setOpen] = useState(false); const [detail, setDetail] = useState<any>(null);
  return (
    <Card actions={can && <Button onClick={() => setOpen(true)}>+ New stock audit</Button>}>
      {error && <ErrorNote message={error} />}
      {loading && !data ? <Spinner /> : (
        <Table head={['Date', 'Warehouse', 'Lines counted', 'Discrepancies', 'Notes', '']} empty={data?.length === 0}>
          {data?.map((a) => <tr key={a.id}><Td className="whitespace-nowrap text-xs">{fmtDateTime(a.conductedAt)}</Td><Td>{a.warehouse}</Td><Td>{a.lines}</Td><Td>{a.discrepancies ? <Badge tone="red">{a.discrepancies} flagged</Badge> : <Badge tone="green">matched</Badge>}</Td><Td className="text-xs">{a.notes || '—'}</Td>
            <Td><button className="text-xs text-indigo-600 hover:underline" onClick={async () => { try { setDetail(await (await import('@/lib/api')).get(`/inventory/audits/${a.id}`)); } catch {} }}>View</button></Td></tr>)}
        </Table>
      )}
      <NewAudit open={open} whs={whs} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); onChanged(); }} />
      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Audit — ${detail?.warehouse?.name ?? ''}`} wide>
        <Table head={['Part', 'System', 'Counted', 'Difference']}>
          {detail?.items.map((i: any) => <tr key={i.id}><Td>{i.sparePart.name}</Td><Td>{i.systemCount}</Td><Td>{i.physicalCount}</Td><Td className={i.discrepancy ? 'font-semibold text-rose-600' : ''}>{i.discrepancy > 0 ? '+' : ''}{i.discrepancy}</Td></tr>)}
        </Table>
      </Modal>
    </Card>
  );
}

function NewAudit({ open, whs, onClose, onDone }: { open: boolean; whs: any[]; onClose(): void; onDone(): void }) {
  const [wh, setWh] = useState(''); const [lines, setLines] = useState<{ part: any; count: number }[]>([]); const [part, setPart] = useState<any>(null); const [count, setCount] = useState(0);
  const [apply, setApply] = useState(false); const [notes, setNotes] = useState('');
  const { err, busy, run } = useSubmit(() => { setLines([]); onDone(); });
  return (
    <Modal open={open} onClose={onClose} title="New stock audit" wide>
      <div className="space-y-3">
        <WhSelect whs={whs} value={wh} onChange={setWh} />
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
            <Field label="Part counted"><PartPick value={part} onChange={setPart} /></Field>
            <Field label="Physical count"><Input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} /></Field>
            <Button type="button" variant="secondary" disabled={!part || lines.some((l) => l.part.id === part?.id)} onClick={() => { setLines([...lines, { part, count }]); setPart(null); setCount(0); }}>Add</Button>
          </div>
          {lines.length > 0 && <ul className="mt-3 divide-y divide-slate-100 text-sm">{lines.map((l, i) => <li key={i} className="flex justify-between py-1.5"><span>{l.part.name}</span><span>{l.count} <button className="ml-2 text-xs text-rose-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}>remove</button></span></li>)}</ul>}
        </div>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> Correct system stock to the counted numbers (logged as audit adjustments)</label>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !wh || lines.length === 0} onClick={() => run(() => post('/inventory/audits', { warehouseId: wh, notes: notes || undefined, applyAdjustments: apply, items: lines.map((l) => ({ sparePartId: l.part.id, physicalCount: l.count })) }))}>Save audit</Button></div>
      </div>
    </Modal>
  );
}

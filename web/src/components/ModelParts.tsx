'use client';
import { useState } from 'react';
import { Badge, Button, ErrorNote, Input, Modal, Spinner } from '@/components/ui';
import { api, post, qs } from '@/lib/api';
import { useDebounced, useFetch } from '@/lib/hooks';

// Compatible spare parts for one model: see them, link another, unlink one.
export default function ModelParts({ model, canEdit, onClose }: { model: any | null; canEdit: boolean; onClose(): void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const linked = useFetch<any[]>(model ? `/catalog/models/${model.id}/parts` : null);
  const found = useFetch<any>(model && canEdit && q.trim().length >= 2 ? `/spare-parts${qs({ search: q.trim(), limit: 8, active: 'true' })}` : null);
  const [err, setErr] = useState('');

  const linkedIds = new Set(linked.data?.map((p) => p.id));

  async function link(partId: string) {
    setErr('');
    try { await post(`/catalog/models/${model.id}/parts`, { sparePartId: partId }); linked.reload(); } catch (e: any) { setErr(e.message); }
  }
  async function unlink(partId: string) {
    setErr('');
    try { await api('DELETE', `/catalog/models/${model.id}/parts/${partId}`); linked.reload(); } catch (e: any) { setErr(e.message); }
  }

  return (
    <Modal open={!!model} onClose={onClose} title={model ? `${model.name} — compatible spare parts` : ''} wide>
      {model && (
        <p className="mb-3 text-xs text-slate-500">
          {model.variant.productType.brand.name} · {model.variant.productType.name} · {model.variant.name}
        </p>
      )}
      {err && <ErrorNote message={err} />}
      {linked.loading && !linked.data ? <Spinner /> : linked.data?.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">No parts linked to this model yet.</p>
      ) : (
        <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {linked.data?.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div><span className="font-mono text-xs text-slate-500">{p.partNumber}</span><div className="text-slate-800">{p.name}</div></div>
              {canEdit && <button className="text-xs text-rose-600 hover:underline" onClick={() => unlink(p.id)}>Remove</button>}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-slate-600">Link another part</div>
          <Input placeholder="Search part number or name (2+ letters)…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {found.data?.data.length ? (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {found.data.data.map((p: any) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div><span className="font-mono text-xs text-slate-500">{p.partNumber}</span><div className="text-slate-800">{p.name}</div></div>
                  {linkedIds.has(p.id) ? <Badge tone="green">Linked</Badge> : <Button variant="secondary" onClick={() => link(p.id)}>Link</Button>}
                </li>
              ))}
            </ul>
          ) : q.trim().length >= 2 && !found.loading ? <p className="mt-2 text-xs text-slate-400">No matching parts</p> : null}
        </div>
      )}
    </Modal>
  );
}

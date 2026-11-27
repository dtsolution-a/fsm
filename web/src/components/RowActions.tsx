'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { Button, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from '@/components/ui';
import { ApiError, api, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * The same three actions on every list: View, Edit, Delete.
 *  - Edit opens a form built from what the server says may be changed on that record.
 *  - Delete only goes through when nothing depends on the record. Otherwise the person is told what blocks it and can
 *    "Deactivate instead", which hides the record from daily use but keeps its history.
 * `entity` is the record type the server knows (clients, sites, machines, contracts, requests, jobs, quotations, invoices,
 * engineers, users, spare-parts, warehouses, brands, types, variants, models, leave-requests, zones, messages).
 */
export default function RowActions({ entity, id, viewHref, onView, onChanged, onDeleted, canView = true, canEdit = true, canDelete = true }: {
  entity: string; id: string; viewHref?: string; onView?(): void; onChanged(): void; onDeleted?(): void; canView?: boolean; canEdit?: boolean; canDelete?: boolean;
}) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'' | 'view' | 'edit' | 'delete'>('');
  if (user?.role !== 'admin' && user?.role !== 'ga_head') {
    return viewHref ? <Link href={viewHref} className="text-xs text-indigo-600 hover:underline">View</Link> : onView ? <button className="text-xs text-indigo-600 hover:underline" onClick={onView}>View</button> : null;
  }
  const icon = 'rounded p-1.5 text-slate-400 hover:bg-slate-100';
  return (
    <>
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
        {canView && viewHref && <Link href={viewHref} title="View" aria-label="View" className={`${icon} hover:text-indigo-600`}><Eye size={16} /></Link>}
        {canView && !viewHref && <button title="View" aria-label="View" className={`${icon} hover:text-indigo-600`} onClick={onView ?? (() => setMode('view'))}><Eye size={16} /></button>}
        {canEdit && <button title="Edit" aria-label="Edit" className={`${icon} hover:text-indigo-600`} onClick={() => setMode('edit')}><Pencil size={16} /></button>}
        {canDelete && <button title="Delete" aria-label="Delete" className={`${icon} hover:bg-rose-50 hover:text-rose-600`} onClick={() => setMode('delete')}><Trash2 size={16} /></button>}
      </span>
      {mode === 'view' && <ViewDialog entity={entity} id={id} onClose={() => setMode('')} onEdit={canEdit ? () => setMode('edit') : undefined} />}
      {mode === 'edit' && <EditDialog entity={entity} id={id} onClose={() => setMode('')} onDone={() => { setMode(''); onChanged(); }} />}
      {mode === 'delete' && <DeleteDialog entity={entity} id={id} onClose={() => setMode('')} onDone={(deleted) => { setMode(''); (deleted && onDeleted ? onDeleted : onChanged)(); }} />}
    </>
  );
}

interface Described {
  label: string; title: string; fields: { key: string; label: string; type: string; required?: boolean; options?: { value: string; label: string }[] }[];
  values: Record<string, any>; canEdit: boolean; editNote: string | null; canDelete: boolean; deleteNote: string | null;
  blockers: { label: string; count: number }[]; canArchive: boolean; archived: boolean;
}

function useDescribe(entity: string, id: string) {
  const [d, setD] = useState<Described | null>(null); const [err, setErr] = useState('');
  const load = () => get<Described>(`/records/${entity}/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [entity, id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { d, err, reload: load };
}

function EditDialog({ entity, id, onClose, onDone }: { entity: string; id: string; onClose(): void; onDone(): void }) {
  const { d, err: loadErr } = useDescribe(entity, id);
  const [v, setV] = useState<Record<string, any>>({}); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (d) setV(d.values); }, [d]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const changed = Object.fromEntries(Object.entries(v).filter(([k, val]) => String(val ?? '') !== String(d!.values[k] ?? '')));
      if (!Object.keys(changed).length) { onClose(); return; }
      await patch(`/records/${entity}/${id}`, { values: changed }); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={d ? `Edit ${d.label}: ${d.title}` : 'Edit'} wide>
      {loadErr ? <ErrorNote message={loadErr} /> : !d ? <Spinner /> : !d.canEdit ? <p className="text-sm text-slate-600">{d.editNote}</p> : (
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {d.fields.map((f) => {
              const wide = f.type === 'textarea';
              const common = { value: v[f.key] ?? '', onChange: (e: React.ChangeEvent<any>) => setV({ ...v, [f.key]: e.target.value }) };
              return (
                <div key={f.key} className={wide ? 'sm:col-span-2' : ''}>
                  <Field label={`${f.label}${f.required ? ' *' : ''}`}>
                    {f.type === 'textarea' ? <Textarea rows={3} {...common} />
                      : f.type === 'zone' ? <Select {...common}><option value="">— none —</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                      : <Input {...common} required={f.required} type={f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'int' ? 'number' : f.type === 'email' ? 'email' : 'text'} step={f.type === 'number' ? 'any' : undefined} />}
                  </Field>
                </div>
              );
            })}
          </div>
          {err && <ErrorNote message={err} />}
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Save changes</Button></div>
        </form>
      )}
    </Modal>
  );
}

function DeleteDialog({ entity, id, onClose, onDone }: { entity: string; id: string; onClose(): void; onDone(deleted: boolean): void }) {
  const { d, err: loadErr, reload } = useDescribe(entity, id);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function del() {
    setBusy(true); setErr('');
    try { await api('DELETE', `/records/${entity}/${id}`); onDone(true); }
    catch (e: any) { setErr(e instanceof ApiError ? e.message : 'Could not delete'); reload(); } finally { setBusy(false); }
  }
  async function archive() {
    setBusy(true); setErr('');
    try { await post(`/records/${entity}/${id}/archive`); onDone(false); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={d ? `Delete ${d.label}` : 'Delete'}>
      {loadErr ? <ErrorNote message={loadErr} /> : !d ? <Spinner /> : (
        <div className="space-y-3 text-sm text-slate-700">
          <p className="font-medium text-slate-900">{d.title}</p>
          {d.canDelete ? (
            <p>This will permanently delete the {d.label}. <b>This cannot be undone.</b></p>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
              {d.deleteNote ? <p>{d.deleteNote}</p> : (
                <>
                  <p>This {d.label} cannot be deleted because other records depend on it:</p>
                  <ul className="mt-1 list-inside list-disc">{d.blockers.map((b) => <li key={b.label}>{b.count.toLocaleString()} {b.label}</li>)}</ul>
                </>
              )}
              {d.canArchive && <p className="mt-2">You can <b>deactivate</b> it instead: it disappears from daily use but its history stays.</p>}
              {d.archived && <p className="mt-2">It is already deactivated.</p>}
            </div>
          )}
          {err && <ErrorNote message={err} />}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>{d.canDelete ? 'Cancel' : 'Close'}</Button>
            {d.canArchive && <Button variant="secondary" disabled={busy} onClick={archive}>Deactivate instead</Button>}
            {d.canDelete && <Button variant="danger" disabled={busy} onClick={del}>Delete permanently</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

// read-only card of the record's own details (used when the list has no detail page to open)
function ViewDialog({ entity, id, onClose, onEdit }: { entity: string; id: string; onClose(): void; onEdit?(): void }) {
  const { d, err } = useDescribe(entity, id);
  const show = (f: Described['fields'][number], val: any) => (f.type === 'zone' ? f.options?.find((o) => o.value === val)?.label : val) || '—';
  return (
    <Modal open onClose={onClose} title={d ? `${d.label[0].toUpperCase()}${d.label.slice(1)}: ${d.title}` : 'Details'} wide>
      {err ? <ErrorNote message={err} /> : !d ? <Spinner /> : (
        <div className="space-y-3">
          {d.fields.length === 0 ? <p className="text-sm text-slate-600">{d.title}</p> : (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {d.fields.map((f) => <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}><dt className="text-xs font-semibold uppercase text-slate-500">{f.label}</dt><dd className="mt-0.5 whitespace-pre-wrap text-slate-800">{String(show(f, d.values[f.key]))}</dd></div>)}
            </dl>
          )}
          <div className="flex justify-end gap-2 pt-1"><Button variant="secondary" onClick={onClose}>Close</Button>{onEdit && <Button onClick={onEdit}>Edit</Button>}</div>
        </div>
      )}
    </Modal>
  );
}

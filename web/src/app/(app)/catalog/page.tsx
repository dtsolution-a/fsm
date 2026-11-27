'use client';
import RowActions from '@/components/RowActions';
import { useState } from 'react';
import ModelParts from '@/components/ModelParts';
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td } from '@/components/ui';
import { post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useFetch } from '@/lib/hooks';

export default function Catalog() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tree = useFetch<any[]>('/catalog/tree');
  const [brandId, setBrandId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); const [limit, setLimit] = useState(30);
  const q = useDebounced(search);
  const models = useFetch<any>(`/catalog/models${qs({ search: q, variantId, page, limit })}`);
  const [adding, setAdding] = useState<null | 'brand' | 'type' | 'variant' | 'model'>(null);
  const [partsFor, setPartsFor] = useState<any | null>(null);

  const brand = tree.data?.find((b) => b.id === brandId);

  const pickBrand = (id: string) => { setBrandId(id); setTypeId(''); setVariantId(''); setPage(1); };
  const pickType = (id: string) => { setTypeId(id); setVariantId(''); setPage(1); };

  return (
    <>
      <PageHeader title="Product Catalog" subtitle="Brand → Product type → Variant → Model. Each level is stored once and linked, so a rename updates everywhere."
        actions={isAdmin && <><Button variant="secondary" onClick={() => setAdding('brand')}>+ Brand</Button><Button variant="secondary" onClick={() => setAdding('type')}>+ Product type</Button><Button variant="secondary" onClick={() => setAdding('variant')}>+ Variant</Button><Button onClick={() => setAdding('model')}>+ Model</Button></>} />

      {tree.loading && !tree.data ? <Spinner /> : tree.error ? <ErrorNote message={tree.error} /> : (
        <div className="grid gap-4 lg:grid-cols-[16rem_16rem_1fr]">
          <Card title={`Brands (${tree.data?.length})`} className="max-h-[70vh] overflow-y-auto">
            <ul className="space-y-0.5">
              {tree.data?.map((b) => (
                <li key={b.id} className="flex items-center gap-1"><button onClick={() => pickBrand(b.id === brandId ? '' : b.id)} className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left text-sm ${b.id === brandId ? 'bg-indigo-50 font-medium text-indigo-700' : 'hover:bg-slate-50'}`}>{b.name}<span className="ml-1 text-xs text-slate-400">{b.productTypes.length}</span></button><RowActions entity="brands" id={b.id} canView={false} onChanged={tree.reload} /></li>
              ))}
            </ul>
          </Card>

          <Card title={brand ? `${brand.name} — products` : 'Products'} className="max-h-[70vh] overflow-y-auto">
            {!brand ? <p className="text-sm text-slate-400">Pick a brand</p> : (
              <ul className="space-y-1">
                {brand.productTypes.map((t: any) => (
                  <li key={t.id}>
                    <div className="flex items-center gap-1"><button onClick={() => pickType(t.id === typeId ? '' : t.id)} className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left text-sm ${t.id === typeId ? 'bg-indigo-50 font-medium text-indigo-700' : 'hover:bg-slate-50'}`}>{t.name}</button><RowActions entity="types" id={t.id} canView={false} onChanged={tree.reload} /></div>
                    {t.id === typeId && (
                      <ul className="ml-3 mt-1 space-y-0.5 border-l border-slate-200 pl-2">
                        {t.variants.map((v: any) => (
                          <li key={v.id} className="flex items-center gap-1"><button onClick={() => { setVariantId(v.id === variantId ? '' : v.id); setPage(1); }} className={`min-w-0 flex-1 rounded px-2 py-1 text-left text-xs ${v.id === variantId ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{v.name} <span className="opacity-70">({v._count.models})</span></button><RowActions entity="variants" id={v.id} canView={false} onChanged={tree.reload} /></li>
                        ))}
                        {t.variants.length === 0 && <li className="px-2 text-xs text-slate-400">No variants</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Models" actions={<Input className="w-56" placeholder="Search model number…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />}>
            {models.loading && !models.data ? <Spinner /> : (
              <>
                <Table head={['Model', 'Variant', 'Product', 'Brand', 'Actions']} empty={models.data?.data.length === 0}>
                  {models.data?.data.map((m: any) => (
                    <tr key={m.id}>
                      <Td className="font-medium text-slate-800"><button className="text-left text-indigo-600 hover:underline" onClick={() => setPartsFor(m)} title="Compatible spare parts">{m.name}</button></Td>
                      <Td>{m.variant.name}</Td>
                      <Td>{m.variant.productType.name}</Td>
                      <Td><Badge tone="blue">{m.variant.productType.brand.name}</Badge></Td>
                  <Td className="text-right"><RowActions entity="models" id={m.id} onChanged={models.reload} /></Td>
                    </tr>
                  ))}
                </Table>
                <Pagination meta={models.data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
              </>
            )}
          </Card>
        </div>
      )}
      <ModelParts model={partsFor} canEdit={isAdmin} onClose={() => setPartsFor(null)} />
      <AddModal kind={adding} tree={tree.data || []} defaults={{ brandId, typeId, variantId }} onClose={() => setAdding(null)} onDone={() => { setAdding(null); tree.reload(); models.reload(); }} />
    </>
  );
}

function AddModal({ kind, tree, defaults, onClose, onDone }: { kind: null | 'brand' | 'type' | 'variant' | 'model'; tree: any[]; defaults: { brandId: string; typeId: string; variantId: string }; onClose(): void; onDone(): void }) {
  const [name, setName] = useState(''); const [brandId, setBrandId] = useState(''); const [typeId, setTypeId] = useState(''); const [variantId, setVariantId] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [seen, setSeen] = useState<any>(null);
  if (kind !== seen) { setSeen(kind); setName(''); setErr(''); setBrandId(defaults.brandId || tree[0]?.id || ''); setTypeId(defaults.typeId); setVariantId(defaults.variantId); }
  const types = tree.find((b) => b.id === brandId)?.productTypes || [];
  const variants = types.find((t: any) => t.id === typeId)?.variants || [];
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (kind === 'brand') await post('/catalog/brands', { name });
      if (kind === 'type') await post('/catalog/types', { brandId, name });
      if (kind === 'variant') await post('/catalog/variants', { productTypeId: typeId, name });
      if (kind === 'model') await post('/catalog/models', { productVariantId: variantId, name });
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const label = { brand: 'brand', type: 'product type', variant: 'variant', model: 'model' }[kind || 'brand'];
  return (
    <Modal open={!!kind} onClose={onClose} title={`Add ${label}`}>
      <form onSubmit={submit} className="space-y-3">
        {kind !== 'brand' && <Field label="Brand"><Select value={brandId} onChange={(e) => { setBrandId(e.target.value); setTypeId(''); setVariantId(''); }}>{tree.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
        {(kind === 'variant' || kind === 'model') && <Field label="Product type"><Select required value={typeId} onChange={(e) => { setTypeId(e.target.value); setVariantId(''); }}><option value="">Select…</option>{types.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
        {kind === 'model' && <Field label="Variant"><Select required value={variantId} onChange={(e) => setVariantId(e.target.value)}><option value="">Select…</option>{variants.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>}
        <Field label={`${label[0].toUpperCase() + label.slice(1)} name *`}><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {err && <ErrorNote message={err} />}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Add</Button></div>
      </form>
    </Modal>
  );
}

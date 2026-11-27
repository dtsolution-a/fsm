'use client';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { fmtMoney } from '@/lib/api';

export interface Line { kind: 'service' | 'part' | 'labour' | 'other'; description: string; quantity: number; unitPrice: number; sparePartId?: string; note?: string }
export const emptyLine = (): Line => ({ kind: 'service', description: '', quantity: 1, unitPrice: 0 });
export const lineTotal = (l: Line) => Math.round((Number(l.quantity) * Number(l.unitPrice) + Number.EPSILON) * 100) / 100;

// Editable line items for quotations and invoices (rates are typed by the office; nothing is guessed)
export default function LineEditor({ lines, onChange, readOnly }: { lines: Line[]; onChange?(l: Line[]): void; readOnly?: boolean }) {
  const set = (i: number, patch: Partial<Line>) => onChange?.(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const subtotal = lines.reduce((a, l) => a + lineTotal(l), 0);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead><tr className="border-b border-slate-200 text-left text-[11.5px] uppercase tracking-wide text-slate-500">
            <th className="w-28 py-2 pr-2 font-semibold">Type</th><th className="py-2 pr-2 font-semibold">Description</th><th className="w-20 py-2 pr-2 font-semibold">Qty</th><th className="w-32 py-2 pr-2 font-semibold">Rate (₹)</th><th className="w-32 py-2 pr-2 text-right font-semibold">Amount</th>{!readOnly && <th className="w-8" />}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="py-2 pr-2">{readOnly ? <span className="capitalize text-slate-600">{l.kind}</span> : <Select value={l.kind} onChange={(e) => set(i, { kind: e.target.value as Line['kind'] })}><option value="service">Service</option><option value="part">Part</option><option value="labour">Labour</option><option value="other">Other</option></Select>}</td>
                <td className="py-2 pr-2">{readOnly ? <>{l.description}{l.note && <div className="text-xs text-slate-400">{l.note}</div>}</> : <><Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="What is being charged" />{l.note && <div className="mt-1 text-xs text-amber-700">{l.note}</div>}</>}</td>
                <td className="py-2 pr-2">{readOnly ? l.quantity : <Input type="number" min={0.01} step="any" value={l.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} />}</td>
                <td className="py-2 pr-2">{readOnly ? Number(l.unitPrice).toFixed(2) : <Input type="number" min={0} step="any" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: Number(e.target.value) })} />}</td>
                <td className="py-2 pr-2 text-right font-medium tabular-nums">{lineTotal(l).toFixed(2)}</td>
                {!readOnly && <td className="py-2 text-right"><button type="button" className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove line" onClick={() => onChange?.(lines.filter((_, j) => j !== i))}><Trash2 size={16} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between">
        {!readOnly ? <Button type="button" variant="secondary" onClick={() => onChange?.([...lines, emptyLine()])}><Plus size={15} /> Add line</Button> : <span />}
        <div className="text-sm text-slate-600">Subtotal <span className="ml-2 text-base font-semibold text-slate-900">{fmtMoney(subtotal)}</span></div>
      </div>
    </div>
  );
}

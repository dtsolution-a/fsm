'use client';
import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { X } from 'lucide-react';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-3xl text-[13.5px] text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-600">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const btn = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50',
  danger: 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 disabled:opacity-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
};
export function Button({ variant = 'primary', className, ...p }: ComponentProps<'button'> & { variant?: keyof typeof btn }) {
  return <button {...p} className={cx('inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed', btn[variant], className)} />;
}

const tone = {
  green: 'bg-emerald-50 text-emerald-800',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-rose-50 text-rose-800',
  blue: 'bg-indigo-50 text-indigo-800',
  slate: 'bg-slate-100 text-slate-700',
};
export function Badge({ tone: t = 'slate', children }: { tone?: keyof typeof tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold', tone[t])}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
const inputCls = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50';
const width = (c?: string) => (c && /(^|\s)(w-|max-w-|min-w-)/.test(c) ? '' : 'w-full');
export const Input = (p: ComponentProps<'input'>) => <input {...p} className={cx(inputCls, width(p.className), p.className)} />;
export const Select = (p: ComponentProps<'select'>) => <select {...p} className={cx(inputCls, width(p.className), p.className)} />;
export const Textarea = (p: ComponentProps<'textarea'>) => <textarea {...p} className={cx(inputCls, width(p.className), p.className)} />;

// The page keeps still while the rows scroll: the header row stays on top inside a scroll area of its own.
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="-mx-4 max-h-[calc(100vh-17rem)] min-h-[8rem] overflow-auto">
      <table className="w-full text-left text-[13.5px]">
        <thead>
          <tr className="text-[11.5px] uppercase tracking-wide text-slate-500">
            {head.map((h, i) => <th key={i} className="sticky top-0 z-10 whitespace-nowrap bg-slate-50 px-4 py-2.5 font-semibold shadow-[inset_0_1px_0_#e2e8f0,inset_0_-1px_0_#e2e8f0]">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/70">{children}</tbody>
      </table>
      {empty && <p className="py-12 text-center text-sm text-slate-400">Nothing to show</p>}
    </div>
  );
}
export const Td = ({ className, ...p }: ComponentProps<'td'>) => <td {...p} className={cx('px-4 py-3 align-top text-slate-700', className)} />;

const PAGE_SIZES = [10, 25, 50, 100];
export function Pagination({ meta, onPage, onLimit }: { meta?: { page: number; pages: number; total: number; limit: number }; onPage(p: number): void; onLimit?(n: number): void }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.total, meta.page * meta.limit);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[13px] text-slate-500">
      <span>Showing {from}–{to} of {meta.total.toLocaleString()}</span>
      <div className="flex flex-wrap items-center gap-2">
        {onLimit && meta.total > PAGE_SIZES[0] && (
          <label className="flex items-center gap-1.5 text-xs">Rows
            <select value={meta.limit} onChange={(e) => onLimit(Number(e.target.value))} className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs">
              {[...new Set([...PAGE_SIZES, meta.limit])].sort((x, y) => x - y).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <span className="text-xs">Page {meta.page} of {meta.pages}</span>
        <Button variant="secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</Button>
        <Button variant="secondary" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4 pt-16" onMouseDown={onClose}>
      <div className={cx('w-full rounded-lg bg-white shadow-2xl', wide ? 'max-w-2xl' : 'max-w-md')} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone: t }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'amber' | 'green' }) {
  const color = t === 'red' ? 'text-rose-700' : t === 'amber' ? 'text-amber-700' : t === 'green' ? 'text-emerald-700' : 'text-slate-900';
  const bar = t === 'red' ? 'bg-rose-500' : t === 'amber' ? 'bg-amber-500' : t === 'green' ? 'bg-emerald-500' : 'bg-indigo-600';
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4">
      <span className={cx('absolute inset-y-0 left-0 w-1', bar)} />
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('mt-1 text-[26px] font-semibold leading-tight tracking-tight', color)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export const Spinner = () => <div className="py-12 text-center text-sm text-slate-400">Loading…</div>;
export const ErrorNote = ({ message }: { message: string }) => <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{message}</div>;

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange(t: T): void }) {
  return (
    <div className="mb-4 flex gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px border-b-2 px-3.5 py-2.5 text-[13.5px] font-semibold', value === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

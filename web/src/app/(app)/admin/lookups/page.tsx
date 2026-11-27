'use client';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { post, put } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

const TYPES: [string, string, string][] = [
  ['job-types', 'Job types', 'Types of service work (Breakdown Repair, Installation, PM…)'],
  ['job-priorities', 'Priorities', 'Urgency levels for jobs'],
  ['job-statuses', 'Job statuses', 'Lifecycle states shown on the job board'],
  ['contract-types', 'Contract types', 'On Call, Warranty, AMC with / without spares…'],
  ['skill-categories', 'Engineer skills', 'Tags used to match engineers to jobs'],
];

export default function Lookups() {
  const [type, setType] = useState(TYPES[0][0]);
  const list = useFetch<any[]>(`/lookups/${type}`);
  const settings = useFetch<any>('/settings');
  const [label, setLabel] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post(`/lookups/${type}`, { code: label, label }); setLabel(''); list.reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function off(id: string) { await post(`/lookups/${type}/${id}/deactivate`); list.reload(); }

  return (
    <>
      <PageHeader title="Lists & Settings" subtitle="Add a new job type, priority or skill here and it is available everywhere immediately — no code change." />
      <div className="mb-4 flex flex-wrap gap-2">
        {TYPES.map(([id, name]) => (
          <button key={id} onClick={() => setType(id)} className={`rounded-full border px-3 py-1.5 text-sm ${type === id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>{name}</button>
        ))}
      </div>
      <Card title={TYPES.find((t) => t[0] === type)![1]}>
        <p className="mb-3 text-sm text-slate-500">{TYPES.find((t) => t[0] === type)![2]}</p>
        <form onSubmit={add} className="mb-4 flex items-end gap-3"><Field label="Add new"><Input className="w-72" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" /></Field><Button type="submit" disabled={busy}>Add</Button></form>
        {err && <ErrorNote message={err} />}
        {list.loading && !list.data ? <Spinner /> : (
          <Table head={['Name', 'Code', '']} empty={list.data?.length === 0}>
            {list.data?.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium text-slate-800">{r.label}{r.isTerminal && <span className="ml-2"><Badge>final state</Badge></span>}</Td>
                <Td className="font-mono text-xs text-slate-500">{r.code}</Td>
                <Td>{'isActive' in r && <button className="text-xs text-rose-600 hover:underline" onClick={() => off(r.id)}>Deactivate</button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="System settings" className="mt-4">
        {settings.data && Object.entries(settings.data).map(([k, v]) => <SettingRow key={k} k={k} v={v as any} onSaved={settings.reload} />)}
      </Card>
    </>
  );
}

function SettingRow({ k, v, onSaved }: { k: string; v: any; onSaved(): void }) {
  const [text, setText] = useState(JSON.stringify(v, null, 2)); const [err, setErr] = useState(''); const [ok, setOk] = useState(false);
  async function save() {
    setErr(''); setOk(false);
    try { await put(`/settings/${k}`, { value: JSON.parse(text) }); setOk(true); onSaved(); } catch (e: any) { setErr(e instanceof SyntaxError ? 'Not valid JSON' : e.message); }
  }
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1 flex items-center justify-between"><span className="font-mono text-xs text-slate-500">{k}</span><div className="flex items-center gap-2">{ok && <span className="text-xs text-emerald-600">Saved</span>}<Button variant="secondary" onClick={save}>Save</Button></div></div>
      <textarea className="h-24 w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      {err && <ErrorNote message={err} />}
    </div>
  );
}

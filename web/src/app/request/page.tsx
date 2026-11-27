'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Camera, CheckCircle2, Clock, Wrench, X } from 'lucide-react';
import { API } from '@/lib/api';

// Public page opened from the QR code on a machine. No login.
// Shows requests already open for this machine (with progress) and lets the person raise a new one, with photos.
export default function Page() { return <Suspense><Form /></Suspense>; }

const STEPS = ['Received', 'Engineer assigned', 'Working on it', 'Completed'];
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }) : '');
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');

function Form() {
  const machine = useSearchParams().get('machine') || '';
  const [info, setInfo] = useState<any>(null);
  const [open, setOpen] = useState<any[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'bad' | 'done'>('loading');
  const [ticket, setTicket] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ contactName: '', contactPhone: '', issueDescription: '', priorityCode: 'medium' });
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const loadOpen = useCallback(() => fetch(`${API}/public/machines/${machine}/requests`).then((r) => (r.ok ? r.json() : [])).then(setOpen).catch(() => {}), [machine]);

  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(machine)) { setState('bad'); return; }
    fetch(`${API}/public/machines/${machine}`).then(async (r) => { if (!r.ok) throw 0; setInfo(await r.json()); setState('ready'); }).catch(() => setState('bad'));
    loadOpen();
    const t = setInterval(loadOpen, 30000); // status refreshes by itself while the page stays open
    return () => clearInterval(t);
  }, [machine, loadOpen]);

  useEffect(() => { if (state === 'ready' && open.length === 0) setShowForm(true); }, [state, open.length]);

  function pick(files: FileList | null) {
    if (!files) return;
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (next.length >= 3) { setErr('You can attach up to 3 photos.'); break; }
      if (!file.type.startsWith('image/')) { setErr('Please choose photos only.'); continue; }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setPhotos(next);
  }
  const drop = (i: number) => { URL.revokeObjectURL(photos[i].url); setPhotos(photos.filter((_, j) => j !== i)); };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('siteProductId', machine);
      Object.entries(f).forEach(([k, v]) => fd.append(k, v));
      photos.forEach((p) => fd.append('images', p.file, p.file.name));
      const r = await fetch(`${API}/public/service-requests`, { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(Array.isArray(j.message) ? j.message.join(', ') : j.message || 'Could not submit');
      setTicket(j.ticketNumber); setState('done'); loadOpen();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100';
  const known = state === 'ready' || state === 'done';

  return (
    <main className="mx-auto min-h-screen max-w-md bg-slate-50 p-5">
      <div className="mb-5 text-center"><img src="/brand/shah-logo.png" alt="Shah Engineers & Consultants" className="mx-auto mb-3 h-12 w-auto" /><div className="text-xl font-bold text-slate-900">Service for your machine</div></div>
      {state === 'loading' && <p className="text-center text-sm text-slate-400">Loading…</p>}
      {state === 'bad' && <p className="rounded-lg bg-rose-50 p-4 text-center text-sm text-rose-700">This QR code is not valid. Please call our service desk.</p>}

      {known && info && (
        <div className="mb-4 rounded-lg bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200"><div className="font-medium text-slate-900">{info.model || 'Machine'}</div><div className="text-slate-500">{info.client} · {info.site}</div>{info.serialNumber && <div className="font-mono text-xs text-slate-400">Serial {info.serialNumber}</div>}</div>
      )}

      {state === 'done' && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="mx-auto text-emerald-600" size={40} strokeWidth={1.6} /><div className="mt-2 font-semibold text-emerald-800">Request registered</div><div className="mt-1 text-sm text-emerald-700">Your ticket number is</div><div className="mt-1 text-2xl font-bold tracking-wide text-emerald-900">{ticket}</div><p className="mt-3 text-sm text-emerald-700">Our team will contact you shortly. Scan the code again any time to see progress.</p></div>
      )}

      {known && open.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Requests for this machine ({open.length})</h2>
          <div className="space-y-3">
            {open.map((r) => (
              <div key={r.ticketNumber} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-start justify-between gap-2"><div className="font-semibold text-slate-900">{r.ticketNumber}</div><div className="text-xs text-slate-400">raised {day(r.raisedAt)}</div></div>
                {r.issue && <p className="mt-1 text-sm text-slate-600">{r.issue}</p>}
                <div className="mt-3 flex items-center gap-1">{STEPS.map((s, i) => <div key={s} className={`h-1.5 flex-1 rounded-full ${i < r.step ? (r.step === 4 ? 'bg-emerald-500' : 'bg-indigo-600') : 'bg-slate-200'}`} />)}</div>
                <div className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${r.step === 4 ? 'text-emerald-700' : 'text-indigo-800'}`}>{r.step === 4 ? <CheckCircle2 size={16} /> : r.step === 3 ? <Wrench size={16} /> : <Clock size={16} />}{r.status}</div>
                {r.scheduledFor && <div className="mt-0.5 text-xs text-slate-500">Visit planned: {when(r.scheduledFor)}</div>}
                {r.completedAt && <div className="mt-0.5 text-xs text-slate-500">Completed {when(r.completedAt)}</div>}
                {r.photos > 0 && <div className="mt-1 text-xs text-slate-400">{r.photos} photo{r.photos > 1 ? 's' : ''} attached</div>}
              </div>
            ))}
          </div>
          {!showForm && state === 'ready' && <button onClick={() => setShowForm(true)} className="mt-4 w-full rounded-lg border border-indigo-600 py-3 text-base font-semibold text-indigo-700 hover:bg-indigo-50">Raise another request</button>}
        </section>
      )}

      {state === 'ready' && showForm && (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">{open.length ? 'New request' : 'Tell us the problem'}</h2>
          <label className="block text-sm font-medium text-slate-700">Your name<input required minLength={2} className={input + ' mt-1'} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></label>
          <label className="block text-sm font-medium text-slate-700">Phone number<input required type="tel" inputMode="tel" className={input + ' mt-1'} value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></label>
          <label className="block text-sm font-medium text-slate-700">What is the problem?<textarea required minLength={5} rows={4} className={input + ' mt-1'} value={f.issueDescription} onChange={(e) => setF({ ...f, issueDescription: e.target.value })} /></label>
          <label className="block text-sm font-medium text-slate-700">How urgent?<select className={input + ' mt-1'} value={f.priorityCode} onChange={(e) => setF({ ...f, priorityCode: e.target.value })}><option value="low">Low — can wait</option><option value="medium">Medium</option><option value="high">High — machine affected</option><option value="critical">Critical — machine down</option></select></label>
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">Photos <span className="font-normal text-slate-400">(optional, up to 3)</span></div>
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={p.url} className="relative h-20 w-20"><img src={p.url} alt="" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" /><button type="button" onClick={() => drop(i)} aria-label="Remove photo" className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-800 p-0.5 text-white"><X size={14} /></button></div>
              ))}
              {photos.length < 3 && (
                <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-indigo-500 hover:text-indigo-600">
                  <Camera size={22} />Add<input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
                </label>
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">Photos are reduced in size automatically, so you can send them straight from your phone camera.</p>
          </div>
          {err && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{err}</p>}
          <button disabled={busy} className="w-full rounded-lg bg-indigo-600 py-3 text-base font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-300">{busy ? (photos.length ? 'Uploading photos…' : 'Submitting…') : 'Submit request'}</button>
        </form>
      )}
    </main>
  );
}

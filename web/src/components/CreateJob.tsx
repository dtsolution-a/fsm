'use client';
import { useState } from 'react';
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { EngineerPicker, MachinePicker } from '@/components/pickers';
import { post, todayIST } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

// One-click job creation from a service request, or a fresh job (04.2).
export default function CreateJob({ open, request, onClose, onDone }: { open: boolean; request?: any; onClose(): void; onDone(job: any): void }) {
  const types = useFetch<any[]>('/lookups/job-types');
  const prios = useFetch<any[]>('/lookups/job-priorities');
  const [m, setM] = useState({ clientId: '', siteProductId: '', clientName: '' });
  const [typeId, setTypeId] = useState(''); const [prioId, setPrioId] = useState('');
  const [date, setDate] = useState(todayIST()); const [time, setTime] = useState('10:00');
  const [desc, setDesc] = useState(''); const [eng, setEng] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<any>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body: any = {
        jobTypeId: typeId || undefined, priorityId: prioId || undefined, description: desc || undefined,
        scheduledStart: date ? new Date(`${date}T${time}:00+05:30`).toISOString() : undefined,
        primaryEngineerId: eng || undefined,
      };
      if (request) body.serviceRequestId = request.id; else { body.clientId = m.clientId; body.siteProductId = m.siteProductId || undefined; }
      const job = await post('/jobs', body);
      if (job.duplicateWarning) setWarn(job); else onDone(job);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={request ? `Create job from ${request.ticketNumber}` : 'New job'} wide>
      {warn ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Job <b>{warn.jobNumber}</b> was created, but it looks like a <b>duplicate of {warn.duplicateWarning.jobNumber}</b> ({warn.duplicateWarning.status}) — same client, site and machine. The GA Head has been alerted. You can merge or dismiss it from the job page.
          </div>
          <div className="flex justify-end"><Button onClick={() => onDone(warn)}>Open job</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {request ? (
            <div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{request.client.companyName}</b> — {request.issueDescription || 'No description'}</div>
          ) : <MachinePicker onChange={setM} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job type"><Select value={typeId} onChange={(e) => setTypeId(e.target.value)}><option value="">Breakdown Repair (default)</option>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
            <Field label="Priority"><Select value={prioId} onChange={(e) => setPrioId(e.target.value)}><option value="">{request ? request.priority.label + ' (from request)' : 'Medium (default)'}</option>{prios.data?.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
            <Field label="Scheduled date"><Input type="date" min={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          </div>
          <EngineerPicker date={date} value={eng} onChange={setEng} serviceRequestId={request?.id} siteProductId={request ? undefined : m.siteProductId || undefined} />
          <Field label="Work description"><Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={request?.issueDescription || 'What needs to be done'} /></Field>
          {err && <ErrorNote message={err} />}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || (!request && !m.clientId)}>{eng ? 'Create & dispatch' : 'Create job'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

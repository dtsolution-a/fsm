'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer } from 'lucide-react';
import { ErrorNote, Spinner } from '@/components/ui';
import { useFetch } from '@/lib/hooks';

// Printable sticker for a machine: scanning it opens the public "request service" page for that machine.
export default function MachineQr() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useFetch<any>(`/machines/${id}/history`);
  const [qr, setQr] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = `${window.location.origin}/request?machine=${id}`;
    setUrl(u);
    QRCode.toDataURL(u, { width: 480, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0F172A', light: '#FFFFFF' } }).then(setQr).catch(() => {});
  }, [id]);
  if (error) return <ErrorNote message={error} />;
  if (!data || !qr) return <Spinner />;
  const m = data.machine;
  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/jobs" className="text-sm text-indigo-600 hover:underline">← Back</Link>
        <button onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-indigo-600 px-4 text-[13.5px] font-medium text-white hover:bg-indigo-700"><Printer size={15} /> Print sticker</button>
      </div>
      <div className="rounded-xl border-2 border-indigo-900 bg-white p-8 text-center print:break-inside-avoid">
        <img src="/brand/shah-logo.png" alt="Shah Engineers & Consultants" className="mx-auto h-12 w-auto" />
        <div className="mt-5 text-xl font-bold text-slate-900">Need service?</div>
        <div className="text-sm text-slate-600">Scan this code to register a service request</div>
        <img src={qr} alt="QR code" className="mx-auto my-4 h-56 w-56" />
        <div className="text-base font-semibold text-slate-900">{m.model || 'Machine'}</div>
        <div className="text-sm text-slate-600">{m.client} · {m.site}</div>
        {m.serialNumber && <div className="mt-1 font-mono text-xs text-slate-500">Serial {m.serialNumber}</div>}
        <div className="mt-4 break-all text-[10px] text-slate-400">{url}</div>
      </div>
      <p className="mt-3 text-xs text-slate-400 print:hidden">The code points to this server's address ({url.split('/request')[0]}). Print final stickers only after the system is on its permanent web address.</p>
    </div>
  );
}

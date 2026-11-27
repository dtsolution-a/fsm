'use client';
import { useEffect, useState } from 'react';
import { API, session } from '@/lib/api';

// Image that needs the login token (stored photos are private). `path` is an API path such as /service-requests/:id/attachments/:attId
export default function AuthImage({ path, label, size = 112 }: { path: string; label: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null; let alive = true;
    fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${session.get()?.accessToken}` } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && alive) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [path]);
  const box = { width: size, height: size };
  return src
    ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={label} style={box} className="rounded-lg border border-slate-200 object-cover" /></a>
    : <div style={box} className="animate-pulse rounded-lg bg-slate-100" />;
}

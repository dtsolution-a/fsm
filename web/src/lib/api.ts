export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export type Role = 'admin' | 'ga_head' | 'supervisor' | 'engineer' | 'client';
export interface Me { id: string; name: string; role: Role; email: string | null; userCode: string | null }

const KEY = 'fsm.session';
interface Session { accessToken: string; refreshToken: string; user: Me }

export const session = {
  get(): Session | null {
    if (typeof window === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  },
  set(s: Session | null) {
    if (typeof window === 'undefined') return;
    if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
  },
};

// Branch picked in the header (admin / GA Head). Sent with every call so the server narrows the data to that branch.
export const branch = {
  get(): string | null { if (typeof window === 'undefined') return null; try { return localStorage.getItem('fsm.branch'); } catch { return null; } },
  set(id: string | null) { if (typeof window === 'undefined') return; try { if (id) localStorage.setItem('fsm.branch', id); else localStorage.removeItem('fsm.branch'); } catch {} },
};
const branchHeader = (): Record<string, string> => { const b = branch.get(); return b ? { 'X-Branch': b } : {}; };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const s = session.get();
  if (!s) return false;
  refreshing ||= (async () => {
    try {
      const r = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken }) });
      if (!r.ok) return false;
      session.set(await r.json());
      return true;
    } catch { return false; } finally { setTimeout(() => (refreshing = null), 0); }
  })();
  return refreshing;
}

export async function api<T = any>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const s = session.get();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}), ...branchHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && s && (await refresh())) return api<T>(method, path, body, false);
  if (res.status === 401 && s) { session.set(null); if (typeof window !== 'undefined') window.location.href = '/login'; }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message || res.statusText;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, String(v)));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const fmtMoney = (n?: number | string | null) => (n == null ? '—' : '₹ ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Authenticated file download (CSV exports): the API needs the login token, so a plain link will not work.
export async function download(path: string, filename: string) {
  const s = session.get();
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${s?.accessToken}`, ...branchHeader() } });
  if (!res.ok) throw new Error('Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// multipart upload (photos) with the login token; retries once after a token refresh like normal calls
export async function postForm<T = any>(path: string, form: FormData, retry = true): Promise<T> {
  const s = session.get();
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}), ...branchHeader() }, body: form });
  if (res.status === 401 && retry && s && (await refresh())) return postForm<T>(path, form, false);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, Array.isArray(data?.message) ? data.message.join(', ') : data?.message || res.statusText);
  return data as T;
}

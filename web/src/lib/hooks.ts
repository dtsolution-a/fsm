'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

// Fetch-on-mount/param-change with loading + error + manual reload. Ignores stale responses.
export function useFetch<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await get<T>(path);
      if (id === seq.current) { setData(d); setError(null); }
    } catch (e: any) {
      if (id === seq.current) setError(e.message || 'Failed to load');
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// For lists the server returns in one piece: show them a page at a time, with a rows-per-page choice.
export function usePaged<T>(rows: T[] | null | undefined, initial = 25) {
  const [page, setPage] = useState(1);
  const [limit, setLimitState] = useState(initial);
  const all = rows ?? [];
  const pages = Math.max(1, Math.ceil(all.length / limit));
  const cur = Math.min(page, pages);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const setLimit = (n: number) => { setLimitState(n); setPage(1); };
  return { rows: all.slice((cur - 1) * limit, cur * limit), meta: { page: cur, pages, total: all.length, limit }, setPage, setLimit, reset: () => setPage(1) };
}

'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Me, post, session } from './api';

interface Ctx { user: Me | null; ready: boolean; login(identifier: string, password: string): Promise<void>; logout(): Promise<void> }
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => { setUser(session.get()?.user ?? null); setReady(true); }, []);

  async function login(identifier: string, password: string) {
    const s = await post('/auth/login', { identifier, password });
    session.set(s);
    setUser(s.user);
    router.replace('/');
  }
  async function logout() {
    const s = session.get();
    if (s) { try { await post('/auth/logout', { refreshToken: s.refreshToken }); } catch {} }
    session.set(null);
    setUser(null);
    router.replace('/login');
  }
  return <AuthCtx.Provider value={{ user, ready, login, logout }}>{children}</AuthCtx.Provider>;
}

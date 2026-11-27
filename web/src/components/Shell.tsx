'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell, CalendarDays, CalendarRange, ClipboardList, Building2, FileText, Gauge, History, Inbox, LogOut,
  MapPin, Menu, Package, Plane, Settings2, UserCog, Users, Wrench, X, Boxes, FilePlus2, LineChart, Receipt, Wallet, TrendingUp, BarChart3, Mail, SlidersHorizontal, ShieldCheck, Map as MapIcon, CalendarCheck, PackageOpen, Route as RouteIcon, Tag, type LucideIcon,
} from 'lucide-react';
import { branch as branchStore, get, Role } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Item { href: string; label: string; roles: Role[]; icon: LucideIcon; module?: string }
const STAFF: Role[] = ['admin', 'ga_head', 'supervisor'];
const NAV: { group: string; items: Item[] }[] = [
  { group: 'Overview', items: [{ href: '/', label: 'Dashboard', roles: STAFF, icon: Gauge }] },
  { group: 'Operations', items: [
    { href: '/service-requests', label: 'Service Requests', roles: STAFF, icon: Inbox, module: 'requests' },
    { href: '/jobs', label: 'Jobs', roles: STAFF, icon: ClipboardList, module: 'jobs' },
    { href: '/dispatch', label: 'Dispatch Calendar', roles: STAFF, icon: CalendarRange, module: 'jobs' },
    { href: '/amc-schedule', label: 'AMC / CMC Schedule', roles: STAFF, icon: CalendarCheck, module: 'jobs' },
    { href: '/zone-map', label: 'Zone Map', roles: STAFF, icon: MapIcon, module: 'jobs' },
    { href: '/spare-requests', label: 'Spare Requests', roles: STAFF, icon: PackageOpen, module: 'inventory' },
  ] },
  { group: 'Customers', items: [
    { href: '/clients', label: 'Clients & Sites', roles: STAFF, icon: Building2, module: 'clients' },
    { href: '/contracts', label: 'AMC / Contracts', roles: STAFF, icon: FileText, module: 'clients' },
    { href: '/amc-reports', label: 'AMC Reports', roles: STAFF, icon: BarChart3, module: 'reports' },
    { href: '/reports', label: 'Reports', roles: ['admin', 'ga_head'], icon: LineChart, module: 'reports' },
  ] },
  { group: 'Billing', items: [
    { href: '/quotations', label: 'Quotations', roles: STAFF, icon: FilePlus2, module: 'billing' },
    { href: '/invoices', label: 'Invoices', roles: STAFF, icon: Receipt, module: 'billing' },
    { href: '/receivables', label: 'Receivables', roles: STAFF, icon: Wallet, module: 'billing' },
    { href: '/admin/prices', label: 'Price List & Travel Rules', roles: ['admin', 'ga_head'], icon: Tag, module: 'billing' },
    { href: '/finance', label: 'Financial Summary', roles: ['admin', 'ga_head'], icon: TrendingUp, module: 'billing' },
  ] },
  { group: 'Products & Stock', items: [
    { href: '/catalog', label: 'Product Catalog', roles: STAFF, icon: Boxes, module: 'catalog' },
    { href: '/spare-parts', label: 'Spare Parts', roles: STAFF, icon: Wrench, module: 'inventory' },
    { href: '/inventory', label: 'Inventory & Warehouses', roles: STAFF, icon: Package, module: 'inventory' },
  ] },
  { group: 'Workforce', items: [
    { href: '/engineers', label: 'Engineers', roles: STAFF, icon: Users, module: 'people' },
    { href: '/attendance', label: 'Attendance', roles: STAFF, icon: CalendarDays, module: 'people' },
    { href: '/leave', label: 'Leave', roles: STAFF, icon: Plane, module: 'people' },
    { href: '/live-map', label: 'Live Map', roles: STAFF, icon: MapPin, module: 'people' },
    { href: '/travel-review', label: 'Travel Claims', roles: STAFF, icon: RouteIcon, module: 'people' },
  ] },
  { group: 'Administration', items: [
    { href: '/admin/users', label: 'Users', roles: ['admin'], icon: UserCog },
    { href: '/admin/access', label: 'Access Control', roles: ['admin'], icon: ShieldCheck },
    { href: '/admin/lookups', label: 'Lists & Settings', roles: ['admin'], icon: Settings2 },
    { href: '/admin/billing', label: 'Billing Settings', roles: ['admin', 'ga_head'], icon: SlidersHorizontal },
    { href: '/messages', label: 'Messages', roles: ['admin', 'ga_head'], icon: Mail, module: 'messages' },
    { href: '/admin/activity', label: 'Activity Log', roles: ['admin'], icon: History },
  ] },
];

const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

export default function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const path = usePathname();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [picked, setPicked] = useState<string>('');
  useEffect(() => { setPicked(branchStore.get() || ''); }, []);
  // the branch list and menu rights; tried again on the next page change if the first try failed (slow start, network blip)
  useEffect(() => { if (!me) get('/access/me').then(setMe).catch(() => {}); }, [path, me]);

  useEffect(() => {
    let alive = true;
    const tick = () => get('/notifications?unread=true').then((n) => alive && setUnread(n.unread)).catch(() => {});
    tick();
    const t = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [path]);
  useEffect(() => setOpen(false), [path]);

  if (!user) return null;
  const isActive = (h: string) => (h === '/' ? path === '/' : path === h || path.startsWith(h + '/'));
  const current = NAV.flatMap((g) => g.items).find((i) => isActive(i.href));

  const sidebar = (
    <nav className="flex h-full flex-col bg-navy text-slate-300">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <img src="/brand/shah-mark.png" alt="Shah" className="h-10 w-10 rounded-full bg-white p-0.5" />
        <div className="leading-tight">
          <div className="text-[19px] font-bold tracking-wide text-white">कार्यसेतु</div>
          <div className="text-[11px] text-slate-400">Shah Engineers</div>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => i.roles.includes(user.role) && (!i.module || !me?.access || me.access[i.module] !== 'none'));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <div className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">{g.group}</div>
              <div className="space-y-0.5">
                {items.map((i) => {
                  const active = isActive(i.href);
                  const Icon = i.icon;
                  return (
                    <Link key={i.href} href={i.href}
                      className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors ${active ? 'bg-blue-500/15 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'}`}>
                      {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-indigo-300" />}
                      <Icon size={17} strokeWidth={1.8} className={active ? 'text-indigo-200' : 'text-slate-500 group-hover:text-slate-300'} />
                      {i.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/10 px-5 py-3 text-[11px] text-slate-500">Field Service Management</div>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block print:hidden">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/50" />
          <aside className="absolute inset-y-0 left-0 w-64" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-30 flex h-14 print:hidden items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <button className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">{open ? <X size={20} /> : <Menu size={20} />}</button>
            <div className="hidden text-sm text-slate-500 lg:block">{current ? <>Home <span className="mx-1.5 text-slate-300">/</span> <span className="font-medium text-slate-800">{current.label}</span></> : 'Home'}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href="/notifications" className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
              <Bell size={19} strokeWidth={1.8} />
              {unread > 0 && <span className="absolute right-0.5 top-0.5 min-w-[17px] rounded-full bg-rose-600 px-1 text-center text-[10px] font-semibold leading-[17px] text-white">{unread > 99 ? '99+' : unread}</span>}
            </Link>
            {me && (me.allBranches || me.branches.length > 1) ? (
              <select value={picked} onChange={(e) => { branchStore.set(e.target.value || null); setPicked(e.target.value); window.location.reload(); }} title="Branch"
                className="ml-1 max-w-[180px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700">
                <option value="">{me.allBranches ? 'All branches' : 'All my branches'}</option>
                {me.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : me?.branches?.length === 1 ? <span className="ml-1 hidden rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 sm:inline">{me.branches[0].name}</span> : null}
            <div className="mx-2 hidden h-6 w-px bg-slate-200 sm:block" />
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-xs font-semibold text-white">{initials(user.name)}</div>
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-[13px] font-medium text-slate-800">{user.name}</div>
                <div className="text-[11px] text-slate-500">{me?.designation || <span className="capitalize">{user.role.replace('_', ' ')}</span>}</div>
              </div>
            </div>
            <button onClick={logout} title="Sign out" aria-label="Sign out" className="ml-1 rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><LogOut size={18} strokeWidth={1.8} /></button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 sm:p-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}

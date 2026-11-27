import { Role } from '@prisma/client';
import type { AuthUser } from '../auth/jwt.strategy';

export type Level = 'none' | 'view' | 'manage';
const RANK: Record<Level, number> = { none: 0, view: 1, manage: 2 };

// Screens / areas whose access can be set. `prefixes` are the first part of the API path.
export const MODULES: { key: string; label: string; prefixes: string[] }[] = [
  { key: 'clients', label: 'Clients, sites, machines & contracts', prefixes: ['clients', 'contracts'] },
  { key: 'requests', label: 'Service requests', prefixes: ['service-requests'] },
  { key: 'jobs', label: 'Jobs, dispatch & machine history', prefixes: ['jobs', 'machines', 'map'] },
  { key: 'people', label: 'Engineers, attendance, leave & live map', prefixes: ['engineers', 'leave-requests', 'leave-calendar', 'attendance', 'live', 'travel'] },
  { key: 'inventory', label: 'Inventory, purchase orders & spare parts', prefixes: ['inventory', 'purchase-orders', 'spare-parts', 'warehouses', 'spare-requests'] },
  { key: 'catalog', label: 'Product catalog (brands, models)', prefixes: ['catalog'] },
  { key: 'billing', label: 'Quotations, invoices & payments', prefixes: ['quotations', 'invoices', 'payments', 'billing'] },
  { key: 'reports', label: 'Reports & AMC reports', prefixes: ['reports', 'amc'] },
  { key: 'messages', label: 'Customer messages', prefixes: ['messages'] },
  { key: 'admin', label: 'Users, settings & audit log', prefixes: ['users', 'settings', 'activity-logs', 'access'] },
];
const PREFIX_TO_MODULE = new Map(MODULES.flatMap((m) => m.prefixes.map((p) => [p, m.key] as const)));

// Starting levels. They mirror what each role could already do; the admin core team can tighten or widen them.
// (A role's endpoints still have their own fixed rules: a level cannot unlock something the endpoint refuses outright.)
export const ALL = MODULES.map((m) => m.key);
const make = (f: (k: string) => Level): Record<string, Level> => Object.fromEntries(ALL.map((k) => [k, f(k)]));
export const DEFAULT_LEVELS: Record<Role, Record<string, Level>> = {
  admin: make(() => 'manage'),
  ga_head: make((k) => (k === 'admin' ? 'view' : 'manage')),
  supervisor: make((k) => (k === 'admin' ? 'none' : 'manage')),
  engineer: make(() => 'none'), // engineers use the mobile app; their job actions are checked per job
  client: make(() => 'none'),
};

export const moduleOfPath = (path: string): string | null => {
  const segs = path.replace(/^\/+/, '').split('/');
  if (segs[0] === 'api') segs.splice(0, 2); // api/v1
  if (segs[0] === 'access' && segs[1] === 'me') return null;
  return PREFIX_TO_MODULE.get(segs[0]) ?? null;
};

export const hasLevel = (user: AuthUser, module: string, need: Exclude<Level, 'none'>) => {
  if (user.role === 'admin') return true;
  const have = (user.access?.[module] ?? 'manage') as Level; // no access map = internal call
  return RANK[have] >= RANK[need];
};


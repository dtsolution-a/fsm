import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';
import { Observable } from 'rxjs';
import { AuthUser } from '../auth/jwt.strategy';

/**
 * Branch scoping. Every signed-in request runs inside this store, so services can ask "which zones may this person see?"
 * without every method having to carry the user. No store (cron jobs, scripts, public pages) means no restriction.
 * zoneIds === null  -> every branch (admin, GA Head, or an admin who has not picked a branch)
 * zoneIds === [...] -> only those zones; sites without a zone are hidden from scoped users.
 */
export const requestUser = new AsyncLocalStorage<AuthUser>();

@Injectable()
export class ScopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest()?.user;
    if (!user) return next.handle();
    return new Observable((sub) => requestUser.run(user, () => { next.handle().subscribe(sub); }));
  }
}

export const zones = (): string[] | null => {
  const u = requestUser.getStore();
  return u && u.role !== 'engineer' && u.zoneIds ? u.zoneIds : null;
};
export const isScoped = () => zones() !== null;

const NONE: never[] = [];
export const siteScope = (): Prisma.ClientSiteWhereInput => { const z = zones(); return z ? { zoneId: { in: z } } : NONE as any; };
export const clientScope = (): Prisma.ClientWhereInput => { const z = zones(); return z ? { sites: { some: { zoneId: { in: z } } } } : {}; };
export const productScope = (): Prisma.SiteProductWhereInput => { const z = zones(); return z ? { site: { zoneId: { in: z } } } : {}; };
export const contractScope = (): Prisma.ContractWhereInput => {
  const z = zones();
  return z ? { OR: [{ siteProduct: { site: { zoneId: { in: z } } } }, { siteProductId: null, client: clientScope() }] } : {};
};
export const requestScope = (): Prisma.ServiceRequestWhereInput => {
  const z = zones();
  return z ? { OR: [{ site: { zoneId: { in: z } } }, { clientSiteId: null, client: clientScope() }] } : {};
};
export const jobZoneScope = (): Prisma.JobWhereInput => {
  const z = zones();
  return z ? { OR: [{ site: { zoneId: { in: z } } }, { clientSiteId: null, client: clientScope() }] } : {};
};
export const invoiceScope = (): Prisma.InvoiceWhereInput => {
  const z = zones();
  return z ? { OR: [{ job: jobZoneScope() }, { jobId: null, client: clientScope() }] } : {};
};
export const quotationScope = (): Prisma.QuotationWhereInput => (zones() ? { client: clientScope() } : {});
export const engineerScope = (): Prisma.EngineerWhereInput => {
  const z = zones();
  return z ? { OR: [{ primaryZoneId: { in: z } }, { zones: { some: { zoneId: { in: z } } } }] } : {};
};

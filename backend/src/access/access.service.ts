import { BadRequestException, Controller, Get, Global, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Put, Body } from '@nestjs/common';
import { IsIn, IsObject } from 'class-validator';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { AuditService } from '../common/audit.service';
import { ALL, DEFAULT_LEVELS, Level, MODULES } from './levels';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScopeInterceptor } from '../common/scope';

export { Level, MODULES, DEFAULT_LEVELS };

@Injectable()
export class AccessService {
  private cache = new Map<string, { at: number; zoneIds: string[] | null; access: Record<string, Level> }>();
  constructor(private prisma: PrismaService, private audit: AuditService) {}
  invalidate() { this.cache.clear(); }

  private async load(userId: string, role: Role) {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < 15_000) return hit;
    const [roleRows, userRows, zones] = await Promise.all([
      this.prisma.rolePermission.findMany({ where: { role } }),
      this.prisma.userPermission.findMany({ where: { userId } }),
      this.prisma.userZone.findMany({ where: { userId }, select: { zoneId: true } }),
    ]);
    const access: Record<string, Level> = { ...DEFAULT_LEVELS[role] };
    for (const r of roleRows) if (r.module in access) access[r.module] = r.level as Level;
    for (const r of userRows) if (r.module in access) access[r.module] = r.level as Level;
    if (role === 'admin') for (const k of ALL) access[k] = 'manage';
    // admin and GA Head see every branch; everyone else is held to the branch(es) they belong to
    const zoneIds = role === 'admin' || role === 'ga_head' || role === 'engineer' || role === 'client' ? null : zones.map((z) => z.zoneId);
    const v = { at: Date.now(), zoneIds, access };
    this.cache.set(userId, v);
    return v;
  }

  /** Called on every request by the JWT strategy: who is it, what may they open, which branches may they see. */
  async resolve(userId: string, tokenRole: Role, name: string, branchHeader?: string): Promise<AuthUser | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true } });
    if (!u || !u.isActive) return null;
    const v = await this.load(userId, u.role);
    let zoneIds = v.zoneIds;
    if (branchHeader && /^[0-9a-f-]{36}$/i.test(branchHeader)) {
      if (zoneIds === null) zoneIds = [branchHeader];
      else if (zoneIds.includes(branchHeader)) zoneIds = [branchHeader];
    }
    return { id: userId, role: u.role, name, zoneIds, access: v.access };
  }

  // ───── admin screens ─────
  async matrix() {
    const rows = await this.prisma.rolePermission.findMany();
    const roles: Record<string, Record<string, Level>> = {};
    for (const role of ['ga_head', 'supervisor', 'engineer', 'client'] as Role[]) {
      roles[role] = { ...DEFAULT_LEVELS[role] };
      for (const r of rows.filter((x) => x.role === role)) if (r.module in roles[role]) roles[role][r.module] = r.level as Level;
    }
    return { modules: MODULES.map(({ key, label }) => ({ key, label })), levels: ['none', 'view', 'manage'], roles, defaults: DEFAULT_LEVELS };
  }

  async setRole(actorId: string, role: Role, levels: Record<string, string>) {
    if (role === 'admin') throw new BadRequestException('Admin always has full access');
    for (const [module, level] of Object.entries(levels)) {
      if (!ALL.includes(module) || !['none', 'view', 'manage'].includes(level)) throw new BadRequestException(`Invalid access setting "${module}: ${level}"`);
    }
    await this.prisma.$transaction(Object.entries(levels).map(([module, level]) =>
      this.prisma.rolePermission.upsert({ where: { role_module: { role, module } }, update: { level }, create: { role, module, level } })));
    await this.audit.log(actorId, 'access', role, 'update', undefined, levels);
    this.invalidate();
    return this.matrix();
  }

  async userAccess(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, fullName: true, userCode: true, role: true, legacyGroup: true, isActive: true, zones: { select: { zone: true } } } });
    if (!u) throw new NotFoundException('User not found');
    const over = await this.prisma.userPermission.findMany({ where: { userId: id } });
    const base = (await this.matrix()).roles[u.role] ?? DEFAULT_LEVELS[u.role];
    return { user: { ...u, zones: u.zones.map((z) => z.zone) }, roleLevels: u.role === 'admin' ? DEFAULT_LEVELS.admin : base, overrides: Object.fromEntries(over.map((o) => [o.module, o.level])) };
  }

  async setUserOverrides(actorId: string, id: string, overrides: Record<string, string | null>) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { role: true, userCode: true } });
    if (!u) throw new NotFoundException('User not found');
    if (u.role === 'admin') throw new BadRequestException('An admin always has full access');
    for (const [module, level] of Object.entries(overrides)) {
      if (!ALL.includes(module) || (level !== null && !['none', 'view', 'manage'].includes(level))) throw new BadRequestException(`Invalid access setting "${module}: ${level}"`);
    }
    for (const [module, level] of Object.entries(overrides)) {
      if (level === null) await this.prisma.userPermission.deleteMany({ where: { userId: id, module } });
      else await this.prisma.userPermission.upsert({ where: { userId_module: { userId: id, module } }, update: { level }, create: { userId: id, module, level } });
    }
    await this.audit.log(actorId, 'access', id, 'update', undefined, overrides);
    this.invalidate();
    return this.userAccess(id);
  }

  async me(user: AuthUser) {
    // list the branches the person may choose from, not the one currently picked (user.zoneIds is already narrowed by X-Branch)
    const base = await this.load(user.id, user.role);
    const zones = await this.prisma.zone.findMany({ where: base.zoneIds ? { id: { in: base.zoneIds } } : {}, orderBy: { name: 'asc' } });
    const full = await this.prisma.user.findUnique({ where: { id: user.id }, select: { legacyGroup: true, userCode: true } });
    return { role: user.role, designation: full?.legacyGroup ?? null, access: user.access, allBranches: base.zoneIds === null, branches: zones, selected: user.zoneIds && (base.zoneIds === null || user.zoneIds.length < base.zoneIds.length) ? user.zoneIds[0] : null };
  }
}

class RoleLevelsDto { @IsObject() levels: Record<string, string>; }
class OverridesDto { @IsObject() overrides: Record<string, string | null>; }
class RoleParam { @IsIn(['ga_head', 'supervisor', 'engineer', 'client']) role: Role; }

@Controller('access')
export class AccessController {
  constructor(private svc: AccessService) {}
  @Get('me') @Auth() me(@CurrentUser() u: AuthUser) { return this.svc.me(u); }
  @Get('matrix') @Auth('admin') matrix() { return this.svc.matrix(); }
  @Put('roles/:role') @Auth('admin') setRole(@CurrentUser() u: AuthUser, @Param() p: RoleParam, @Body() d: RoleLevelsDto) { return this.svc.setRole(u.id, p.role, d.levels); }
  @Get('users/:id') @Auth('admin') user(@Param('id', ParseUUIDPipe) id: string) { return this.svc.userAccess(id); }
  @Put('users/:id') @Auth('admin') setUser(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: OverridesDto) { return this.svc.setUserOverrides(u.id, id, d.overrides); }
}

@Global()
@Module({ controllers: [AccessController], providers: [AccessService, { provide: APP_INTERCEPTOR, useClass: ScopeInterceptor }], exports: [AccessService] })
export class AccessModule {}

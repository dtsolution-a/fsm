import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  createParamDecorator,
  applyDecorators,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthUser } from './jwt.strategy';
import { hasLevel, moduleOfPath } from '../access/levels';

export const ROLES_KEY = 'roles';
export type RoleName = AuthUser['role'];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser = req.user;
    if (roles && roles.length > 0 && (!user || !roles.includes(user.role))) {
      throw new ForbiddenException('Your role cannot perform this action');
    }
    // Admin-editable access (Admin > Access control): reading needs "view", anything else needs "manage". Engineers use the
    // mobile app, whose job actions are checked per job, so the screen-level rule is for office roles only.
    if (user && user.role !== 'engineer' && user.role !== 'client') {
      const module = moduleOfPath(String(req.route?.path ?? req.path ?? ''));
      if (module && !hasLevel(user, module, req.method === 'GET' || req.method === 'HEAD' ? 'view' : 'manage')) {
        throw new ForbiddenException('You do not have access to this part of the system. Ask an admin.');
      }
    }
    return true;
  }
}

// RBAC is enforced server-side on every endpoint (PRD rule 11).
// @Auth() = any logged-in user; @Auth('admin','ga_head') = only those roles.
export const Auth = (...roles: RoleName[]) =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    UseGuards(AuthGuard('jwt'), RolesGuard),
    ApiBearerAuth(),
    ApiOperation({ description: roles.length ? 'Allowed roles: ' + roles.join(', ') : 'Any signed-in user' }),
  );

export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

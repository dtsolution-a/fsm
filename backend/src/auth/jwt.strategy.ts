import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AccessService } from '../access/access.service';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface AuthUser {
  id: string;
  role: 'admin' | 'ga_head' | 'supervisor' | 'engineer' | 'client';
  name: string;
  /** null = every branch; otherwise only these zones (branches). Undefined only for internal calls. */
  zoneIds?: string[] | null;
  /** module -> none | view | manage */
  access?: Record<string, 'none' | 'view' | 'manage'>;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private access: AccessService) {
    super({
      passReqToCallback: true,
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }
  // Every request re-reads the account: a deactivated user is locked out at once, and role / branch / access changes apply immediately.
  async validate(req: { headers: Record<string, string | string[] | undefined> }, payload: { sub: string; role: AuthUser['role']; name: string }): Promise<AuthUser> {
    const branch = req.headers['x-branch'];
    const u = await this.access.resolve(payload.sub, payload.role, payload.name, Array.isArray(branch) ? branch[0] : branch);
    if (!u) throw new UnauthorizedException();
    return u;
  }
}

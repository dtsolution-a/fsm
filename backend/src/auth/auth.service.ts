import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

const REFRESH_DAYS = 30;
const MAX_FAILED = 5; // wrong passwords in a row before the account is paused
const LOCK_MINUTES = 15;
// a real bcrypt hash of a random string: unknown user ids cost the same time as wrong passwords (no user probing by timing)
const DUMMY_HASH = bcrypt.hashSync(randomBytes(12).toString('hex'), 10);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}

  private publicUser(u: { id: string; fullName: string; role: string; email: string | null; userCode: string | null }) {
    return { id: u.id, name: u.fullName, role: u.role, email: u.email, userCode: u.userCode };
  }

  private async issue(user: { id: string; fullName: string; role: any; email: string | null; userCode: string | null }) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role, name: user.fullName });
    const refreshToken = randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_DAYS * 86400_000),
      },
    });
    return { accessToken, refreshToken, user: this.publicUser(user) };
  }

  // identifier = email OR QuikAllot-style user code (e.g. "Admin", "User100")
  async login(identifier: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier.toLowerCase() }, { userCode: identifier }] },
    });
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new HttpException(`Too many wrong passwords. Try again in ${mins} minute(s) or ask your admin to reset it.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const good = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.isActive || !good) {
      if (user && user.isActive) {
        const failed = user.failedLogins + 1;
        const lock = failed >= MAX_FAILED;
        await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
        if (lock) await this.audit.log(user.id, 'user', user.id, 'login_locked');
      }
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await this.audit.log(user.id, 'user', user.id, 'login');
    return this.issue(user);
  }

  async refresh(token: string) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha(token) }, include: { user: true } });
    if (!row || row.revokedAt || row.expiresAt < new Date() || !row.user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } }); // rotate
    return this.issue(row.user);
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new UnauthorizedException('Current password is wrong');
    if (current === next) throw new BadRequestException('Choose a different password from the current one');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, 10), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } }),
      // every other device has to sign in again with the new password
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log(userId, 'user', userId, 'password_changed');
    return { ok: true };
  }

  async logout(token: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha(token), revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async me(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.publicUser(u);
  }
}

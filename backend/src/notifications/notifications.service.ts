import { Controller, Delete, Global, Injectable, Logger, Module, Param, Post, Body } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsIn, IsString, MinLength } from 'class-validator';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

const TITLES: Record<string, string> = {
  negative_feedback: 'Negative client feedback',
  backdated_attempt: 'Backdated entry blocked',
  contract_expiry: 'Contract expiring',
  new_service_request: 'New service request',
  job_not_accepted: 'Job not accepted',
  low_stock: 'Low stock',
  job_assigned: 'Job update',
  job_declined: 'Job declined by engineer',
  job_not_closed: 'Jobs still open',
  duplicate_job: 'Possible duplicate job',
  parts_allocated: 'Parts allocated',
  auto_draft_invoice: 'Draft bill ready',
  spare_requested: 'Spare parts needed',
  spare_allocated: 'Spares ready to collect',
  spare_rejected: 'Spares not available',
  spares_to_return: 'Unused spares to return',
  travel_review: 'Travel needs a look',
  job_reminder: 'Job reminder',
  invoice_overdue: 'Invoice overdue',
  contract_high_cost: 'High-cost contract',
};

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class NotificationsService {
  private log = new Logger('Notifications');
  constructor(private prisma: PrismaService) {}

  async userIdsWithRoles(roles: Role[], db: Db = this.prisma) {
    const rows = await db.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  // In-app notification rows (the bell in the admin panel). Push is sent separately so a push outage never blocks a business action.
  async createInApp(recipientIds: string[], eventCode: string, payload: Prisma.InputJsonValue, db: Db = this.prisma) {
    if (!recipientIds.length) return 0;
    const now = new Date();
    const r = await db.notification.createMany({
      data: recipientIds.map((recipientId) => ({ recipientId, eventCode, channel: 'in_app', payload, sentAt: now })),
    });
    return r.count;
  }

  async dispatch(recipientIds: string[], eventCode: string, payload: Prisma.InputJsonValue, body?: string) {
    const n = await this.createInApp(recipientIds, eventCode, payload);
    void this.push(recipientIds, TITLES[eventCode] || eventCode, body || '', { eventCode });
    return n;
  }

  async dispatchToRoles(roles: Role[], eventCode: string, payload: Prisma.InputJsonValue, body?: string) {
    return this.dispatch(await this.userIdsWithRoles(roles), eventCode, payload, body);
  }

  // Push via OneSignal REST API. Silently does nothing until ONESIGNAL_APP_ID / ONESIGNAL_API_KEY are set.
  // NOTE: not exercised against the real OneSignal service yet (no credentials available).
  async push(userIds: string[], title: string, body: string, data?: Record<string, unknown>) {
    const appId = process.env.ONESIGNAL_APP_ID;
    const key = process.env.ONESIGNAL_API_KEY;
    if (!appId || !key || !userIds.length) return { sent: 0, skipped: !appId || !key ? 'push not configured' : 'no recipients' };
    try {
      const tokens = (await this.prisma.deviceToken.findMany({ where: { userId: { in: userIds } }, select: { token: true } })).map((t) => t.token);
      if (!tokens.length) return { sent: 0, skipped: 'no registered devices' };
      const res = await fetch(`${process.env.ONESIGNAL_API_URL || 'https://api.onesignal.com'}/notifications?c=push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
        body: JSON.stringify({ app_id: appId, include_subscription_ids: tokens, headings: { en: title }, contents: { en: body || title }, data }),
      });
      if (!res.ok) { this.log.warn(`OneSignal responded ${res.status}: ${(await res.text()).slice(0, 200)}`); return { sent: 0, error: res.status }; }
      return { sent: tokens.length };
    } catch (e) {
      this.log.warn(`Push failed: ${(e as Error).message}`);
      return { sent: 0, error: 'network' };
    }
  }

  async registerDevice(userId: string, token: string, platform: string) {
    // a device token belongs to whoever logged in on it last
    return this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform, lastSeenAt: new Date() },
      create: { userId, token, platform },
    });
  }

  async unregisterDevice(userId: string, token: string) {
    const r = await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
    return { removed: r.count };
  }
}

class DeviceDto {
  @IsString() @MinLength(8) token: string;
  @IsIn(['android', 'ios']) platform: string;
}

@Controller('devices')
export class DevicesController {
  constructor(private svc: NotificationsService) {}

  @Post() @Auth()
  async register(@CurrentUser() u: AuthUser, @Body() d: DeviceDto) {
    await this.svc.registerDevice(u.id, d.token, d.platform);
    return { ok: true };
  }

  @Delete(':token') @Auth()
  remove(@CurrentUser() u: AuthUser, @Param('token') token: string) {
    return this.svc.unregisterDevice(u.id, token);
  }
}

@Global()
@Module({ controllers: [DevicesController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}

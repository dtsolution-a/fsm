import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Immutable audit trail (PRD rule 12): actor, entity, before/after.
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(
    actorUserId: string | null,
    entityType: string,
    entityId: string,
    action: 'create' | 'update' | 'delete' | 'deactivate' | 'approve' | 'flag' | 'login' | 'login_locked' | 'password_changed',
    before?: unknown,
    after?: unknown,
  ) {
    await this.prisma.activityLog.create({
      data: {
        actorUserId,
        entityType,
        entityId,
        action,
        beforeState: before === undefined ? undefined : JSON.parse(JSON.stringify(before)),
        afterState: after === undefined ? undefined : JSON.parse(JSON.stringify(after)),
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

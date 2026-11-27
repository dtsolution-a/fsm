import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.service';
import { AuditModule } from './common/audit.service';
import { NotificationsModule } from './notifications/notifications.service';
import { StorageModule } from './storage/storage.service';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.controller';
import { ClientsModule } from './clients/clients.controller';
import { ProductsModule } from './products/products.controller';
import { EngineersModule } from './engineers/engineers.controller';
import { InventoryModule } from './inventory/inventory.controller';
import { JobsModule } from './jobs/jobs.controller';
import { MessagingModule } from './messaging/messaging.service';
import { BillingModule } from './billing/billing.controller';
import { AmcModule } from './amc/amc.service';
import { ReportsModule } from './reports/reports.service';
import { AccessModule } from './access/access.service';
import { RecordsModule } from './records/records.service';
import { TravelModule } from './travel/travel.controller';
import { VisitsModule } from './amc/visits.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Limit is applied only where @UseGuards(ThrottlerGuard) is used (login/refresh) - brute-force protection
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.LOGIN_RATE_LIMIT) || 10 }]),
    ScheduleModule.forRoot(), // daily contract-renewal reminders
    PrismaModule, AuditModule, AccessModule, NotificationsModule, StorageModule,
    AuthModule, AdminModule, ClientsModule, ProductsModule, EngineersModule, InventoryModule, MessagingModule, BillingModule, AmcModule, ReportsModule, JobsModule, TravelModule, VisitsModule, RecordsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

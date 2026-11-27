import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertByCode<T extends { code: string }>(model: any, rows: T[]) {
  for (const r of rows) {
    await model.upsert({ where: { code: r.code }, update: {}, create: r });
  }
}

async function main() {
  // Job categories / types as actually used in QuikAllot (Job Category.xlsx)
  await upsertByCode(prisma.jobType, [
    { code: 'breakdown_repair', label: 'Breakdown Repair', sortOrder: 1 },
    { code: 'installation_commissioning', label: 'Installation / Commissioning', sortOrder: 2 },
    { code: 'preventive_maintenance', label: 'Preventive Maintenance', sortOrder: 3 },
    { code: 'service', label: 'Service', sortOrder: 4 },
    { code: 'warranty_service', label: 'Warranty Service', sortOrder: 5 },
    { code: 'customer_visit', label: 'Customer Visit', sortOrder: 6 },
    { code: 'demo', label: 'Demo', sortOrder: 7 },
    { code: 'amc_visit', label: 'AMC Visit', sortOrder: 8 },
    { code: 'emergency', label: 'Emergency', sortOrder: 9 },
  ]);

  await upsertByCode(prisma.jobPriority, [
    { code: 'low', label: 'Low', sortOrder: 1 },
    { code: 'medium', label: 'Medium', sortOrder: 2 },
    { code: 'high', label: 'High', sortOrder: 3 },
    { code: 'critical', label: 'Critical', sortOrder: 4 },
  ]);

  // Vocabulary seen on the QuikAllot dashboard
  await upsertByCode(prisma.jobStatus, [
    { code: 'open', label: 'Open', sortOrder: 1 },
    { code: 'assigned', label: 'Assigned', sortOrder: 2 },
    { code: 'in_progress', label: 'In Progress', sortOrder: 2 },
    { code: 'on_hold', label: 'On Hold', sortOrder: 3 },
    { code: 'rescheduled', label: 'Rescheduled', sortOrder: 4 },
    { code: 'pending_review', label: 'Pending Review', sortOrder: 5 },
    { code: 'completed', label: 'Completed', sortOrder: 6 },
    { code: 'cancelled', label: 'Cancelled', isTerminal: true, sortOrder: 7 },
    { code: 'closed', label: 'Closed', isTerminal: true, sortOrder: 8 },
  ]);

  // Service Classification from Customer Product Details.xlsx
  await upsertByCode(prisma.contractType, [
    { code: 'on_call', label: 'On Call', isChargeable: true, sortOrder: 1 },
    { code: 'warranty', label: 'Warranty', isChargeable: false, sortOrder: 2 },
    { code: 'amc_with_spares', label: 'AMC With Spares', isChargeable: false, sortOrder: 3 },
    { code: 'amc_without_spares', label: 'AMC Without Spares', isChargeable: false, sortOrder: 4 },
  ]);

  await upsertByCode(prisma.skillCategory, [
    { code: 'air_compressor', label: 'Air Compressor' },
    { code: 'air_dryer', label: 'Air Dryer' },
    { code: 'vacuum_pump', label: 'Vacuum Pump' },
    { code: 'cng_dispenser', label: 'CNG Dispenser' },
    { code: 'refrigeration', label: 'Refrigeration' },
  ]);

  await upsertByCode(prisma.notificationEventType, [
    { code: 'new_service_request', label: 'New service request', defaultChannels: ['push', 'in_app'] },
    { code: 'job_not_accepted', label: 'Job not accepted by engineer', defaultChannels: ['push', 'in_app'] },
    { code: 'contract_expiry', label: 'Contract nearing expiry', defaultChannels: ['email', 'in_app'] },
    { code: 'job_declined', label: 'Job declined by engineer', defaultChannels: ['push', 'in_app'] },
    { code: 'duplicate_job', label: 'Possible duplicate job', defaultChannels: ['in_app'] },
    { code: 'low_stock', label: 'Low stock', defaultChannels: ['in_app'] },
    { code: 'negative_feedback', label: 'Negative client feedback', defaultChannels: ['push', 'email', 'in_app'] },
    { code: 'backdated_attempt', label: 'Backdated entry attempt', defaultChannels: ['push', 'in_app'] },
  ]);

  if (process.env.NODE_ENV === 'production' && (!process.env.SEED_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD.length < 12)) {
    throw new Error('Set SEED_ADMIN_PASSWORD (min 12 chars) to seed a production database');
  }
  const adminPw = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe#2026'; // dev default only
  await prisma.user.upsert({
    where: { userCode: 'Admin' },
    update: {},
    create: {
      userCode: 'Admin',
      email: 'admin@fsm.local',
      fullName: 'System Admin',
      role: Role.admin,
      passwordHash: await bcrypt.hash(adminPw, 10),
    },
  });

  await prisma.systemSetting.upsert({
    where: { key: 'company_profile' },
    update: {},
    create: { key: 'company_profile', value: { name: 'Shah Engineers and Consultants Private Limited' } },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'attendance_rules' },
    update: {},
    create: { key: 'attendance_rules', value: { lateAfter: '10:00', allowBackdateDays: 0 } },
  });

  console.log('Seed complete');
}

main().finally(() => prisma.$disconnect());

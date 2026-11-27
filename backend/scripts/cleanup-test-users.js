// Removes throw-away test users (and everything they created) whose User ID starts with the given prefix.
// Usage: node scripts/cleanup-test-users.js E2E       (refuses to touch real-looking prefixes)
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const prefix = process.argv[2];
if (!prefix || prefix.length < 3 || /^(user|admin)/i.test(prefix)) { console.error('Give a clear test prefix (3+ chars, not "User"/"Admin"), e.g. E2E or SMK or TST'); process.exit(2); }
(async () => {
  const uIds = (await db.user.findMany({ where: { userCode: { startsWith: prefix } }, select: { id: true } })).map((u) => u.id);
  const eIds = (await db.engineer.findMany({ where: { userId: { in: uIds } }, select: { id: true } })).map((e) => e.id);
  await db.attendanceRecord.deleteMany({ where: { engineerId: { in: eIds } } });
  await db.leaveRequest.deleteMany({ where: { engineerId: { in: eIds } } });
  await db.engineerLocation.deleteMany({ where: { engineerId: { in: eIds } } });
  await db.engineerZone.deleteMany({ where: { engineerId: { in: eIds } } });
  await db.engineerSkill.deleteMany({ where: { engineerId: { in: eIds } } });
  await db.engineer.deleteMany({ where: { id: { in: eIds } } });
  await db.userZone.deleteMany({ where: { userId: { in: uIds } } });
  await db.deviceToken.deleteMany({ where: { userId: { in: uIds } } });
  await db.refreshToken.deleteMany({ where: { userId: { in: uIds } } });
  await db.activityLog.deleteMany({ where: { actorUserId: { in: uIds } } });
  await db.notification.deleteMany({ where: { OR: [{ recipientId: { in: uIds } }, { eventCode: 'backdated_attempt' }] } });
  await db.user.deleteMany({ where: { id: { in: uIds } } });
  console.log(`removed ${uIds.length} test user(s) with prefix "${prefix}"; users left: ${await db.user.count()}`);
  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

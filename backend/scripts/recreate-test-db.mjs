// Drops and recreates the throw-away database `fsm_test` (never the dev database `fsm`).
import { PrismaClient } from '@prisma/client';
const url = 'postgresql://fsm:fsm_dev_password@127.0.0.1:54329/postgres?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url } } });
await prisma.$executeRawUnsafe('DROP DATABASE IF EXISTS fsm_test WITH (FORCE)');
await prisma.$executeRawUnsafe('CREATE DATABASE fsm_test ENCODING \'UTF8\' TEMPLATE template0');
await prisma.$disconnect();
console.log('fsm_test recreated');

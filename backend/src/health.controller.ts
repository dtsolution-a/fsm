import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

// Unauthenticated; used by the load balancer / ECS health checks.
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  // liveness: process is up (does not touch the DB so a DB blip does not kill healthy tasks)
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  // readiness: can serve traffic (DB reachable)
  @Get()
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up', uptimeSeconds: Math.round(process.uptime()) };
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', db: 'down' });
    }
  }
}

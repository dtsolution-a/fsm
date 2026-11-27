import { Body, Controller, Get, Global, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import * as nodemailer from 'nodemailer';
import { Auth } from '../auth/guards';
import { PageQuery, pageArgs, paged } from '../common/paging';
import { PrismaService } from '../prisma/prisma.service';

export type Channel = 'email' | 'sms' | 'whatsapp';

export interface OutMessage {
  channel: Channel;
  to: string;
  subject?: string;
  body: string;
  eventCode: string;
  clientId?: string;
  refType?: string;
  refId?: string;
}

// Which events are sent to clients (9.3) and over which channels. Editable later from settings; everything is logged either way.
const CLIENT_EVENTS: Record<string, { channels: Channel[] }> = {
  service_request_received: { channels: ['email', 'whatsapp'] },
  engineer_dispatched: { channels: ['email', 'whatsapp'] },
  job_completed: { channels: ['email', 'whatsapp'] },
  invoice_shared: { channels: ['email', 'whatsapp'] },
  payment_reminder: { channels: ['email', 'whatsapp'] },
  contract_renewal: { channels: ['email', 'whatsapp'] },
};

/**
 * One place for every message that leaves the system to a client.
 *  - email    -> SMTP (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM)
 *  - sms      -> HTTP gateway (SMS_WEBHOOK_URL, optional SMS_WEBHOOK_TOKEN)
 *  - whatsapp -> HTTP gateway (WHATSAPP_WEBHOOK_URL, optional WHATSAPP_WEBHOOK_TOKEN)
 * None of these are configured yet (the client has not chosen providers), so messages are stored as
 * "not_configured" in the outbox and can be re-sent from the admin panel once credentials exist.
 */
@Injectable()
export class MessagingService {
  private log = new Logger('Messaging');
  constructor(private prisma: PrismaService) {}

  emailConfigured() { return !!process.env.SMTP_HOST; }
  gatewayConfigured(c: Channel) { return c === 'sms' ? !!process.env.SMS_WEBHOOK_URL : c === 'whatsapp' ? !!process.env.WHATSAPP_WEBHOOK_URL : this.emailConfigured(); }

  status() {
    return { email: this.emailConfigured(), sms: this.gatewayConfigured('sms'), whatsapp: this.gatewayConfigured('whatsapp') };
  }

  async send(m: OutMessage) {
    const row = await this.prisma.outboundMessage.create({
      data: { channel: m.channel, toAddress: m.to, subject: m.subject, body: m.body, eventCode: m.eventCode, clientId: m.clientId, refType: m.refType, refId: m.refId, status: 'queued' },
    });
    return this.deliver(row.id);
  }

  async deliver(id: string) {
    const m = await this.prisma.outboundMessage.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Message not found');
    const channel = m.channel as Channel;
    if (!this.gatewayConfigured(channel)) {
      return this.prisma.outboundMessage.update({ where: { id }, data: { status: 'not_configured', error: `${channel} sending is not set up yet` } });
    }
    try {
      if (channel === 'email') {
        const t = nodemailer.createTransport({
          host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        });
        await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: m.toAddress, subject: m.subject || 'Notification', text: m.body });
      } else {
        const url = channel === 'sms' ? process.env.SMS_WEBHOOK_URL! : process.env.WHATSAPP_WEBHOOK_URL!;
        const token = channel === 'sms' ? process.env.SMS_WEBHOOK_TOKEN : process.env.WHATSAPP_WEBHOOK_TOKEN;
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ to: m.toAddress, message: m.body, subject: m.subject }) });
        if (!res.ok) throw new Error(`gateway answered ${res.status}`);
      }
      return this.prisma.outboundMessage.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), error: null } });
    } catch (e) {
      this.log.warn(`${channel} to ${m.toAddress} failed: ${(e as Error).message}`);
      return this.prisma.outboundMessage.update({ where: { id }, data: { status: 'failed', error: (e as Error).message.slice(0, 300) } });
    }
  }

  // Tell a client something. Uses the e-mail / phone saved on the client record.
  async notifyClient(clientId: string, eventCode: keyof typeof CLIENT_EVENTS | string, subject: string, body: string, ref?: { type: string; id: string }, extra?: { email?: string | null; phone?: string | null }) {
    try {
      const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { email: true, phone: true, companyName: true } });
      if (!client) return [];
      const channels = CLIENT_EVENTS[eventCode]?.channels ?? ['email'];
      const out: unknown[] = [];
      const email = extra?.email || client.email;
      const phone = extra?.phone || client.phone;
      for (const ch of channels) {
        const to = ch === 'email' ? email : phone;
        if (!to) continue;
        out.push(await this.send({ channel: ch, to, subject: ch === 'email' ? subject : undefined, body, eventCode, clientId, refType: ref?.type, refId: ref?.id }));
      }
      return out;
    } catch (e) {
      this.log.warn(`notifyClient failed (${eventCode}): ${(e as Error).message}`); // a message problem must never break the business action
      return [];
    }
  }

  async list(q: PageQuery & { status?: string; channel?: string; eventCode?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.OutboundMessageWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.channel) where.channel = q.channel;
    if (q.eventCode) where.eventCode = q.eventCode;
    if (q.search) where.OR = [{ toAddress: { contains: q.search, mode: 'insensitive' } }, { body: { contains: q.search, mode: 'insensitive' } }, { subject: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.outboundMessage.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.outboundMessage.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }
}

class MessageQuery extends PageQuery {
  @IsOptional() @IsIn(['queued', 'sent', 'failed', 'not_configured']) status?: string;
  @IsOptional() @IsIn(['email', 'sms', 'whatsapp']) channel?: string;
}

@Controller('messages')
export class MessagingController {
  constructor(private svc: MessagingService) {}

  @Get('status') @Auth('admin', 'ga_head')
  status() { return this.svc.status(); }

  @Get() @Auth('admin', 'ga_head')
  list(@Query() q: MessageQuery) { return this.svc.list(q); }

  @Post(':id/retry') @Auth('admin', 'ga_head')
  retry(@Param('id', ParseUUIDPipe) id: string) { return this.svc.deliver(id); }
}

@Global()
@Module({ controllers: [MessagingController], providers: [MessagingService], exports: [MessagingService] })
export class MessagingModule {}

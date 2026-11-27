import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { PageQuery } from '../common/paging';
import { BillingService } from './billing.service';

const STAFF = ['admin', 'ga_head', 'supervisor'] as const;
const MGR = ['admin', 'ga_head'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

class LineDto {
  @IsOptional() @IsIn(['service', 'part', 'labour', 'other']) kind?: 'service' | 'part' | 'labour' | 'other';
  @IsString() @MaxLength(300) description: string;
  @Type(() => Number) @IsNumber() quantity: number;
  @Type(() => Number) @IsNumber() unitPrice: number;
  @IsOptional() @IsUUID() sparePartId?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class TaxDto { @IsString() @MaxLength(40) label: string; @Type(() => Number) @IsNumber() @Min(0) @Max(100) rate: number; }
class SettingsDto {
  @IsOptional() @IsString() @MaxLength(200) companyName?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(30) gstin?: string;
  @IsOptional() @IsString() @MaxLength(20) pan?: string;
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(120) accountName?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) ifsc?: string;
  @IsOptional() @IsString() @MaxLength(2000) terms?: string;
  @IsOptional() @IsString() @MaxLength(500) footer?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TaxDto) taxes?: TaxDto[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) defaultDueDays?: number | null;
  @IsOptional() @IsBoolean() autoInvoice?: boolean;
  @IsOptional() @IsBoolean() quotationPriceLocked?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(1000) highCostPercent?: number;
}
class QuotationDto {
  @IsUUID() clientId: string;
  @IsOptional() @IsUUID() clientSiteId?: string;
  @IsOptional() @IsUUID() siteProductId?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @Matches(YMD) validUntil?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LineDto) lines: LineDto[];
}
class QuotationUpdateDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @Matches(YMD) validUntil?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LineDto) lines?: LineDto[];
}
class InvoiceDto {
  @IsUUID() clientId: string;
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @Matches(YMD) dueDate?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LineDto) lines: LineDto[];
}
class InvoiceUpdateDto {
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() dueDate?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LineDto) lines?: LineDto[];
}
class PaymentDto {
  @Type(() => Number) @IsNumber() @Min(0.01) amount: number;
  @IsOptional() @IsIn(['cash', 'cheque', 'bank_transfer', 'upi', 'card', 'other']) paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsDateString() paidAt?: string;
}
class ShareDto { @IsIn(['email', 'whatsapp', 'print']) channel: 'email' | 'whatsapp' | 'print'; }
class ReasonDto { @IsOptional() @IsString() @MaxLength(300) reason?: string; }
class InvoiceQuery extends PageQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @Matches(YMD) from?: string;
  @IsOptional() @Matches(YMD) to?: string;
  @IsOptional() @IsIn(['true', 'false']) overdue?: string;
  @IsOptional() @IsIn(['true']) auto?: string;
}
class PriceDto { @IsOptional() price?: number | null; }
class QuotationQuery extends PageQuery { @IsOptional() @IsString() status?: string; @IsOptional() @IsUUID() clientId?: string; }
class PaymentQuery extends PageQuery { @IsOptional() @IsUUID() clientId?: string; @IsOptional() @Matches(YMD) from?: string; @IsOptional() @Matches(YMD) to?: string; }
class SummaryQuery {
  @IsOptional() @Matches(YMD) from?: string;
  @IsOptional() @Matches(YMD) to?: string;
  @IsOptional() @IsIn(['month', 'quarter', 'year']) period?: 'month' | 'quarter' | 'year';
}
class ClientQuery { @IsOptional() @IsUUID() clientId?: string; }

@Controller()
export class BillingController {
  constructor(private svc: BillingService) {}

  // ----- settings (company profile, tax, terms - filled in by the business) -----
  @Get('billing/settings') @Auth(...STAFF) settings() { return this.svc.settingsWithGaps(); }
  @Put('billing/settings') @Auth('admin') save(@CurrentUser() u: AuthUser, @Body() d: SettingsDto) { return this.svc.saveSettings(u.id, d as any); }

  // ----- price list (one fixed price per job type; the draft bill uses it when a job is completed) -----
  @Get('billing/job-prices') @Auth(...STAFF) prices() { return this.svc.jobPrices(); }
  @Put('billing/job-prices/:id') @Auth(...MGR) setPrice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: PriceDto) { return this.svc.setJobPrice(u.id, id, d.price === undefined || d.price === null || (d.price as any) === '' ? null : Number(d.price)); }

  // ----- quotations -----
  @Get('quotations') @Auth(...STAFF) quotations(@Query() q: QuotationQuery) { return this.svc.listQuotations(q); }
  @Post('quotations') @Auth(...MGR) createQ(@CurrentUser() u: AuthUser, @Body() d: QuotationDto) { return this.svc.createQuotation(u.id, d as any); }
  @Get('quotations/:id') @Auth(...STAFF) getQ(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getQuotation(id); }
  @Patch('quotations/:id') @Auth(...MGR) updQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: QuotationUpdateDto) { return this.svc.updateQuotation(u.id, id, d as any); }
  @Post('quotations/:id/send') @Auth(...MGR) sendQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.quotationAction(u.id, id, 'send'); }
  @Post('quotations/:id/approve') @Auth(...MGR) approveQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.quotationAction(u.id, id, 'approve'); }
  @Post('quotations/:id/reject') @Auth(...MGR) rejectQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.quotationAction(u.id, id, 'reject'); }
  @Post('quotations/:id/convert') @Auth(...MGR) convertQ(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.convertQuotation(u.id, id); }

  // ----- invoices -----
  @Get('invoices') @Auth(...STAFF) invoices(@Query() q: InvoiceQuery) { return this.svc.listInvoices(q); }
  @Post('invoices') @Auth(...MGR) createI(@CurrentUser() u: AuthUser, @Body() d: InvoiceDto) { return this.svc.createInvoice(u.id, d as any); }
  @Post('jobs/:id/invoice') @Auth(...MGR) fromJob(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.generateForJob(u.id, id); }
  @Get('invoices/:id') @Auth(...STAFF) getI(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getInvoice(id); }
  @Patch('invoices/:id') @Auth(...MGR) updI(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: InvoiceUpdateDto) { return this.svc.updateInvoice(u.id, id, d as any); }
  @Post('invoices/:id/issue') @Auth(...MGR) issue(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.issueInvoice(u.id, id); }
  @Post('invoices/:id/cancel') @Auth(...MGR) cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto) { return this.svc.cancelInvoice(u.id, id, d.reason); }
  @Post('invoices/:id/share') @Auth(...MGR) share(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ShareDto) { return this.svc.shareInvoice(u.id, id, d.channel); }
  @Post('invoices/:id/payments') @Auth(...MGR) pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: PaymentDto) { return this.svc.addPayment(u.id, id, d); }

  // ----- payments / outstanding / summary -----
  @Get('payments') @Auth(...STAFF) payments(@Query() q: PaymentQuery) { return this.svc.listPayments(q); }
  @Get('billing/outstanding') @Auth(...STAFF) outstanding(@Query() q: ClientQuery) { return this.svc.outstanding(q.clientId); }
  @Get('billing/summary') @Auth(...MGR) summary(@Query() q: SummaryQuery) { return this.svc.summary(q); }
  @Post('billing/run-overdue') @Auth('admin') run() { return this.svc.runOverdue(); }
}

@Module({ controllers: [BillingController], providers: [BillingService], exports: [BillingService] })
export class BillingModule {}

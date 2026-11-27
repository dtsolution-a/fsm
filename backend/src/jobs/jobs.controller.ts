import { UploadedFiles } from '@nestjs/common';
import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Delete, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { MAX_UPLOAD_BYTES } from '../common/image';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min, MinLength, ValidateNested, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { PageQuery } from '../common/paging';
import { InventoryModule } from '../inventory/inventory.controller';
import { BillingModule } from '../billing/billing.controller';
import { AmcModule } from '../amc/amc.service';
import { JobsService } from './jobs.service';

const STAFF = ['admin', 'ga_head', 'supervisor'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

class RequestDto {
  @IsUUID() clientId: string;
  @IsOptional() @IsUUID() clientSiteId?: string;
  @IsOptional() @IsUUID() siteProductId?: string;
  @IsOptional() @IsString() @MaxLength(2000) issueDescription?: string;
  @IsOptional() @IsIn(['low', 'medium', 'high', 'critical']) priorityCode?: string;
  @IsOptional() @IsIn(['phone', 'web', 'mobile_app', 'qr_code', 'portal', 'whatsapp']) sourceChannel?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;
}
class PublicRequestDto {
  @IsUUID() siteProductId: string;
  @IsString() @MinLength(5) @MaxLength(2000) issueDescription: string;
  @IsString() @MinLength(2) @MaxLength(100) contactName: string;
  @IsString() @Matches(/^[0-9+\-\s]{7,15}$/, { message: 'Enter a valid phone number' }) contactPhone: string;
  @IsOptional() @IsIn(['low', 'medium', 'high', 'critical']) priorityCode?: string;
}
class RequestQuery extends PageQuery { @IsOptional() @IsIn(['open', 'converted', 'closed']) status?: string; }
class CreateJobDto {
  @IsOptional() @IsUUID() serviceRequestId?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() clientSiteId?: string;
  @IsOptional() @IsUUID() siteProductId?: string;
  @IsOptional() @IsUUID() jobTypeId?: string;
  @IsOptional() @IsUUID() priorityId?: string;
  @IsOptional() @IsDateString() scheduledStart?: string;
  @IsOptional() @IsDateString() scheduledEnd?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsUUID() primaryEngineerId?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) supportingEngineerIds?: string[];
}
class UpdateJobDto {
  @IsOptional() @IsDateString() scheduledStart?: string;
  @IsOptional() @IsDateString() scheduledEnd?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsUUID() priorityId?: string;
  @IsOptional() @IsUUID() jobTypeId?: string;
}
class AssignDto {
  @IsUUID() primaryEngineerId: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) supportingEngineerIds?: string[];
}
class JobListQuery extends PageQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsUUID() engineerId?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() jobTypeId?: string;
  @IsOptional() @Matches(YMD) from?: string;
  @IsOptional() @Matches(YMD) to?: string;
  @IsOptional() @IsIn(['true', 'false']) duplicates?: string;
}
class CalendarQuery { @Matches(YMD) from: string; @Matches(YMD) to: string; }
class SuggestQuery {
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsUUID() serviceRequestId?: string;
  @IsOptional() @IsUUID() clientSiteId?: string;
  @IsOptional() @IsUUID() siteProductId?: string;
  @IsOptional() @Matches(YMD) date?: string;
  @IsOptional() @IsUUID() zoneId?: string;
  @IsOptional() @IsUUID() skillId?: string;
}
class ReasonDto { @IsString() @MinLength(3) @MaxLength(500) reason: string; }
class NoteDto { @IsOptional() @IsString() @MaxLength(500) note?: string; }
class HoldDto { @IsIn(['on_hold', 'open']) status: 'on_hold' | 'open'; @IsOptional() @IsString() note?: string; }
class PartLine { @IsUUID() sparePartId: string; @Type(() => Number) @IsInt() @Min(0) quantity: number; @IsOptional() @IsUUID() warehouseId?: string; }
class CompleteDto {
  @IsOptional() @IsString() @MaxLength(4000) closureNotes?: string;
  @IsOptional() @IsString() @MaxLength(200) signedByName?: string;
  @IsOptional() @IsString() @MaxLength(1000) contribution?: string;
  // true: every spare given to the engineer was used. false: parts[] says how many of each were used; the rest goes back to the hub.
  @IsOptional() @IsBoolean() allSparesUsed?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PartLine) parts?: PartLine[];
}
class TimesDto { @IsOptional() @IsDateString() actualStart?: string; @IsOptional() @IsDateString() actualEnd?: string; }
class AllocateDto {
  @IsUUID() sparePartId: string;
  @Type(() => Number) @IsInt() @Min(1) quantity: number;
  @IsUUID() warehouseId: string;
  @IsOptional() @IsUUID() engineerId?: string;
}
class MyJobsQuery { @IsOptional() @IsIn(['history']) scope?: string; @IsOptional() @Matches(YMD) date?: string; }
class PartsLookupQuery { @IsString() @MinLength(2) @MaxLength(60) search: string; }
class RouteQuery { @IsOptional() @Matches(YMD) date?: string; }
class AttachQuery { @IsIn(['photo_before', 'photo_after', 'signature', 'reference_doc']) type: string; }

@Controller()
export class JobsController {
  constructor(private svc: JobsService) {}

  // ----- public (QR code on the machine / web form). Unauthenticated, so rate limited. -----
  @Get('public/machines/:id') @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  publicMachine(@Param('id', ParseUUIDPipe) id: string) { return this.svc.publicMachine(id); }

  @Get('public/machines/:id/requests') @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  publicRequests(@Param('id', ParseUUIDPipe) id: string) { return this.svc.publicMachineRequests(id); }

  // multipart/form-data with up to 3 photos in the "images" field (JSON without photos still works)
  @Post('public/service-requests') @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('images', 3, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 3 } }))
  publicRequest(@Body() dto: PublicRequestDto, @UploadedFiles() files: Express.Multer.File[]) { return this.svc.publicRequest(dto, files || []); }

  // ----- service requests (04.1) -----
  @Post('service-requests') @Auth(...STAFF, 'client')
  createRequest(@CurrentUser() u: AuthUser, @Body() dto: RequestDto) { return this.svc.createRequest(u, dto); }

  @Get('service-requests') @Auth(...STAFF)
  requests(@Query() q: RequestQuery) { return this.svc.listRequests(q); }

  @Post('service-requests/:id/attachments') @Auth(...STAFF, 'client')
  @UseInterceptors(FilesInterceptor('images', 5, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 5 } }))
  addPhotos(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[]) { return this.svc.addRequestImages(id, files || [], u.id); }

  @Get('service-requests/:id/attachments/:attId') @Auth('engineer', ...STAFF)
  async photo(@Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string, @Res({ passthrough: true }) res: Response) {
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300' });
    return new StreamableFile(await this.svc.requestImageStream(id, attId));
  }

  // ----- engineer / mobile app -----
  @Get('engineers/me/jobs') @Auth('engineer')
  myJobs(@CurrentUser() u: AuthUser, @Query() q: MyJobsQuery) { return this.svc.myJobs(u, q); }

  @Get('engineers/:id/route-plan') @Auth('engineer', ...STAFF)
  routePlan(@Param('id', ParseUUIDPipe) id: string, @Query() q: RouteQuery) { return this.svc.routePlan(id, q.date); }

  @Post('jobs/:id/accept') @Auth('engineer')
  accept(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.accept(u, id); }

  @Post('jobs/:id/decline') @Auth('engineer')
  decline(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto) { return this.svc.decline(u, id, d.reason); }

  @Post('jobs/:id/complete') @Auth('engineer')
  complete(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: CompleteDto) { return this.svc.complete(u, id, d); }

  @Get('machines/:id/history') @Auth('engineer', ...STAFF)
  machineHistory(@Param('id', ParseUUIDPipe) id: string) { return this.svc.machineHistory(id); }

  // ----- jobs -----
  @Get('jobs/dashboard') @Auth(...STAFF)
  dashboard() { return this.svc.dashboard(); }

  @Get('jobs/calendar') @Auth(...STAFF)
  calendar(@CurrentUser() u: AuthUser, @Query() q: CalendarQuery) { return this.svc.calendar(u, q.from, q.to); }

  @Get('jobs/suggest-engineers') @Auth(...STAFF)
  suggest(@Query() q: SuggestQuery) { return this.svc.suggestEngineers(q); }

  @Get('jobs/parts-lookup') @Auth('engineer', ...STAFF)
  parts(@Query() q: PartsLookupQuery) { return this.svc.partsLookup(q.search); }

  @Get('jobs/pending-approvals') @Auth('admin', 'ga_head')
  approvals() { return this.svc.pendingApprovals(); }

  @Post('jobs/run-alerts') @Auth('admin')
  async runAlerts() { return { notAccepted: await this.svc.runNotAcceptedAlerts(), notClosed: await this.svc.runNotClosedAlert(), reminders: await this.svc.runJobReminders() }; }

  @Get('jobs') @Auth(...STAFF)
  list(@CurrentUser() u: AuthUser, @Query() q: JobListQuery) { return this.svc.list(u, q); }

  @Post('jobs') @Auth('admin', 'ga_head')
  create(@CurrentUser() u: AuthUser, @Body() d: CreateJobDto) { return this.svc.create(u, d); }

  @Get('jobs/:id') @Auth('engineer', ...STAFF)
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }

  @Patch('jobs/:id') @Auth('admin', 'ga_head')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: UpdateJobDto) { return this.svc.update(u, id, d); }

  @Post('jobs/:id/assign') @Auth('admin', 'ga_head')
  assign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: AssignDto) { return this.svc.assign(u, id, d); }

  @Post('jobs/:id/cancel') @Auth('admin', 'ga_head')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: NoteDto) { return this.svc.cancel(u, id, d.note); }

  @Post('jobs/:id/status') @Auth('admin', 'ga_head')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: HoldDto) { return this.svc.setStatus(u, id, d.status, d.note); }

  @Post('jobs/:id/close') @Auth('admin', 'ga_head')
  close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.closeJob(u, id); }

  @Post('jobs/:id/closure/approve') @Auth('admin', 'ga_head')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.decideClosure(u, id, true); }

  @Post('jobs/:id/closure/reject') @Auth('admin', 'ga_head')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.decideClosure(u, id, false); }

  @Patch('jobs/:id/times') @Auth('admin', 'ga_head')
  times(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: TimesDto) { return this.svc.editTimes(u, id, d); }

  @Post('jobs/:id/merge-duplicate') @Auth('admin', 'ga_head')
  merge(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.mergeDuplicate(u, id); }

  @Post('jobs/:id/dismiss-duplicate') @Auth('admin', 'ga_head')
  dismiss(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.dismissDuplicate(u, id); }

  @Post('jobs/:id/parts') @Auth('admin', 'ga_head', 'supervisor')
  allocate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: AllocateDto) { return this.svc.allocatePart(u, id, d); }

  @Delete('jobs/:id/parts/:rowId') @Auth('admin', 'ga_head', 'supervisor')
  removePart(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('rowId', ParseUUIDPipe) rowId: string) { return this.svc.removePart(u, id, rowId); }

  @Post('jobs/:id/attachments') @Auth('engineer', ...STAFF)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  attach(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: AttachQuery, @UploadedFile() file: Express.Multer.File) { return this.svc.addAttachment(u, id, q.type, file); }

  @Get('jobs/:id/attachments/:attId') @Auth('engineer', ...STAFF)
  async attachment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string, @Res({ passthrough: true }) res: Response) {
    const a = await this.svc.attachmentStream(u, id, attId);
    res.set({ 'Content-Type': a.mime, 'Cache-Control': 'private, max-age=300' });
    return new StreamableFile(a.stream);
  }
}

@Module({ imports: [InventoryModule, BillingModule, AmcModule], controllers: [JobsController], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}

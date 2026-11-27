import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { PageQuery } from '../common/paging';
import { IsStrongPassword } from '../common/password';
import { EngineersService } from './engineers.service';

class EngineerQuery extends PageQuery {
  @IsOptional() @IsUUID() zoneId?: string;
  @IsOptional() @IsUUID() skillId?: string;
}
class CreateEngineerDto {
  @IsString() fullName: string;
  @IsString() @IsStrongPassword() password: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() userCode?: string;
  @IsOptional() @IsString() employeeCode?: string;
  @IsOptional() @IsString() designation?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsDateString() dateOfJoining?: string;
  @IsOptional() @IsUUID() primaryZoneId?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) zoneIds?: string[];
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) skillIds?: string[];
}
class UpdateEngineerDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() employeeCode?: string;
  @IsOptional() @IsString() designation?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsUUID() primaryZoneId?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) zoneIds?: string[];
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) skillIds?: string[];
}
class CheckInDto { @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string; }
class LeaveDto {
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsString() reason?: string;
}
class PingDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lng: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracyM?: number;
}
class PointDto extends PingDto { @IsOptional() @IsString() at?: string; }
class BatchDto { @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => PointDto) points: PointDto[]; }
class DateQuery { @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string; }
class LeaveQuery {
  @IsOptional() @IsIn(['pending', 'approved', 'rejected']) status?: string;
  @IsOptional() @IsUUID() engineerId?: string;
}
class RangeQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
}
class OptionalDateQuery { @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string; }

const STAFF = ['admin', 'ga_head', 'supervisor'] as const;

@Controller()
export class EngineersController {
  constructor(private svc: EngineersService) {}

  // ----- profiles -----
  @Get('engineers') @Auth(...STAFF)
  list(@CurrentUser() u: AuthUser, @Query() q: EngineerQuery) { return this.svc.list(u, q); }

  @Post('engineers') @Auth('admin')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateEngineerDto) { return this.svc.create(u.id, dto); }

  @Get('engineers/me') @Auth('engineer')
  me(@CurrentUser() u: AuthUser) { return this.svc.me(u); }

  // ----- self-service (engineer's own mobile app) -----
  @Get('engineers/me/attendance/today') @Auth('engineer')
  myToday(@CurrentUser() u: AuthUser) { return this.svc.myToday(u); }

  @Post('engineers/me/attendance/check-in') @Auth('engineer')
  checkIn(@CurrentUser() u: AuthUser, @Body() dto: CheckInDto) { return this.svc.checkIn(u, dto.date); }

  @Post('engineers/me/attendance/check-out') @Auth('engineer')
  checkOut(@CurrentUser() u: AuthUser) { return this.svc.checkOut(u); }

  @Post('engineers/me/locations') @Auth('engineer')
  ping(@CurrentUser() u: AuthUser, @Body() dto: PingDto) { return this.svc.ping(u, dto.lat, dto.lng, dto.accuracyM); }

  @Post('engineers/me/locations/batch') @Auth('engineer')
  pingBatch(@CurrentUser() u: AuthUser, @Body() dto: BatchDto) { return this.svc.pingBatch(u, dto.points); }

  // ----- live map -----
  @Get('engineers/live') @Auth(...STAFF)
  live(@CurrentUser() u: AuthUser) { return this.svc.live(u); }

  @Get('engineers/:id') @Auth(...STAFF)
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }

  @Patch('engineers/:id') @Auth('admin')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEngineerDto) { return this.svc.update(u.id, id, dto); }

  @Post('engineers/:id/deactivate') @Auth('admin')
  deactivate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setActive(u.id, id, false); }

  @Post('engineers/:id/activate') @Auth('admin')
  activate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setActive(u.id, id, true); }

  // date picker driven (never a dropdown) - PRD rule 8
  @Get('engineers/:id/route') @Auth(...STAFF)
  route(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: DateQuery) { return this.svc.route(u, id, q.date); }

  // ----- attendance console -----
  @Get('attendance') @Auth(...STAFF)
  attendance(@CurrentUser() u: AuthUser, @Query() q: OptionalDateQuery) { return this.svc.attendanceDay(u, q.date); }

  // ----- leave -----
  @Post('leave-requests') @Auth('engineer')
  apply(@CurrentUser() u: AuthUser, @Body() dto: LeaveDto) { return this.svc.applyLeave(u, dto); }

  @Get('leave-requests') @Auth('admin', 'ga_head', 'supervisor', 'engineer')
  leaves(@CurrentUser() u: AuthUser, @Query() q: LeaveQuery) { return this.svc.leaves(u, q); }

  @Get('leave-calendar') @Auth(...STAFF)
  calendar(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) { return this.svc.leaveCalendar(u, q.from, q.to); }

  @Patch('leave-requests/:id/approve') @Auth('admin', 'ga_head')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.decideLeave(u.id, id, 'approved'); }

  @Patch('leave-requests/:id/reject') @Auth('admin', 'ga_head')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.decideLeave(u.id, id, 'rejected'); }
}

@Module({ controllers: [EngineersController], providers: [EngineersService], exports: [EngineersService] })
export class EngineersModule {}

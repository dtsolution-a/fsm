import { BadRequestException, Body, Controller, Get, Header, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { JobsModule } from '../jobs/jobs.controller';
import { JobsService } from '../jobs/jobs.service';
import { TravelService } from './travel.service';
import { SparesService } from './spares.service';
import { MapService } from './map.service';
import { RoutingService } from './routing.service';

const STAFF = ['admin', 'ga_head', 'supervisor'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

class TravelCoordDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lng: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracyM?: number;
}
class StartDto extends TravelCoordDto { @IsOptional() @IsIn(['direct', 'app_route']) mode?: 'direct' | 'app_route'; }
class MaybeCoordDto {
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsNumber() accuracyM?: number;
  @IsOptional() @IsIn(['direct', 'app_route']) mode?: 'direct' | 'app_route';
}
class ArriveDto extends TravelCoordDto {
  @IsOptional() @IsUUID() machineId?: string;
  @IsOptional() @IsString() @MaxLength(600) reason?: string;
  @IsOptional() @IsString() @MaxLength(10) reasonLang?: string;
  @IsOptional() @IsBoolean() reasonVoice?: boolean;
  @IsOptional() @IsString() @MaxLength(300) overrideReason?: string;
}
class TravelReviewDto { @IsBoolean() approve: boolean; @IsOptional() @IsString() @MaxLength(300) note?: string; }
class TravelSettingsDto {
  @IsOptional() @IsNumber() @Min(0) toleranceKm?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) tolerancePct?: number;
  @IsOptional() @IsNumber() @Min(10) arrivalRadiusM?: number;
  @IsOptional() @IsNumber() @Min(10) atSiteRadiusM?: number;
  @IsOptional() ratePerKm?: number | null;
  @IsOptional() @IsBoolean() requireTravelFlow?: boolean;
  @IsOptional() @IsBoolean() demoMode?: boolean;
  @IsOptional() @IsNumber() @Min(1) delayedRequestHours?: number;
}
class SpareItemDto { @IsUUID() sparePartId: string; @IsInt() @Min(1) @Max(999) quantity: number; }
class SpareDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SpareItemDto) items: SpareItemDto[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
class AllocItemDto { @IsUUID() itemId: string; @IsInt() @Min(0) quantity: number; }
class SpareAllocateDto {
  @IsUUID() warehouseId: string;
  @IsOptional() @IsString() @MaxLength(300) hubNote?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AllocItemDto) items?: AllocItemDto[];
}
class SpareNoteDto { @IsOptional() @IsString() @MaxLength(300) note?: string; }
class TravelPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
class TravelRangeDto extends TravelPageDto {
  @IsOptional() @Matches(YMD) from?: string; @IsOptional() @Matches(YMD) to?: string;
  @IsOptional() @IsIn(['none', 'pending', 'approved', 'rejected']) review?: string;
  @IsOptional() @IsIn(['csv']) format?: 'csv';
}
class SpareListDto extends TravelPageDto { @IsOptional() @IsIn(['requested', 'allocated', 'rejected', 'cancelled']) status?: string; }
class MapSitesDto {
  @IsOptional() @IsUUID() zoneId?: string;
  @IsOptional() @IsIn(['all', 'open', 'delayed']) filter?: string;
  @IsOptional() @IsString() @MaxLength(60) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3000) limit?: number;
}
class GeoDto { @IsOptional() @IsInt() @Min(1) @Max(2000) places?: number; }

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

@Controller()
export class TravelController {
  constructor(private travel: TravelService, private spares: SparesService, private map: MapService, private jobs: JobsService) {}

  // ----- the engineer's journey -----
  @Post('jobs/:id/travel/check') @Auth('engineer')
  check(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: TravelCoordDto) { return this.travel.check(u, id, d); }

  // Start: with a location it begins the trip; without one it is the old one-tap start (kept for the office / old apps) unless switched off
  @Post('jobs/:id/start') @Auth('engineer')
  async start(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: MaybeCoordDto) {
    if (d.lat !== undefined && d.lng !== undefined) return this.travel.start(u, id, { lat: d.lat, lng: d.lng, accuracyM: d.accuracyM, mode: d.mode });
    if ((await this.travel.settings()).requireTravelFlow) throw new BadRequestException('Turn on location and start again from the app');
    return this.jobs.start(u, id);
  }

  @Post('jobs/:id/arrive') @Auth('engineer')
  arrive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ArriveDto) { return this.travel.arrive(u, id, d); }

  @Post('jobs/:id/spare-requests') @Auth('engineer')
  askSpares(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: SpareDto) { return this.spares.create(u, id, d); }

  @Get('engineers/me/spare-requests') @Auth('engineer')
  mySpares(@CurrentUser() u: AuthUser) { return this.spares.mine(u); }

  // ----- the office: trips, claims and settings -----
  @Get('jobs/:id/travel') @Auth(...STAFF)
  forJob(@Param('id', ParseUUIDPipe) id: string) { return this.travel.forJob(id); }

  @Post('jobs/:id/travel/:legId/review') @Auth(...STAFF)
  review(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('legId', ParseUUIDPipe) legId: string, @Body() d: TravelReviewDto) { return this.travel.review(u, id, legId, d); }

  @Get('travel/review-queue') @Auth(...STAFF)
  queue(@Query() q: TravelPageDto) { return this.travel.reviewQueue(q); }

  @Get('engineers/:id/travel') @Auth(...STAFF) @Header('Cache-Control', 'no-store')
  async forEngineer(@Param('id', ParseUUIDPipe) id: string, @Query() q: TravelRangeDto) {
    const r = await this.travel.forEngineer(id, q);
    if (q.format !== 'csv') return r;
    const head = ['Date', 'Job', 'Client', 'Site', 'Mode', 'Expected km', 'Actual km', 'Payable km', 'Rate', 'Amount', 'Minutes', 'Review', 'Reason'];
    const all = (await this.travel.forEngineer(id, { ...q, page: 1, limit: 100 })).legs; // CSV carries the first 100; the screen pages through the rest
    return { csv: [head.map(csvCell).join(','), ...all.map((l) => [l.startedAt?.toISOString?.().slice(0, 10), l.job.jobNumber, l.job.client, l.job.site, l.mode, l.expectedKm, l.actualKm, l.payableKm, l.ratePerKm, l.amount, l.actualMinutes, l.review, l.reason].map(csvCell).join(','))].join('\n') };
  }

  @Get('travel/settings') @Auth(...STAFF)
  settings() { return this.travel.settings(); }
  @Put('travel/settings') @Auth('admin', 'ga_head')
  saveSettings(@CurrentUser() u: AuthUser, @Body() d: TravelSettingsDto) { return this.travel.saveSettings(u.id, d as any); }

  // ----- spare requests (zone head / whoever handles the zone's spares) -----
  @Get('spare-requests') @Auth(...STAFF)
  spareList(@Query() q: SpareListDto) { return this.spares.list(q); }
  @Get('spare-requests/:id/stock') @Auth(...STAFF)
  spareStock(@Param('id', ParseUUIDPipe) id: string) { return this.spares.stockFor(id); }
  @Post('spare-requests/:id/allocate') @Auth(...STAFF)
  allocate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: SpareAllocateDto) { return this.spares.allocate(u, id, d); }
  @Post('spare-requests/:id/reject') @Auth(...STAFF)
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: SpareNoteDto) { return this.spares.reject(u, id, d.note); }

  // ----- map -----
  @Get('map/zones') @Auth(...STAFF) mapZones() { return this.map.zones(); }
  @Get('map/sites') @Auth(...STAFF) mapSites(@Query() q: MapSitesDto) { return this.map.sites(q); }
  @Post('map/geocode') @Auth('admin', 'ga_head') geocode(@CurrentUser() u: AuthUser, @Body() d: GeoDto) { return this.map.startGeocode(u.id, d.places); }
  @Get('map/geocode/status') @Auth(...STAFF) geoStatus() { return this.map.status(); }
}

@Module({ imports: [JobsModule], controllers: [TravelController], providers: [TravelService, SparesService, MapService, RoutingService], exports: [TravelService] })
export class TravelModule {}

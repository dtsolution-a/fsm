import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsDateString, IsEmail, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { PageQuery } from '../common/paging';
import { ClientsService } from './clients.service';
import { ContractsController, ContractsService } from './contracts.service';

class ClientDto {
  @IsString() companyName: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
}
class ClientUpdateDto {
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
}
class SiteDto {
  @IsString() siteName: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsString() siteContactName?: string;
  @IsOptional() @IsString() siteContactPhone?: string;
  @IsOptional() @IsUUID() zoneId?: string;
}
class SiteUpdateDto {
  @IsOptional() @IsString() siteName?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsString() siteContactName?: string;
  @IsOptional() @IsString() siteContactPhone?: string;
  @IsOptional() @IsUUID() zoneId?: string;
}
class ZoneAssignDto {
  @IsString() zoneLabel: string;
  @IsUUID() zoneId: string;
}
class SiteProductDto {
  @IsUUID() productModelId: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsDateString() installationDate?: string;
  @IsOptional() @IsDateString() warrantyExpiry?: string;
}
class FeedbackDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() comment?: string;
  @IsString() submittedVia: string;
  @IsOptional() @IsString() jobRef?: string;
}

@Controller('clients')
export class ClientsController {
  constructor(private svc: ClientsService) {}

  @Get() @Auth('admin', 'ga_head', 'supervisor')
  list(@Query() q: PageQuery) { return this.svc.list(q); }

  @Post() @Auth('admin')
  create(@CurrentUser() u: AuthUser, @Body() dto: ClientDto) { return this.svc.create(u.id, dto); }

  // sites whose QuikAllot zone text could not be matched to a zone yet (admin decides, one label at a time)
  @Get('zone-labels/unlinked') @Auth('admin')
  unlinkedLabels() { return this.svc.unlinkedZoneLabels(); }

  @Post('zone-labels/assign') @Auth('admin')
  assignLabel(@CurrentUser() u: AuthUser, @Body() dto: ZoneAssignDto) { return this.svc.assignZoneLabel(u.id, dto.zoneLabel, dto.zoneId); }

  @Get(':id') @Auth('admin', 'ga_head', 'supervisor')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }

  @Patch(':id') @Auth('admin')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClientUpdateDto) { return this.svc.update(u.id, id, dto); }

  @Post(':id/deactivate') @Auth('admin')
  deactivate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setActive(u.id, id, false); }

  @Post(':id/activate') @Auth('admin')
  activate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setActive(u.id, id, true); }

  @Get(':id/sites') @Auth('admin', 'ga_head', 'supervisor')
  sites(@Param('id', ParseUUIDPipe) id: string) { return this.svc.listSites(id); }

  @Post(':id/sites') @Auth('admin')
  addSite(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SiteDto) { return this.svc.createSite(u.id, id, dto); }

  @Patch(':id/sites/:siteId') @Auth('admin')
  updateSite(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: SiteUpdateDto) {
    return this.svc.updateSite(u.id, id, siteId, dto);
  }

  @Get(':id/products') @Auth('admin', 'ga_head', 'supervisor')
  products(@Param('id', ParseUUIDPipe) id: string) { return this.svc.siteProducts(id); }

  @Post(':id/sites/:siteId/products') @Auth('admin')
  addProduct(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: SiteProductDto) {
    return this.svc.addSiteProduct(u.id, id, siteId, dto);
  }

  @Get(':id/feedback') @Auth('admin', 'ga_head')
  feedback(@Param('id', ParseUUIDPipe) id: string) { return this.svc.feedback(id); }

  @Post(':id/feedback') @Auth('admin', 'ga_head')
  addFeedback(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FeedbackDto) {
    return this.svc.addFeedback(u.id, id, dto);
  }
}

@Module({
  controllers: [ClientsController, ContractsController],
  providers: [ClientsService, ContractsService],
  exports: [ClientsService, ContractsService],
})
export class ClientsModule {}

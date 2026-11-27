import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { PageQuery } from '../common/paging';
import { IsStrongPassword } from '../common/password';
import { AdminService } from './admin.service';

const ROLES = ['admin', 'ga_head', 'supervisor', 'engineer', 'client'];

class UserQuery extends PageQuery { @IsOptional() @IsIn(ROLES) role?: string; @IsOptional() @IsIn(['name', 'login']) sort?: string; @IsOptional() @IsUUID() zoneId?: string; @IsOptional() @IsIn(['true']) review?: string; }
class CreateUserDto {
  @IsString() fullName: string;
  @IsIn(ROLES) role: string;
  @IsString() @IsStrongPassword() password: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() userCode?: string;
  @IsOptional() @IsString() legacyGroup?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) zoneIds?: string[];
}
class UpdateUserDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsIn(ROLES) role?: string;
  @IsOptional() @IsString() @IsStrongPassword() password?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() legacyGroup?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) zoneIds?: string[];
}
class SettingDto { @IsObject() value: Record<string, unknown>; }
class LookupCreateDto { @IsString() code: string; @IsString() label: string; @IsOptional() sortOrder?: number; @IsOptional() @IsBoolean() isTerminal?: boolean; @IsOptional() @IsBoolean() isChargeable?: boolean; @IsOptional() slaHours?: number; @IsOptional() @IsArray() defaultChannels?: string[]; }
class LookupUpdateDto { @IsOptional() @IsString() label?: string; @IsOptional() sortOrder?: number; @IsOptional() @IsBoolean() isTerminal?: boolean; @IsOptional() @IsBoolean() isChargeable?: boolean; @IsOptional() slaHours?: number; @IsOptional() @IsArray() defaultChannels?: string[]; }
class ZoneDto { @IsString() name: string; @IsOptional() @IsString() description?: string; }
class ActivityQuery extends PageQuery { @IsOptional() @IsString() entityType?: string; @IsOptional() @IsString() entityId?: string; }

@Controller()
export class AdminController {
  constructor(private svc: AdminService) {}

  @Get('dashboard') @Auth('admin', 'ga_head', 'supervisor') dashboard() { return this.svc.dashboard(); }

  // users (Module 11.1)
  @Get('users') @Auth('admin') users(@Query() q: UserQuery) { return this.svc.users(q); }
  @Post('users') @Auth('admin') createUser(@CurrentUser() u: AuthUser, @Body() d: CreateUserDto) { return this.svc.createUser(u.id, d); }
  @Patch('users/:id') @Auth('admin') updateUser(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: UpdateUserDto) { return this.svc.updateUser(u.id, id, d); }
  @Post('users/:id/deactivate') @Auth('admin') off(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setUserActive(u.id, id, false); }
  @Post('users/:id/activate') @Auth('admin') on(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setUserActive(u.id, id, true); }

  // settings (Module 11.2)
  @Get('settings') @Auth('admin', 'ga_head') settings() { return this.svc.settings(); }
  @Put('settings/:key') @Auth('admin') setSetting(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() d: SettingDto) { return this.svc.setSetting(u.id, key, d.value); }

  // lookups: admin adds a job type / priority / etc. with no deploy
  @Get('lookups/:type') @Auth() lookups(@Param('type') type: string) { return this.svc.lookupList(type); }
  @Post('lookups/:type') @Auth('admin') lkCreate(@CurrentUser() u: AuthUser, @Param('type') type: string, @Body() d: LookupCreateDto) { return this.svc.lookupCreate(u.id, type, d); }
  @Patch('lookups/:type/:id') @Auth('admin') lkUpdate(@CurrentUser() u: AuthUser, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string, @Body() d: LookupUpdateDto) { return this.svc.lookupUpdate(u.id, type, id, d); }
  @Post('lookups/:type/:id/deactivate') @Auth('admin') lkOff(@CurrentUser() u: AuthUser, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string) { return this.svc.lookupSetActive(u.id, type, id, false); }

  // zones
  @Get('zones') @Auth() zones() { return this.svc.zones(); }
  @Post('zones') @Auth('admin') createZone(@CurrentUser() u: AuthUser, @Body() d: ZoneDto) { return this.svc.createZone(u.id, d.name, d.description); }

  // audit trail
  @Get('activity-logs') @Auth('admin') activity(@Query() q: ActivityQuery) { return this.svc.activity(q); }

  // own notification feed (GA Head sees negative feedback / backdated attempts here)
  @Get('notifications') @Auth() notifs(@CurrentUser() u: AuthUser, @Query('unread') unread?: string) { return this.svc.myNotifications(u.id, unread === 'true'); }
  @Patch('notifications/read-all') @Auth() readAll(@CurrentUser() u: AuthUser) { return this.svc.markRead(u.id); }
  @Delete('notifications/:id') @Auth() delOne(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.deleteNotifications(u.id, id); }
  @Delete('notifications') @Auth() delRead(@CurrentUser() u: AuthUser) { return this.svc.deleteNotifications(u.id); }
  @Patch('notifications/:id/read') @Auth() readOne(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.markRead(u.id, id); }
}

@Module({ controllers: [AdminController], providers: [AdminService], exports: [AdminService] })
export class AdminModule {}

import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min, MaxLength, ValidateNested } from 'class-validator';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { PageQuery } from '../common/paging';
import { InventoryService } from './inventory.service';

const STAFF = ['admin', 'ga_head', 'supervisor'] as const;
const MGR = ['admin', 'ga_head'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const qty = () => Type(() => Number);

class StockQuery extends PageQuery {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() sparePartId?: string;
  @IsOptional() @IsIn(['true', 'false']) low?: string;
}
class MoveQuery extends PageQuery {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() sparePartId?: string;
  @IsOptional() @Matches(YMD) from?: string;
  @IsOptional() @Matches(YMD) to?: string;
  @IsOptional() @IsIn(['stock_in', 'stock_out', 'transfer_in', 'transfer_out', 'audit_adjustment']) type?: string;
}
class StockInDto {
  @IsUUID() warehouseId: string; @IsUUID() sparePartId: string;
  @qty() @IsInt() @Min(1) quantity: number;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @qty() @IsInt() @Min(0) reorderThreshold?: number;
}
class StockOutDto {
  @IsUUID() warehouseId: string; @IsUUID() sparePartId: string;
  @qty() @IsInt() @Min(1) quantity: number;
  @IsString() @MaxLength(300) reason: string;
  @IsOptional() @IsUUID() engineerId?: string;
  @IsOptional() @IsUUID() jobId?: string;
}
class TransferDto {
  @IsUUID() fromWarehouseId: string; @IsUUID() toWarehouseId: string; @IsUUID() sparePartId: string;
  @qty() @IsInt() @Min(1) quantity: number;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
class ThresholdDto { @IsUUID() warehouseId: string; @IsUUID() sparePartId: string; @qty() @IsInt() @Min(0) reorderThreshold: number; }
class DefectiveDto {
  @IsUUID() warehouseId: string; @IsUUID() sparePartId: string;
  @qty() @IsInt() @Min(1) quantity: number;
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class ReturnsQuery extends PageQuery { @IsOptional() @IsIn(['pending', 'done']) status?: string; }
class DefectiveQuery extends PageQuery { @IsOptional() @IsIn(['logged', 'replacement_initiated', 'disposed']) status?: string; }
class DefectiveStatusDto { @IsIn(['replacement_initiated', 'disposed']) status: 'replacement_initiated' | 'disposed'; }
class PoItem { @IsUUID() sparePartId: string; @qty() @IsInt() @Min(1) quantity: number; }
class PoDto {
  @IsUUID() warehouseId: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PoItem) items: PoItem[];
}
class PoQuery extends PageQuery { @IsOptional() @IsIn(['ordered', 'in_transit', 'received']) status?: string; }
class ReceiveLine { @IsUUID() itemId: string; @qty() @IsInt() @Min(1) quantity: number; }
class ReceiveDto { @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReceiveLine) lines: ReceiveLine[]; }
class AuditLine { @IsUUID() sparePartId: string; @qty() @IsInt() @Min(0) physicalCount: number; }
class AuditDto {
  @IsUUID() warehouseId: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() applyAdjustments?: boolean;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AuditLine) items: AuditLine[];
}
class AuditQuery { @IsOptional() @IsUUID() warehouseId?: string; }
class ConsumptionQuery {
  @IsOptional() @Matches(YMD) from?: string;
  @IsOptional() @Matches(YMD) to?: string;
  @IsOptional() @IsIn(['part', 'engineer', 'job']) by?: 'part' | 'engineer' | 'job';
}

@Controller()
export class InventoryController {
  constructor(private svc: InventoryService) {}

  @Get('inventory/summary') @Auth(...STAFF) summary() { return this.svc.summary(); }
  @Get('inventory/stock') @Auth(...STAFF) stock(@Query() q: StockQuery) { return this.svc.stock(q); }
  @Get('inventory/movements') @Auth(...STAFF) movements(@Query() q: MoveQuery) { return this.svc.movements(q); }

  @Post('inventory/stock-in') @Auth(...MGR) stockIn(@CurrentUser() u: AuthUser, @Body() d: StockInDto) { return this.svc.stockIn(u.id, d); }
  @Post('inventory/stock-out') @Auth(...MGR) stockOut(@CurrentUser() u: AuthUser, @Body() d: StockOutDto) { return this.svc.stockOut(u.id, d); }
  @Post('inventory/transfer') @Auth(...MGR) transfer(@CurrentUser() u: AuthUser, @Body() d: TransferDto) { return this.svc.transfer(u.id, d); }
  @Post('inventory/threshold') @Auth(...MGR) threshold(@CurrentUser() u: AuthUser, @Body() d: ThresholdDto) { return this.svc.setThreshold(u.id, d); }

  @Get('inventory/defective') @Auth(...STAFF) defective(@Query() q: DefectiveQuery) { return this.svc.listDefective(q); }
  @Get('inventory/returns') @Auth('admin', 'ga_head', 'supervisor')
  returns(@Query() q: ReturnsQuery) { return this.svc.listReturns(q); }

  @Post('inventory/returns/:id/receive') @Auth('admin', 'ga_head', 'supervisor')
  receiveReturn(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.receiveReturn(u, id); }

  @Post('inventory/defective') @Auth('engineer', ...MGR) logDefective(@CurrentUser() u: AuthUser, @Body() d: DefectiveDto) { return this.svc.logDefective(u.id, d); }
  @Patch('inventory/defective/:id') @Auth(...MGR)
  updateDefective(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: DefectiveStatusDto) { return this.svc.updateDefective(u.id, id, d.status); }

  @Get('purchase-orders') @Auth(...STAFF) pos(@Query() q: PoQuery) { return this.svc.listPos(q); }
  @Post('purchase-orders') @Auth(...MGR) createPo(@CurrentUser() u: AuthUser, @Body() d: PoDto) { return this.svc.createPo(u.id, d); }
  @Post('purchase-orders/:id/in-transit') @Auth(...MGR) inTransit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.markInTransit(u.id, id); }
  @Post('purchase-orders/:id/receive') @Auth(...MGR)
  receive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReceiveDto) { return this.svc.receivePo(u.id, id, d.lines); }

  @Get('inventory/audits') @Auth(...STAFF) audits(@Query() q: AuditQuery) { return this.svc.listAudits(q.warehouseId); }
  @Post('inventory/audits') @Auth(...MGR) createAudit(@CurrentUser() u: AuthUser, @Body() d: AuditDto) { return this.svc.createAudit(u.id, d); }
  @Get('inventory/audits/:id') @Auth(...STAFF) audit(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getAudit(id); }

  @Get('inventory/reports/consumption') @Auth(...STAFF) consumption(@Query() q: ConsumptionQuery) { return this.svc.consumption(q); }
  @Get('inventory/reports/pending-orders') @Auth(...STAFF) pending() { return this.svc.pendingOrders(); }
}

@Module({ controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}

import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { PageQuery } from '../common/paging';
import { ProductsService } from './products.service';

class NameDto { @IsString() name: string; }
class LinkPartDto { @IsUUID() sparePartId: string; }
class TypeDto { @IsUUID() brandId: string; @IsString() name: string; }
class VariantDto { @IsUUID() productTypeId: string; @IsString() name: string; }
class ModelDto { @IsUUID() productVariantId: string; @IsString() name: string; @IsOptional() @IsObject() specs?: Record<string, unknown>; }
class ModelUpdateDto { @IsOptional() @IsString() name?: string; @IsOptional() @IsObject() specs?: Record<string, unknown>; }
class PartQuery extends PageQuery { @IsOptional() @IsString() category?: string; }
class PartDto {
  @IsString() partNumber: string;
  @IsString() name: string;
  @IsOptional() @IsString() hsnCode?: string;
  @IsOptional() @IsString() jobCategory?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() description?: string;
}
class PartUpdateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() hsnCode?: string;
  @IsOptional() @IsString() jobCategory?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() description?: string;
}
class WarehouseDto {
  @IsString() name: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsUUID() managerUserId?: string;
}
class WarehouseUpdateDto {
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsUUID() managerUserId?: string;
}

const READ = ['admin', 'ga_head', 'supervisor', 'engineer'] as const;

@Controller('catalog')
export class CatalogController {
  constructor(private svc: ProductsService) {}

  @Get('tree') @Auth(...READ) tree() { return this.svc.tree(); }

  @Get('brands') @Auth(...READ) brands(@Query() q: PageQuery) { return this.svc.brands(q); }
  @Post('brands') @Auth('admin') addBrand(@CurrentUser() u: AuthUser, @Body() d: NameDto) { return this.svc.createBrand(u.id, d.name); }
  @Post('brands/:id/deactivate') @Auth('admin') offBrand(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setActive(u.id, 'brand', id, false); }

  @Get('types') @Auth(...READ) types(@Query('brandId') brandId?: string) { return this.svc.productTypes(brandId); }
  @Post('types') @Auth('admin') addType(@CurrentUser() u: AuthUser, @Body() d: TypeDto) { return this.svc.createType(u.id, d.brandId, d.name); }
  @Post('types/:id/deactivate') @Auth('admin') offType(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setActive(u.id, 'productType', id, false); }

  @Get('variants') @Auth(...READ) variants(@Query('productTypeId') t?: string) { return this.svc.variants(t); }
  @Post('variants') @Auth('admin') addVariant(@CurrentUser() u: AuthUser, @Body() d: VariantDto) { return this.svc.createVariant(u.id, d.productTypeId, d.name); }
  @Post('variants/:id/deactivate') @Auth('admin') offVariant(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setActive(u.id, 'productVariant', id, false); }

  // quick lookup by model number during service (PRD 02.4)
  @Get('models') @Auth(...READ) models(@Query() q: PageQuery, @Query('variantId') v?: string) { return this.svc.models(q, v); }
  @Get('models/:id') @Auth(...READ) model(@Param('id', ParseUUIDPipe) id: string) { return this.svc.model(id); }
  @Get('models/:id/ownership') @Auth('admin', 'ga_head', 'supervisor') ownership(@Param('id', ParseUUIDPipe) id: string) { return this.svc.modelOwnership(id); }
  @Get('models/:id/parts') @Auth(...READ) modelParts(@Param('id', ParseUUIDPipe) id: string) { return this.svc.modelParts(id); }
  @Post('models/:id/parts') @Auth('admin') linkPart(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: LinkPartDto) { return this.svc.addModelPart(u.id, id, d.sparePartId); }
  @Delete('models/:id/parts/:partId') @Auth('admin') unlinkPart(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('partId', ParseUUIDPipe) partId: string) { return this.svc.removeModelPart(u.id, id, partId); }
  @Post('models') @Auth('admin') addModel(@CurrentUser() u: AuthUser, @Body() d: ModelDto) { return this.svc.createModel(u.id, d.productVariantId, d.name, d.specs); }
  @Patch('models/:id') @Auth('admin') editModel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ModelUpdateDto) { return this.svc.updateModel(u.id, id, d); }
  @Post('models/:id/deactivate') @Auth('admin') offModel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setActive(u.id, 'productModel', id, false); }
}

@Controller('spare-parts')
export class SparePartsController {
  constructor(private svc: ProductsService) {}

  @Get() @Auth(...READ) list(@Query() q: PartQuery) { return this.svc.parts(q); }
  @Get(':id/models') @Auth(...READ) models(@Param('id', ParseUUIDPipe) id: string) { return this.svc.partModels(id); }
  @Post() @Auth('admin') create(@CurrentUser() u: AuthUser, @Body() d: PartDto) { return this.svc.createPart(u.id, d); }
  @Patch(':id') @Auth('admin') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: PartUpdateDto) { return this.svc.updatePart(u.id, id, d); }
  @Post(':id/deactivate') @Auth('admin') off(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setPartActive(u.id, id, false); }
  @Post(':id/activate') @Auth('admin') on(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setPartActive(u.id, id, true); }
}

@Controller('warehouses')
export class WarehousesController {
  constructor(private svc: ProductsService) {}

  @Get() @Auth('admin', 'ga_head', 'supervisor') list() { return this.svc.warehouses(); }
  @Post() @Auth('admin') create(@CurrentUser() u: AuthUser, @Body() d: WarehouseDto) { return this.svc.createWarehouse(u.id, d); }
  @Patch(':id') @Auth('admin') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: WarehouseUpdateDto) { return this.svc.updateWarehouse(u.id, id, d); }
}

@Module({
  controllers: [CatalogController, SparePartsController, WarehousesController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}

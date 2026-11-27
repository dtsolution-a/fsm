import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PageQuery, pageArgs, paged } from '../common/paging';

const activeWhere = (q: PageQuery) => (q.active ? { isActive: q.active === 'true' } : {});
const nm = (s: string) => s.replace(/\s+/g, ' ').trim();

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ───────── Brand → Product Type → Variant → Model (doc 08 section 3) ─────────
  async brands(q: PageQuery) {
    const where: Prisma.BrandWhereInput = { ...activeWhere(q), ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}) };
    return this.prisma.brand.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { productTypes: true } } } });
  }

  async tree() {
    return this.prisma.brand.findMany({
      where: { isActive: true }, orderBy: { name: 'asc' },
      include: { productTypes: { where: { isActive: true }, orderBy: { name: 'asc' },
        include: { variants: { where: { isActive: true }, orderBy: { name: 'asc' }, include: { _count: { select: { models: true } } } } } } },
    });
  }

  async productTypes(brandId?: string) {
    return this.prisma.productType.findMany({
      where: brandId ? { brandId } : {}, orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }],
      include: { brand: { select: { id: true, name: true } }, _count: { select: { variants: true } } },
    });
  }

  async variants(productTypeId?: string) {
    return this.prisma.productVariant.findMany({
      where: productTypeId ? { productTypeId } : {}, orderBy: { name: 'asc' },
      include: { productType: { select: { id: true, name: true, brand: { select: { name: true } } } }, _count: { select: { models: true } } },
    });
  }

  async models(q: PageQuery, variantId?: string) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.ProductModelWhereInput = {
      ...activeWhere(q),
      ...(variantId ? { productVariantId: variantId } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.productModel.findMany({
        where, skip, take, orderBy: { name: 'asc' },
        include: { variant: { select: { name: true, productType: { select: { name: true, brand: { select: { name: true } } } } } } },
      }),
      this.prisma.productModel.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async model(id: string) {
    const m = await this.prisma.productModel.findUnique({
      where: { id },
      include: { variant: { include: { productType: { include: { brand: true } } } }, _count: { select: { siteProducts: true } } },
    });
    if (!m) throw new NotFoundException('Model not found');
    return m;
  }

  // Every unit of a model installed across clients/sites (product-wise customer ownership report, PRD 02.2)
  async modelOwnership(id: string) {
    await this.model(id);
    return this.prisma.siteProduct.findMany({
      where: { productModelId: id },
      include: { site: { select: { siteName: true, client: { select: { id: true, companyName: true } } } }, contracts: { include: { contractType: true } } },
    });
  }

  async createBrand(actor: string, name: string) {
    const n = nm(name);
    if (await this.prisma.brand.findFirst({ where: { name: { equals: n, mode: 'insensitive' } } })) throw new BadRequestException('Brand already exists');
    const b = await this.prisma.brand.create({ data: { name: n } });
    await this.audit.log(actor, 'brand', b.id, 'create', undefined, b);
    return b;
  }

  async createType(actor: string, brandId: string, name: string) {
    const n = nm(name);
    if (!(await this.prisma.brand.findUnique({ where: { id: brandId } }))) throw new NotFoundException('Brand not found');
    if (await this.prisma.productType.findFirst({ where: { brandId, name: { equals: n, mode: 'insensitive' } } })) throw new BadRequestException('Product type already exists for this brand');
    const t = await this.prisma.productType.create({ data: { brandId, name: n } });
    await this.audit.log(actor, 'product_type', t.id, 'create', undefined, t);
    return t;
  }

  async createVariant(actor: string, productTypeId: string, name: string) {
    const n = nm(name);
    if (!(await this.prisma.productType.findUnique({ where: { id: productTypeId } }))) throw new NotFoundException('Product type not found');
    if (await this.prisma.productVariant.findFirst({ where: { productTypeId, name: { equals: n, mode: 'insensitive' } } })) throw new BadRequestException('Variant already exists');
    const v = await this.prisma.productVariant.create({ data: { productTypeId, name: n } });
    await this.audit.log(actor, 'product_variant', v.id, 'create', undefined, v);
    return v;
  }

  async createModel(actor: string, productVariantId: string, name: string, specs?: any) {
    const n = nm(name);
    if (!(await this.prisma.productVariant.findUnique({ where: { id: productVariantId } }))) throw new NotFoundException('Variant not found');
    if (await this.prisma.productModel.findFirst({ where: { productVariantId, name: { equals: n, mode: 'insensitive' } } })) throw new BadRequestException('Model already exists');
    const m = await this.prisma.productModel.create({ data: { productVariantId, name: n, specs } });
    await this.audit.log(actor, 'product_model', m.id, 'create', undefined, m);
    return m;
  }

  async updateModel(actor: string, id: string, dto: { name?: string; specs?: any }) {
    const before = await this.model(id);
    const after = await this.prisma.productModel.update({ where: { id }, data: { ...(dto.name ? { name: nm(dto.name) } : {}), ...(dto.specs !== undefined ? { specs: dto.specs } : {}) } });
    await this.audit.log(actor, 'product_model', id, 'update', before, after);
    return after;
  }

  // deactivate, never delete (history keeps referencing it)
  async setActive(actor: string, kind: 'brand' | 'productType' | 'productVariant' | 'productModel', id: string, isActive: boolean) {
    const delegate: any = (this.prisma as any)[kind];
    const before = await delegate.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Not found');
    const after = await delegate.update({ where: { id }, data: { isActive } });
    await this.audit.log(actor, kind, id, 'deactivate', before, after);
    return after;
  }

  // ───────── Which spare parts fit which model (PRD 02.4 / 05.1) ─────────
  async modelParts(modelId: string) {
    await this.model(modelId);
    const rows = await this.prisma.productCompatiblePart.findMany({ where: { productModelId: modelId }, include: { sparePart: true }, orderBy: { sparePart: { partNumber: 'asc' } } });
    return rows.map((r) => r.sparePart);
  }

  async addModelPart(actor: string, modelId: string, sparePartId: string) {
    await this.model(modelId);
    const part = await this.prisma.sparePart.findUnique({ where: { id: sparePartId } });
    if (!part) throw new NotFoundException('Spare part not found');
    const exists = await this.prisma.productCompatiblePart.findUnique({ where: { productModelId_sparePartId: { productModelId: modelId, sparePartId } } });
    if (exists) throw new BadRequestException('This part is already linked to the model');
    await this.prisma.productCompatiblePart.create({ data: { productModelId: modelId, sparePartId } });
    await this.audit.log(actor, 'product_model', modelId, 'update', undefined, { linkedPart: part.partNumber });
    return part;
  }

  async removeModelPart(actor: string, modelId: string, sparePartId: string) {
    const r = await this.prisma.productCompatiblePart.deleteMany({ where: { productModelId: modelId, sparePartId } });
    if (!r.count) throw new NotFoundException('That part is not linked to this model');
    await this.audit.log(actor, 'product_model', modelId, 'update', { unlinkedPart: sparePartId }, undefined);
    return { removed: r.count };
  }

  async partModels(sparePartId: string) {
    const rows = await this.prisma.productCompatiblePart.findMany({
      where: { sparePartId },
      include: { model: { include: { variant: { include: { productType: { include: { brand: true } } } } } } },
    });
    return rows.map((r) => r.model);
  }

  // ───────── Spare parts catalog ─────────
  async parts(q: PageQuery & { category?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.SparePartWhereInput = {
      ...activeWhere(q),
      ...(q.category ? { jobCategory: { equals: q.category, mode: 'insensitive' } } : {}),
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { partNumber: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.sparePart.findMany({ where, skip, take, orderBy: { partNumber: 'asc' } }),
      this.prisma.sparePart.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async createPart(actor: string, dto: any) {
    if (await this.prisma.sparePart.findUnique({ where: { partNumber: dto.partNumber } })) throw new BadRequestException('Part number already exists');
    const p = await this.prisma.sparePart.create({ data: dto });
    await this.audit.log(actor, 'spare_part', p.id, 'create', undefined, p);
    return p;
  }

  async updatePart(actor: string, id: string, dto: any) {
    const before = await this.prisma.sparePart.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Part not found');
    const after = await this.prisma.sparePart.update({ where: { id }, data: dto });
    await this.audit.log(actor, 'spare_part', id, 'update', before, after);
    return after;
  }

  async setPartActive(actor: string, id: string, isActive: boolean) {
    const before = await this.prisma.sparePart.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Part not found');
    const after = await this.prisma.sparePart.update({ where: { id }, data: { isActive } });
    await this.audit.log(actor, 'spare_part', id, 'deactivate', before, after);
    return after;
  }

  // ───────── Warehouses (master) ─────────
  warehouses() { return this.prisma.warehouse.findMany({ orderBy: { name: 'asc' }, include: { manager: { select: { id: true, fullName: true } } } }); }

  async createWarehouse(actor: string, dto: any) {
    const w = await this.prisma.warehouse.create({ data: dto });
    await this.audit.log(actor, 'warehouse', w.id, 'create', undefined, w);
    return w;
  }

  async updateWarehouse(actor: string, id: string, dto: any) {
    const before = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Warehouse not found');
    const after = await this.prisma.warehouse.update({ where: { id }, data: dto });
    await this.audit.log(actor, 'warehouse', id, 'update', before, after);
    return after;
  }
}

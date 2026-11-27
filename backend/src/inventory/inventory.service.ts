import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PageQuery, pageArgs, paged } from '../common/paging';
import { NotificationsService } from '../notifications/notifications.service';
import { jobZoneScope } from '../common/scope';
import { AuthUser } from '../auth/jwt.strategy';

type Tx = Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService, private audit: AuditService, private notifications: NotificationsService) {}

  // ───────── unused spares coming back to a hub ─────────
  // Allocation does not take stock out, only use does, so a return needs no stock change: it is confirmed so the office knows the parts are back.
  async listReturns(q: PageQuery & { status?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.JobPartUsedWhereInput = { returnQty: { gt: 0 }, returnedAt: q.status === 'done' ? { not: null } : null, job: jobZoneScope(), ...(q.search ? { OR: [{ job: { jobNumber: { contains: q.search, mode: 'insensitive' } } }, { sparePart: { name: { contains: q.search, mode: 'insensitive' } } }, { engineer: { user: { fullName: { contains: q.search, mode: 'insensitive' } } } }] } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.jobPartUsed.findMany({ where, orderBy: { consumedAt: 'asc' }, skip, take, include: { sparePart: { select: { name: true, partNumber: true } }, engineer: { select: { user: { select: { fullName: true, phone: true } } } }, job: { select: { id: true, jobNumber: true, client: { select: { companyName: true } } } } } }),
      this.prisma.jobPartUsed.count({ where }),
    ]);
    const whs = await this.prisma.warehouse.findMany({ where: { id: { in: rows.map((r) => r.warehouseId).filter(Boolean) as string[] } }, select: { id: true, name: true, city: true } });
    return paged(rows.map((r) => ({ id: r.id, quantity: r.returnQty, part: r.sparePart, engineer: r.engineer.user, job: r.job, hub: whs.find((w) => w.id === r.warehouseId) ?? null, since: r.consumedAt, returnedAt: r.returnedAt })), total, page, limit);
  }

  async receiveReturn(user: AuthUser, id: string) {
    const r = await this.prisma.jobPartUsed.findFirst({ where: { id, returnQty: { gt: 0 }, job: jobZoneScope() }, include: { sparePart: { select: { name: true } }, job: { select: { jobNumber: true } } } });
    if (!r) throw new NotFoundException('Nothing to receive here');
    if (r.returnedAt) throw new ConflictException('Already received');
    await this.prisma.jobPartUsed.update({ where: { id }, data: { returnedAt: new Date(), returnedBy: user.id } });
    await this.audit.log(user.id, 'job_part_return', id, 'update', undefined, { job: r.job.jobNumber, part: r.sparePart.name, quantity: r.returnQty });
    return { ok: true };
  }

  // One place that changes stock: row + movement log together, so the log always explains the number (06.2).
  private async move(tx: Tx, a: {
    warehouseId: string; sparePartId: string; type: StockMovementType; qty: number; field?: 'availableQty' | 'pendingQty' | 'defectiveQty';
    reason?: string; refType?: string; refId?: string; by?: string | null; log?: boolean;
  }) {
    const field = a.field || 'availableQty';
    const stock = await tx.inventoryStock.upsert({
      where: { warehouseId_sparePartId: { warehouseId: a.warehouseId, sparePartId: a.sparePartId } },
      update: {}, create: { warehouseId: a.warehouseId, sparePartId: a.sparePartId },
    });
    const next = stock[field] + a.qty;
    if (next < 0) throw new BadRequestException(`Not enough ${field.replace('Qty', '')} stock (have ${stock[field]}, need ${-a.qty})`);
    await tx.inventoryStock.update({ where: { id: stock.id }, data: { [field]: next } });
    if (a.log !== false) {
      await tx.stockMovement.create({
        data: { warehouseId: a.warehouseId, sparePartId: a.sparePartId, movementType: a.type, quantity: a.qty, reason: a.reason, referenceType: a.refType, referenceId: a.refId, recordedBy: a.by ?? undefined },
      });
    }
    return { before: stock[field], after: next, threshold: stock.reorderThreshold, available: field === 'availableQty' ? next : stock.availableQty };
  }

  private async lowStockCheck(warehouseId: string, sparePartId: string) {
    const s = await this.prisma.inventoryStock.findUnique({ where: { warehouseId_sparePartId: { warehouseId, sparePartId } }, include: { sparePart: true, warehouse: true } });
    if (s && s.reorderThreshold > 0 && s.availableQty <= s.reorderThreshold) {
      await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'low_stock',
        { part: s.sparePart.partNumber, warehouse: s.warehouse.name, available: s.availableQty, threshold: s.reorderThreshold } as Prisma.InputJsonValue,
        `${s.sparePart.name}: ${s.availableQty} left at ${s.warehouse.name} (reorder at ${s.reorderThreshold})`);
    }
  }

  // ───────── read ─────────
  async stock(q: PageQuery & { warehouseId?: string; sparePartId?: string; low?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.InventoryStockWhereInput = {};
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.sparePartId) where.sparePartId = q.sparePartId;
    if (q.search) where.sparePart = { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { partNumber: { contains: q.search, mode: 'insensitive' } }] };
    // available / pending / defective are separate columns and never merged (PRD rule 3)
    let rows = await this.prisma.inventoryStock.findMany({
      where, include: { sparePart: { select: { id: true, partNumber: true, name: true, unit: true } }, warehouse: { select: { id: true, name: true } } },
      orderBy: [{ sparePart: { name: 'asc' } }],
    });
    if (q.low === 'true') rows = rows.filter((r) => r.reorderThreshold > 0 && r.availableQty <= r.reorderThreshold);
    const total = rows.length;
    return paged(rows.slice(skip, skip + take), total, page, limit);
  }

  async summary() {
    const rows = await this.prisma.inventoryStock.groupBy({ by: ['warehouseId'], _sum: { availableQty: true, pendingQty: true, defectiveQty: true }, _count: true });
    const wh = await this.prisma.warehouse.findMany({ select: { id: true, name: true } });
    const all = await this.prisma.inventoryStock.findMany({ select: { availableQty: true, reorderThreshold: true } });
    return {
      lowStockLines: all.filter((r) => r.reorderThreshold > 0 && r.availableQty <= r.reorderThreshold).length,
      warehouses: rows.map((r) => ({ warehouseId: r.warehouseId, name: wh.find((w) => w.id === r.warehouseId)?.name, lines: r._count, available: r._sum.availableQty || 0, pending: r._sum.pendingQty || 0, defective: r._sum.defectiveQty || 0 })),
    };
  }

  async movements(q: PageQuery & { warehouseId?: string; sparePartId?: string; from?: string; to?: string; type?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.StockMovementWhereInput = {};
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    if (q.sparePartId) where.sparePartId = q.sparePartId;
    if (q.type) where.movementType = q.type as StockMovementType;
    if (q.from || q.to) where.createdAt = { gte: q.from ? new Date(`${q.from}T00:00:00+05:30`) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59+05:30`) : undefined };
    if (q.search) where.sparePart = { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { partNumber: { contains: q.search, mode: 'insensitive' } }] };
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { sparePart: { select: { partNumber: true, name: true } }, warehouse: { select: { name: true } } } }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  // ───────── stock in / out / transfer (06.2, 5.2) ─────────
  private async assertRefs(warehouseId: string, sparePartId: string) {
    const [w, p] = await Promise.all([this.prisma.warehouse.findUnique({ where: { id: warehouseId } }), this.prisma.sparePart.findUnique({ where: { id: sparePartId } })]);
    if (!w || !w.isActive) throw new NotFoundException('Warehouse not found or inactive');
    if (!p) throw new NotFoundException('Spare part not found');
  }

  async stockIn(actorId: string, d: { warehouseId: string; sparePartId: string; quantity: number; reason?: string; reorderThreshold?: number }) {
    await this.assertRefs(d.warehouseId, d.sparePartId);
    const r = await this.prisma.$transaction(async (tx) => {
      const m = await this.move(tx, { warehouseId: d.warehouseId, sparePartId: d.sparePartId, type: 'stock_in', qty: d.quantity, reason: d.reason || 'Stock received', by: actorId });
      if (d.reorderThreshold !== undefined) await tx.inventoryStock.update({ where: { warehouseId_sparePartId: { warehouseId: d.warehouseId, sparePartId: d.sparePartId } }, data: { reorderThreshold: d.reorderThreshold } });
      return m;
    });
    await this.audit.log(actorId, 'stock', d.sparePartId, 'update', { available: r.before }, { available: r.after, in: d.quantity, warehouseId: d.warehouseId });
    return r;
  }

  async stockOut(actorId: string, d: { warehouseId: string; sparePartId: string; quantity: number; reason: string; engineerId?: string; jobId?: string }) {
    await this.assertRefs(d.warehouseId, d.sparePartId);
    const r = await this.prisma.$transaction((tx) => this.move(tx, {
      warehouseId: d.warehouseId, sparePartId: d.sparePartId, type: 'stock_out', qty: -d.quantity, reason: d.reason,
      refType: d.jobId ? 'job' : d.engineerId ? 'engineer' : undefined, refId: d.jobId || d.engineerId, by: actorId,
    }));
    await this.audit.log(actorId, 'stock', d.sparePartId, 'update', { available: r.before }, { available: r.after, out: d.quantity, warehouseId: d.warehouseId, reason: d.reason });
    await this.lowStockCheck(d.warehouseId, d.sparePartId);
    return r;
  }

  async transfer(actorId: string, d: { fromWarehouseId: string; toWarehouseId: string; sparePartId: string; quantity: number; reason?: string }) {
    if (d.fromWarehouseId === d.toWarehouseId) throw new BadRequestException('Pick two different warehouses');
    await this.assertRefs(d.fromWarehouseId, d.sparePartId);
    await this.assertRefs(d.toWarehouseId, d.sparePartId);
    await this.prisma.$transaction(async (tx) => {
      await this.move(tx, { warehouseId: d.fromWarehouseId, sparePartId: d.sparePartId, type: 'transfer_out', qty: -d.quantity, reason: d.reason || 'Inter-warehouse transfer', by: actorId });
      await this.move(tx, { warehouseId: d.toWarehouseId, sparePartId: d.sparePartId, type: 'transfer_in', qty: d.quantity, reason: d.reason || 'Inter-warehouse transfer', by: actorId });
    });
    await this.audit.log(actorId, 'stock', d.sparePartId, 'update', undefined, { transfer: d });
    await this.lowStockCheck(d.fromWarehouseId, d.sparePartId);
    return { ok: true };
  }

  async setThreshold(actorId: string, d: { warehouseId: string; sparePartId: string; reorderThreshold: number }) {
    await this.assertRefs(d.warehouseId, d.sparePartId);
    const s = await this.prisma.inventoryStock.upsert({
      where: { warehouseId_sparePartId: { warehouseId: d.warehouseId, sparePartId: d.sparePartId } },
      update: { reorderThreshold: d.reorderThreshold }, create: { warehouseId: d.warehouseId, sparePartId: d.sparePartId, reorderThreshold: d.reorderThreshold },
    });
    await this.audit.log(actorId, 'stock', d.sparePartId, 'update', undefined, { reorderThreshold: d.reorderThreshold });
    await this.lowStockCheck(d.warehouseId, d.sparePartId);
    return s;
  }

  // Called when a job is completed: the consumed part leaves stock automatically (5.4).
  // If the warehouse is short we deduct what exists and alert, instead of blocking the engineer in the field.
  async consumeForJob(sparePartId: string, qty: number, warehouseId: string | null | undefined, jobId: string, jobNumber: string, actorId: string | null) {
    let wid = warehouseId || undefined;
    if (!wid) {
      const best = await this.prisma.inventoryStock.findFirst({ where: { sparePartId, availableQty: { gt: 0 } }, orderBy: { availableQty: 'desc' } });
      wid = best?.warehouseId;
    }
    if (!wid) {
      await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'low_stock', { jobNumber, sparePartId, shortfall: qty } as Prisma.InputJsonValue, `${jobNumber}: part used but no warehouse has stock to deduct from`);
      return { warehouseId: null, deducted: 0, shortfall: qty };
    }
    const stock = await this.prisma.inventoryStock.findUnique({ where: { warehouseId_sparePartId: { warehouseId: wid, sparePartId } } });
    const take = Math.min(stock?.availableQty ?? 0, qty);
    const short = qty - take;
    if (take > 0) {
      await this.prisma.$transaction((tx) => this.move(tx, { warehouseId: wid!, sparePartId, type: 'stock_out', qty: -take, reason: `Used on ${jobNumber}`, refType: 'job', refId: jobId, by: actorId }));
    }
    if (short > 0) {
      await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'low_stock', { jobNumber, sparePartId, shortfall: short } as Prisma.InputJsonValue, `${jobNumber}: ${short} unit(s) used but not in stock - check the register`);
    }
    await this.lowStockCheck(wid, sparePartId);
    return { warehouseId: wid, deducted: take, shortfall: short };
  }

  // ───────── defective items (5.3) ─────────
  async logDefective(actorId: string, d: { warehouseId: string; sparePartId: string; quantity: number; jobId?: string; notes?: string }) {
    await this.assertRefs(d.warehouseId, d.sparePartId);
    const row = await this.prisma.$transaction(async (tx) => {
      // defective stock is its own column: it never inflates the usable count
      await this.move(tx, { warehouseId: d.warehouseId, sparePartId: d.sparePartId, type: 'stock_in', qty: d.quantity, field: 'defectiveQty', reason: d.notes || 'Defective item returned', refType: d.jobId ? 'job' : undefined, refId: d.jobId, by: actorId, log: false });
      return tx.defectiveItem.create({ data: { warehouseId: d.warehouseId, sparePartId: d.sparePartId, quantity: d.quantity, jobId: d.jobId, notes: d.notes } });
    });
    await this.audit.log(actorId, 'defective_item', row.id, 'create', undefined, d);
    return row;
  }

  async listDefective(q: PageQuery & { status?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.DefectiveItemWhereInput = {};
    if (q.status) where.status = q.status as any;
    const [rows, total] = await Promise.all([
      this.prisma.defectiveItem.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { sparePart: { select: { partNumber: true, name: true } }, warehouse: { select: { name: true } }, job: { select: { jobNumber: true } } } }),
      this.prisma.defectiveItem.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async updateDefective(actorId: string, id: string, status: 'replacement_initiated' | 'disposed') {
    const d = await this.prisma.defectiveItem.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Defective item not found');
    if (d.status === 'disposed') throw new ConflictException('Already disposed');
    const row = await this.prisma.$transaction(async (tx) => {
      if (status === 'disposed') await this.move(tx, { warehouseId: d.warehouseId, sparePartId: d.sparePartId, type: 'stock_out', qty: -d.quantity, field: 'defectiveQty', by: actorId, log: false });
      return tx.defectiveItem.update({ where: { id }, data: { status } });
    });
    await this.audit.log(actorId, 'defective_item', id, 'update', { status: d.status }, { status });
    return row;
  }

  // ───────── purchase orders (5.5) ─────────
  async createPo(actorId: string, d: { warehouseId: string; items: { sparePartId: string; quantity: number }[] }) {
    const w = await this.prisma.warehouse.findUnique({ where: { id: d.warehouseId } });
    if (!w) throw new NotFoundException('Warehouse not found');
    if (new Set(d.items.map((i) => i.sparePartId)).size !== d.items.length) throw new BadRequestException('A part can only appear once per order');
    const parts = await this.prisma.sparePart.count({ where: { id: { in: d.items.map((i) => i.sparePartId) } } });
    if (parts !== d.items.length) throw new BadRequestException('One or more spare parts were not found');
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');
    for (let i = 0; ; i++) {
      try {
        const count = await this.prisma.purchaseOrder.count({ where: { poNumber: { startsWith: `PO-${day}-` } } });
        const po = await this.prisma.$transaction(async (tx) => {
          const created = await tx.purchaseOrder.create({
            data: { poNumber: `PO-${day}-${String(count + 1 + i).padStart(3, '0')}`, warehouseId: d.warehouseId, createdBy: actorId, items: { create: d.items.map((it) => ({ sparePartId: it.sparePartId, quantityOrdered: it.quantity })) } },
            include: { items: true },
          });
          // pending quantity stays visible until the goods are received (PRD rule 3)
          for (const it of d.items) await this.move(tx, { warehouseId: d.warehouseId, sparePartId: it.sparePartId, type: 'stock_in', qty: it.quantity, field: 'pendingQty', by: actorId, log: false });
          return created;
        });
        await this.audit.log(actorId, 'purchase_order', po.id, 'create', undefined, { poNumber: po.poNumber, items: d.items });
        return po;
      } catch (e: any) { if (e?.code === 'P2002' && i < 5) continue; throw e; }
    }
  }

  async listPos(q: PageQuery & { status?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (q.status) where.status = q.status as any;
    if (q.search) where.poNumber = { contains: q.search, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { warehouse: { select: { name: true } }, items: { include: { sparePart: { select: { partNumber: true, name: true } } } } } }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async markInTransit(actorId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== 'ordered') throw new BadRequestException(`Order is already ${po.status.replace('_', ' ')}`);
    const r = await this.prisma.purchaseOrder.update({ where: { id }, data: { status: 'in_transit' } });
    await this.audit.log(actorId, 'purchase_order', id, 'update', { status: po.status }, { status: 'in_transit' });
    return r;
  }

  // Received stock links to the PO and updates inventory (partial receipts allowed)
  async receivePo(actorId: string, id: string, lines: { itemId: string; quantity: number }[]) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'received') throw new ConflictException('This order is already fully received');
    await this.prisma.$transaction(async (tx) => {
      for (const l of lines) {
        const item = po.items.find((i) => i.id === l.itemId);
        if (!item) throw new BadRequestException('Line does not belong to this order');
        const remaining = item.quantityOrdered - item.quantityReceived;
        if (l.quantity > remaining) throw new BadRequestException(`Only ${remaining} still expected for this line`);
        await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { quantityReceived: { increment: l.quantity } } });
        await this.move(tx, { warehouseId: po.warehouseId, sparePartId: item.sparePartId, type: 'stock_in', qty: -l.quantity, field: 'pendingQty', by: actorId, log: false });
        await this.move(tx, { warehouseId: po.warehouseId, sparePartId: item.sparePartId, type: 'stock_in', qty: l.quantity, reason: `Received against ${po.poNumber}`, refType: 'purchase_order', refId: po.id, by: actorId });
      }
      const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
      const done = items.every((i) => i.quantityReceived >= i.quantityOrdered);
      await tx.purchaseOrder.update({ where: { id }, data: { status: done ? 'received' : 'in_transit' } });
    });
    await this.audit.log(actorId, 'purchase_order', id, 'update', undefined, { received: lines });
    return this.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: { include: { sparePart: { select: { partNumber: true, name: true } } } } } });
  }

  // ───────── stock audit & reconciliation (06.3) ─────────
  async createAudit(actorId: string, d: { warehouseId: string; notes?: string; applyAdjustments?: boolean; items: { sparePartId: string; physicalCount: number }[] }) {
    const w = await this.prisma.warehouse.findUnique({ where: { id: d.warehouseId } });
    if (!w) throw new NotFoundException('Warehouse not found');
    if (new Set(d.items.map((i) => i.sparePartId)).size !== d.items.length) throw new BadRequestException('A part can only be counted once per audit');
    const stocks = await this.prisma.inventoryStock.findMany({ where: { warehouseId: d.warehouseId, sparePartId: { in: d.items.map((i) => i.sparePartId) } } });
    const audit = await this.prisma.$transaction(async (tx) => {
      const a = await tx.stockAudit.create({
        data: {
          warehouseId: d.warehouseId, conductedBy: actorId, notes: d.notes,
          items: { create: d.items.map((i) => { const sys = stocks.find((s) => s.sparePartId === i.sparePartId)?.availableQty ?? 0; return { sparePartId: i.sparePartId, systemCount: sys, physicalCount: i.physicalCount, discrepancy: i.physicalCount - sys, flagged: i.physicalCount !== sys }; }) },
        },
        include: { items: true },
      });
      if (d.applyAdjustments) {
        for (const it of a.items.filter((x) => x.discrepancy !== 0)) {
          await this.move(tx, { warehouseId: d.warehouseId, sparePartId: it.sparePartId, type: 'audit_adjustment', qty: it.discrepancy, reason: `Stock audit ${a.id.slice(0, 8)}`, refType: 'stock_audit', refId: a.id, by: actorId });
        }
      }
      return a;
    });
    await this.audit.log(actorId, 'stock_audit', audit.id, 'create', undefined, { warehouseId: d.warehouseId, flagged: audit.items.filter((i) => i.flagged).length, applied: !!d.applyAdjustments });
    return audit;
  }

  async listAudits(warehouseId?: string) {
    const rows = await this.prisma.stockAudit.findMany({ where: { warehouseId }, orderBy: { conductedAt: 'desc' }, take: 100, include: { warehouse: { select: { name: true } }, items: { select: { flagged: true } } } });
    return rows.map((a) => ({ id: a.id, warehouse: a.warehouse.name, conductedAt: a.conductedAt, notes: a.notes, lines: a.items.length, discrepancies: a.items.filter((i) => i.flagged).length }));
  }

  async getAudit(id: string) {
    const a = await this.prisma.stockAudit.findUnique({ where: { id }, include: { warehouse: { select: { name: true } }, items: { include: { sparePart: { select: { partNumber: true, name: true } } } } } });
    if (!a) throw new NotFoundException('Audit not found');
    return a;
  }

  // ───────── reports (6.4) ─────────
  async consumption(q: { from?: string; to?: string; by?: 'part' | 'engineer' | 'job' }) {
    const where: Prisma.JobPartUsedWhereInput = { deductedAt: { not: null } };
    if (q.from || q.to) where.consumedAt = { gte: q.from ? new Date(`${q.from}T00:00:00+05:30`) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59+05:30`) : undefined };
    const rows = await this.prisma.jobPartUsed.findMany({ where, include: { sparePart: { select: { partNumber: true, name: true } }, job: { select: { jobNumber: true, siteProduct: { select: { rawProduct: true, model: { select: { name: true } } } } } }, engineer: { include: { user: { select: { fullName: true } } } } } });
    const map = new Map<string, { key: string; label: string; quantity: number; lines: number }>();
    for (const r of rows) {
      const k = q.by === 'engineer' ? r.engineerId : q.by === 'job' ? r.jobId : r.sparePartId;
      const label = q.by === 'engineer' ? r.engineer.user.fullName : q.by === 'job' ? r.job.jobNumber : `${r.sparePart.partNumber} - ${r.sparePart.name}`;
      const cur = map.get(k) || { key: k, label, quantity: 0, lines: 0 };
      cur.quantity += r.quantity; cur.lines += 1; map.set(k, cur);
    }
    return { by: q.by || 'part', rows: [...map.values()].sort((a, b) => b.quantity - a.quantity) };
  }

  async pendingOrders() {
    return this.prisma.purchaseOrder.findMany({ where: { status: { not: 'received' } }, orderBy: { createdAt: 'asc' }, include: { warehouse: { select: { name: true } }, items: { include: { sparePart: { select: { partNumber: true, name: true } } } } } });
  }
}

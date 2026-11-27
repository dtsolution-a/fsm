import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsObject } from 'class-validator';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { StorageService } from '../storage/storage.service';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { hasLevel } from '../access/levels';

/**
 * One place that knows how to view / edit / delete every kind of record, so every list in the app can offer the same three actions.
 *  - Edit: only the listed fields can be changed, each is checked by type.
 *  - Delete: allowed only when nothing else depends on the record. Otherwise the answer is 409 with the list of what blocks it,
 *    and (where the record has an active flag) the screen offers "Deactivate instead", which keeps the history.
 *  - Everything is audit-logged.
 */
type FieldType = 'text' | 'textarea' | 'email' | 'number' | 'int' | 'date' | 'zone';
interface Field { key: string; label: string; type: FieldType; required?: boolean; min?: number }
type Tx = Prisma.TransactionClient;
interface Blocker { label: string; model: string; where: (id: string, rec: any) => any }
interface Entity {
  label: string; model: string; module: string; title: (r: any) => string;
  fields: Field[]; editRoles: Role[]; deleteRoles: Role[];
  blockers?: Blocker[];
  cascade?: (tx: Tx, rec: any, files: string[]) => Promise<void>;       // children owned by the record, removed with it
  after?: (tx: Tx, rec: any) => Promise<void>;                            // tidy-up that must follow the delete
  editRule?: (rec: any) => string | null;                                 // null = may edit, text = reason it cannot
  deleteRule?: (rec: any, user: AuthUser) => string | null;
  include?: any;
  archive?: (tx: Tx, rec: any) => Promise<void>;                          // soft alternative that keeps history
  archived?: (rec: any) => boolean;
}
const A: Role[] = ['admin']; const AG: Role[] = ['admin', 'ga_head'];
const b = (label: string, model: string, where: (id: string, rec: any) => any): Blocker => ({ label, model, where });
const flag = (model: string) => async (tx: Tx, rec: any) => { await (tx as any)[model].update({ where: { id: rec.id }, data: { isActive: false } }); };
const inactive = (r: any) => r.isActive === false;
const f = (key: string, label: string, type: FieldType = 'text', extra: Partial<Field> = {}): Field => ({ key, label, type, ...extra });

const ENTITIES: Record<string, Entity> = {
  clients: {
    label: 'client', model: 'client', module: 'clients', title: (r) => r.companyName, editRoles: A, deleteRoles: A,
    fields: [f('companyName', 'Company name', 'text', { required: true }), f('legalName', 'Legal name'), f('contactPerson', 'Contact person'), f('phone', 'Phone'), f('email', 'Email', 'email')],
    blockers: [b('sites with machines', 'siteProduct', (id) => ({ site: { clientId: id } })), b('contracts', 'contract', (id) => ({ clientId: id })), b('service requests', 'serviceRequest', (id) => ({ clientId: id })),
      b('jobs', 'job', (id) => ({ clientId: id })), b('invoices', 'invoice', (id) => ({ clientId: id })), b('quotations', 'quotation', (id) => ({ clientId: id })), b('feedback entries', 'feedback', (id) => ({ clientId: id }))],
    cascade: async (tx, r) => { await tx.clientSite.deleteMany({ where: { clientId: r.id } }); }, // only empty sites remain at this point
    archive: flag('client'), archived: inactive,
  },
  sites: {
    label: 'site', model: 'clientSite', module: 'clients', title: (r) => r.siteName, editRoles: A, deleteRoles: A,
    fields: [f('siteName', 'Site name', 'text', { required: true }), f('address', 'Address', 'textarea'), f('city', 'City'), f('state', 'State'), f('pincode', 'Pincode'), f('siteContactName', 'Site contact name'), f('siteContactPhone', 'Site contact phone'), f('zoneId', 'Branch', 'zone'), f('latitude', 'Latitude', 'number'), f('longitude', 'Longitude', 'number')],
    blockers: [b('machines', 'siteProduct', (id) => ({ clientSiteId: id })), b('service requests', 'serviceRequest', (id) => ({ clientSiteId: id })), b('jobs', 'job', (id) => ({ clientSiteId: id }))],
    archive: flag('clientSite'), archived: inactive,
  },
  machines: {
    label: 'machine', model: 'siteProduct', module: 'clients', title: (r) => `${r.rawModel || 'Machine'} ${r.serialNumber || ''}`.trim(), editRoles: A, deleteRoles: A,
    fields: [f('serialNumber', 'Serial number'), f('rawModel', 'Model (as written)'), f('installationDate', 'Installation date', 'date'), f('warrantyExpiry', 'Warranty expiry', 'date')],
    blockers: [b('contracts', 'contract', (id) => ({ siteProductId: id })), b('jobs', 'job', (id) => ({ siteProductId: id })), b('service requests', 'serviceRequest', (id) => ({ siteProductId: id }))],
    archive: async (tx, r) => { await tx.siteProduct.update({ where: { id: r.id }, data: { decommissionedAt: new Date() } }); }, archived: (r) => !!r.decommissionedAt,
  },
  contracts: {
    label: 'contract', model: 'contract', module: 'clients', title: (r) => r.contractNumber, editRoles: AG, deleteRoles: A,
    fields: [f('externalContractNo', 'Contract no. (external)'), f('taxLabel', 'Tax'), f('amount', 'Amount (₹)', 'number', { min: 0 }), f('startDate', 'Start date', 'date'), f('endDate', 'End date', 'date'), f('visitFrequency', 'Visits per year', 'int', { min: 0 }), f('freeServicesTotal', 'Free services', 'int', { min: 0 }), f('freeServicesCompleted', 'Free services done', 'int', { min: 0 })],
    blockers: [b('jobs', 'job', (id) => ({ contractId: id }))],
    cascade: async (tx, r) => { await tx.contractServiceCost.deleteMany({ where: { contractId: r.id } }); await tx.contractRenewal.deleteMany({ where: { contractId: r.id } }); },
  },
  requests: {
    label: 'service request', model: 'serviceRequest', module: 'requests', title: (r) => r.ticketNumber, editRoles: AG, deleteRoles: AG,
    fields: [f('issueDescription', 'Issue', 'textarea'), f('contactName', 'Caller name'), f('contactPhone', 'Caller phone')],
    blockers: [b('jobs', 'job', (id) => ({ serviceRequestId: id }))],
    cascade: async (tx, r, files) => { const a = await tx.serviceRequestAttachment.findMany({ where: { serviceRequestId: r.id } }); a.forEach((x) => files.push(x.fileUrl)); await tx.serviceRequestAttachment.deleteMany({ where: { serviceRequestId: r.id } }); },
  },
  jobs: {
    label: 'job', model: 'job', module: 'jobs', title: (r) => r.jobNumber, editRoles: AG, deleteRoles: A, include: { status: true },
    fields: [f('description', 'Description', 'textarea')],
    deleteRule: (r) => (['open', 'assigned', 'rescheduled', 'cancelled'].includes(r.status?.code) ? null : 'Only a job that has not started (or is cancelled) can be deleted. Cancel it instead.'),
    blockers: [b('parts used', 'jobPartUsed', (id) => ({ jobId: id })), b('photos / signature', 'jobAttachment', (id) => ({ jobId: id })), b('invoices', 'invoice', (id) => ({ jobId: id })), b('quotations', 'quotation', (id) => ({ jobId: id }))],
    cascade: async (tx, r, files) => {
      const a = await tx.jobAttachment.findMany({ where: { jobId: r.id } }); a.forEach((x: any) => x.fileUrl && files.push(x.fileUrl));
      await tx.jobStatusHistory.deleteMany({ where: { jobId: r.id } }); await tx.jobEngineer.deleteMany({ where: { jobId: r.id } });
      await tx.job.updateMany({ where: { duplicateOfJobId: r.id }, data: { duplicateOfJobId: null } });
    },
    after: async (tx, r) => {
      if (r.serviceRequestId && !(await tx.job.count({ where: { serviceRequestId: r.serviceRequestId } }))) await tx.serviceRequest.update({ where: { id: r.serviceRequestId }, data: { status: 'open' } });
    },
  },
  quotations: {
    label: 'quotation', model: 'quotation', module: 'billing', title: (r) => r.quotationNumber, editRoles: AG, deleteRoles: AG,
    fields: [f('title', 'Title'), f('notes', 'Notes', 'textarea'), f('validUntil', 'Valid until', 'date')],
    editRule: (r) => (r.status === 'draft' ? null : 'Only a draft quotation can be edited.'),
    deleteRule: (r) => (['draft', 'rejected'].includes(r.status) ? null : 'Only a draft or rejected quotation can be deleted.'),
    blockers: [b('invoices', 'invoice', (id) => ({ quotationId: id }))],
  },
  invoices: {
    label: 'invoice', model: 'invoice', module: 'billing', title: (r) => r.invoiceNumber, editRoles: AG, deleteRoles: AG,
    fields: [f('notes', 'Notes', 'textarea'), f('dueDate', 'Due date', 'date')],
    editRule: (r) => (r.status === 'draft' ? null : 'Only a draft invoice can be edited. An issued invoice is cancelled, not changed.'),
    deleteRule: (r) => (r.status === 'draft' ? null : 'Only a draft invoice can be deleted. An issued invoice is cancelled, not deleted.'),
    blockers: [b('payments', 'payment', (id) => ({ invoiceId: id }))],
    cascade: async (tx, r) => { await tx.invoiceTaxLine.deleteMany({ where: { invoiceId: r.id } }); },
  },
  engineers: {
    label: 'engineer', model: 'engineer', module: 'people', title: (r) => r.user?.fullName ?? 'Engineer', editRoles: A, deleteRoles: A, include: { user: { select: { id: true, fullName: true, userCode: true } } },
    fields: [f('designation', 'Designation'), f('employeeCode', 'Employee code'), f('city', 'City'), f('dateOfJoining', 'Date of joining', 'date'), f('primaryZoneId', 'Branch', 'zone')],
    blockers: [b('job assignments', 'jobEngineer', (id) => ({ engineerId: id })), b('attendance days', 'attendanceRecord', (id) => ({ engineerId: id })), b('leave requests', 'leaveRequest', (id) => ({ engineerId: id })), b('parts used', 'jobPartUsed', (id) => ({ engineerId: id }))],
    cascade: async (tx, r) => { for (const m of ['engineerZone', 'engineerSkill', 'engineerLocation']) await (tx as any)[m].deleteMany({ where: { engineerId: r.id } }); },
    after: async (tx, r) => { await removeUserTraces(tx, r.userId); await tx.user.delete({ where: { id: r.userId } }); },
    archive: async (tx, r) => { await tx.engineer.update({ where: { id: r.id }, data: { isActive: false } }); await tx.user.update({ where: { id: r.userId }, data: { isActive: false } }); }, archived: inactive,
  },
  users: {
    label: 'user', model: 'user', module: 'admin', title: (r) => r.fullName, editRoles: A, deleteRoles: A, include: { engineer: true },
    fields: [f('fullName', 'Full name', 'text', { required: true }), f('phone', 'Phone'), f('email', 'Email', 'email'), f('legacyGroup', 'Designation')],
    deleteRule: (r, u) => (r.id === u.id ? 'You cannot delete your own account.' : r.role === 'admin' ? 'An admin account cannot be deleted. Deactivate it instead.' : null),
    blockers: [b('job assignments', 'jobEngineer', (_id, r) => ({ engineer: { userId: r.id } })), b('attendance days', 'attendanceRecord', (_id, r) => ({ engineer: { userId: r.id } })),
      b('leave requests', 'leaveRequest', (_id, r) => ({ engineer: { userId: r.id } })), b('parts used', 'jobPartUsed', (_id, r) => ({ engineer: { userId: r.id } })), b('warehouses managed', 'warehouse', (id) => ({ managerUserId: id }))],
    cascade: async (tx, r) => {
      if (r.engineer) { for (const m of ['engineerZone', 'engineerSkill', 'engineerLocation']) await (tx as any)[m].deleteMany({ where: { engineerId: r.engineer.id } }); await tx.engineer.delete({ where: { id: r.engineer.id } }); }
      await removeUserTraces(tx, r.id);
    },
    archive: async (tx, r) => { await tx.user.update({ where: { id: r.id }, data: { isActive: false } }); if (r.engineer) await tx.engineer.update({ where: { id: r.engineer.id }, data: { isActive: false } }); }, archived: inactive,
  },
  'spare-parts': {
    label: 'spare part', model: 'sparePart', module: 'inventory', title: (r) => `${r.name} (${r.partNumber})`, editRoles: A, deleteRoles: A,
    fields: [f('name', 'Name', 'text', { required: true }), f('hsnCode', 'HSN code'), f('unit', 'Unit'), f('jobCategory', 'Job category'), f('description', 'Description', 'textarea'), f('unitPrice', 'Unit price (₹)', 'number', { min: 0 })],
    blockers: [b('parts used in jobs', 'jobPartUsed', (id) => ({ sparePartId: id })), b('stock in a warehouse', 'inventoryStock', (id) => ({ sparePartId: id, OR: [{ availableQty: { gt: 0 } }, { pendingQty: { gt: 0 } }, { defectiveQty: { gt: 0 } }] })),
      b('purchase orders', 'purchaseOrderItem', (id) => ({ sparePartId: id })), b('stock movements', 'stockMovement', (id) => ({ sparePartId: id })), b('defective entries', 'defectiveItem', (id) => ({ sparePartId: id }))],
    cascade: async (tx, r) => { await tx.inventoryStock.deleteMany({ where: { sparePartId: r.id } }); await tx.productCompatiblePart.deleteMany({ where: { sparePartId: r.id } }); },
    archive: flag('sparePart'), archived: inactive,
  },
  warehouses: {
    label: 'warehouse', model: 'warehouse', module: 'inventory', title: (r) => r.name, editRoles: A, deleteRoles: A,
    fields: [f('name', 'Name', 'text', { required: true }), f('type', 'Type'), f('address', 'Address', 'textarea'), f('city', 'City'), f('state', 'State'), f('pincode', 'Pincode')],
    blockers: [b('stock', 'inventoryStock', (id) => ({ warehouseId: id, OR: [{ availableQty: { gt: 0 } }, { pendingQty: { gt: 0 } }, { defectiveQty: { gt: 0 } }] })), b('purchase orders', 'purchaseOrder', (id) => ({ warehouseId: id })),
      b('stock movements', 'stockMovement', (id) => ({ warehouseId: id })), b('parts used in jobs', 'jobPartUsed', (id) => ({ warehouseId: id })), b('defective entries', 'defectiveItem', (id) => ({ warehouseId: id }))],
    cascade: async (tx, r) => { await tx.inventoryStock.deleteMany({ where: { warehouseId: r.id } }); },
    archive: flag('warehouse'), archived: inactive,
  },
  brands: {
    label: 'brand', model: 'brand', module: 'catalog', title: (r) => r.name, editRoles: A, deleteRoles: A, fields: [f('name', 'Name', 'text', { required: true })],
    blockers: [b('product types', 'productType', (id) => ({ brandId: id }))], archive: flag('brand'), archived: inactive,
  },
  types: {
    label: 'product type', model: 'productType', module: 'catalog', title: (r) => r.name, editRoles: A, deleteRoles: A, fields: [f('name', 'Name', 'text', { required: true })],
    blockers: [b('variants', 'productVariant', (id) => ({ productTypeId: id })), b('spare parts', 'sparePart', (id) => ({ productTypeId: id }))], archive: flag('productType'), archived: inactive,
  },
  variants: {
    label: 'variant', model: 'productVariant', module: 'catalog', title: (r) => r.name, editRoles: A, deleteRoles: A, fields: [f('name', 'Name', 'text', { required: true })],
    blockers: [b('models', 'productModel', (id) => ({ productVariantId: id }))], archive: flag('productVariant'), archived: inactive,
  },
  models: {
    label: 'model', model: 'productModel', module: 'catalog', title: (r) => r.name, editRoles: A, deleteRoles: A, fields: [f('name', 'Name', 'text', { required: true })],
    blockers: [b('machines installed at customers', 'siteProduct', (id) => ({ productModelId: id }))],
    cascade: async (tx, r) => { await tx.productCompatiblePart.deleteMany({ where: { productModelId: r.id } }); }, archive: flag('productModel'), archived: inactive,
  },
  'leave-requests': {
    label: 'leave request', model: 'leaveRequest', module: 'people', title: (r) => 'Leave request', editRoles: AG, deleteRoles: AG,
    fields: [f('startDate', 'From', 'date', { required: true }), f('endDate', 'To', 'date', { required: true }), f('reason', 'Reason', 'textarea')],
    editRule: (r) => (r.status === 'pending' ? null : 'Only a pending request can be edited.'),
    deleteRule: (r) => (['pending', 'rejected'].includes(r.status) ? null : 'An approved leave stays on record. Reject or leave it as is.'),
  },
  zones: {
    label: 'branch (zone)', model: 'zone', module: 'admin', title: (r) => r.name, editRoles: A, deleteRoles: A,
    fields: [f('name', 'Name', 'text', { required: true }), f('description', 'Description', 'textarea')],
    blockers: [b('customer sites', 'clientSite', (id) => ({ zoneId: id })), b('people assigned', 'userZone', (id) => ({ zoneId: id })), b('engineers assigned', 'engineerZone', (id) => ({ zoneId: id })), b('engineers based here', 'engineer', (id) => ({ primaryZoneId: id })), b('branch records', 'branch', (id) => ({ zoneId: id }))],
  },
  messages: {
    label: 'message', model: 'outboundMessage', module: 'messages', title: (r) => r.subject || r.toAddress, editRoles: [], deleteRoles: AG, fields: [],
  },
};

async function removeUserTraces(tx: Tx, userId: string) {
  await tx.userZone.deleteMany({ where: { userId } }); await tx.userPermission.deleteMany({ where: { userId } });
  await tx.refreshToken.deleteMany({ where: { userId } }); await tx.deviceToken.deleteMany({ where: { userId } }); await tx.notification.deleteMany({ where: { recipientId: userId } });
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

@Injectable()
export class RecordsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private storage: StorageService) {}

  private entity(key: string): Entity {
    const e = ENTITIES[key];
    if (!e) throw new NotFoundException('Unknown record type');
    return e;
  }
  private delegate(e: Entity, tx: any = this.prisma) { return tx[e.model]; }
  private async load(e: Entity, id: string) {
    const rec = await this.delegate(e).findUnique({ where: { id }, ...(e.include ? { include: e.include } : {}) });
    if (!rec) throw new NotFoundException(`This ${e.label} no longer exists`);
    return rec;
  }
  private async blockers(e: Entity, rec: any) {
    const out: { label: string; count: number }[] = [];
    for (const bl of e.blockers ?? []) {
      const count = await (this.prisma as any)[bl.model].count({ where: bl.where(rec.id, rec) });
      if (count > 0) out.push({ label: bl.label, count });
    }
    return out;
  }
  private may(user: AuthUser, e: Entity, roles: Role[]) { return roles.includes(user.role) && hasLevel(user, e.module, 'manage'); }

  /** Everything the edit / delete dialogs need, in one call. */
  async describe(user: AuthUser, key: string, id: string) {
    const e = this.entity(key);
    const rec: any = await this.load(e, id);
    const zones = e.fields.some((x) => x.type === 'zone') ? await this.prisma.zone.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }) : [];
    const blockers = await this.blockers(e, rec);
    const editNote = !this.may(user, e, e.editRoles) ? 'You do not have permission to change this.' : e.editRule?.(rec) ?? null;
    const ruleNote = e.deleteRule?.(rec, user) ?? null;
    const mayDelete = this.may(user, e, e.deleteRoles);
    return {
      entity: key, label: e.label, title: e.title(rec),
      fields: e.fields.map((x) => ({ ...x, options: x.type === 'zone' ? zones.map((z) => ({ value: z.id, label: z.name })) : undefined })),
      values: Object.fromEntries(e.fields.map((x) => [x.key, x.type === 'date' ? ymd(rec[x.key]) : rec[x.key] == null ? '' : x.type === 'number' ? Number(rec[x.key]) : rec[x.key]])),
      canEdit: e.fields.length > 0 && editNote === null, editNote: e.fields.length ? editNote : 'This record cannot be edited.',
      canDelete: mayDelete && !ruleNote && blockers.length === 0,
      deleteNote: !mayDelete ? 'You do not have permission to delete this.' : ruleNote,
      blockers, canArchive: mayDelete && !!e.archive && !(e.archived?.(rec)), archived: !!e.archived?.(rec),
    };
  }

  async update(user: AuthUser, key: string, id: string, values: Record<string, unknown>) {
    const e = this.entity(key);
    if (!this.may(user, e, e.editRoles)) throw new ForbiddenException('You do not have permission to change this.');
    const rec: any = await this.load(e, id);
    const why = e.editRule?.(rec); if (why) throw new ConflictException(why);
    const data: Record<string, unknown> = {};
    for (const fld of e.fields) {
      if (!(fld.key in values)) continue;
      data[fld.key] = await this.coerce(fld, values[fld.key]);
    }
    if (key === 'sites' && ('latitude' in data || 'longitude' in data)) { data.geoSource = 'manual'; data.geoAt = new Date(); } // a position typed in by the office is trusted
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to change');
    try { await this.delegate(e).update({ where: { id }, data }); }
    catch (err: any) { if (err.code === 'P2002') throw new ConflictException('That value is already used by another record.'); throw err; }
    await this.audit.log(user.id, key, id, 'update', Object.fromEntries(Object.keys(data).map((k) => [k, rec[k]])), data);
    return this.describe(user, key, id);
  }

  private async coerce(fld: Field, raw: unknown): Promise<unknown> {
    const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
    if (empty) { if (fld.required) throw new BadRequestException(`${fld.label} is required`); return null; }
    const s = typeof raw === 'string' ? raw.trim() : raw;
    switch (fld.type) {
      case 'text': case 'textarea': case 'email': {
        const t = String(s); if (t.length > (fld.type === 'textarea' ? 2000 : 300)) throw new BadRequestException(`${fld.label} is too long`);
        if (fld.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) throw new BadRequestException(`${fld.label} is not a valid email`);
        return fld.type === 'email' ? t.toLowerCase() : t;
      }
      case 'number': case 'int': {
        const n = Number(s); if (!Number.isFinite(n) || (fld.type === 'int' && !Number.isInteger(n))) throw new BadRequestException(`${fld.label} must be a ${fld.type === 'int' ? 'whole ' : ''}number`);
        if (fld.min !== undefined && n < fld.min) throw new BadRequestException(`${fld.label} cannot be below ${fld.min}`);
        return n;
      }
      case 'date': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s)) || isNaN(new Date(`${s}T00:00:00Z`).getTime())) throw new BadRequestException(`${fld.label} must be a date`);
        return new Date(`${s}T00:00:00Z`);
      }
      case 'zone': {
        if (!(await this.prisma.zone.findUnique({ where: { id: String(s) } }))) throw new BadRequestException(`${fld.label}: unknown branch`);
        return String(s);
      }
    }
  }

  async remove(user: AuthUser, key: string, id: string) {
    const e = this.entity(key);
    if (!this.may(user, e, e.deleteRoles)) throw new ForbiddenException('You do not have permission to delete this.');
    const rec: any = await this.load(e, id);
    const rule = e.deleteRule?.(rec, user);
    const blockers = await this.blockers(e, rec);
    const canArchive = !!e.archive && !e.archived?.(rec);
    const refuse = (message: string) => new ConflictException({ message, blockers, canArchive, statusCode: 409 });
    if (rule) throw refuse(rule);
    if (blockers.length) throw refuse(`This ${e.label} cannot be deleted because it is used by: ${blockers.map((x) => `${x.count} ${x.label}`).join(', ')}.${canArchive ? ' You can deactivate it instead; its history stays.' : ''}`);
    const files: string[] = [];
    try {
      await this.prisma.$transaction(async (tx) => {
        await e.cascade?.(tx, rec, files);
        await this.delegate(e, tx).delete({ where: { id } });
        await e.after?.(tx, rec);
      }, { timeout: 30_000 });
    } catch (err: any) {
      if (err.code === 'P2003' || err.code === 'P2014') throw refuse(`This ${e.label} is still linked to other records, so it cannot be deleted.${canArchive ? ' You can deactivate it instead.' : ''}`);
      throw err;
    }
    for (const k of files) await this.storage.remove(k);
    await this.audit.log(user.id, key, id, 'delete', JSON.parse(JSON.stringify(rec, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))), undefined);
    return { deleted: true, title: e.title(rec) };
  }

  async archive(user: AuthUser, key: string, id: string) {
    const e = this.entity(key);
    if (!this.may(user, e, e.deleteRoles)) throw new ForbiddenException('You do not have permission to change this.');
    if (!e.archive) throw new BadRequestException(`A ${e.label} cannot be deactivated`);
    const rec: any = await this.load(e, id);
    if (key === 'users' && rec.id === user.id) throw new BadRequestException('You cannot deactivate your own account.');
    await this.prisma.$transaction(async (tx) => { await e.archive!(tx, rec); });
    await this.audit.log(user.id, key, id, 'deactivate', undefined, { archived: true });
    return this.describe(user, key, id);
  }
}

class ValuesDto { @IsObject() values: Record<string, unknown>; }

@Controller('records')
export class RecordsController {
  constructor(private svc: RecordsService) {}
  @Get(':entity/:id') @Auth('admin', 'ga_head') get(@CurrentUser() u: AuthUser, @Param('entity') e: string, @Param('id', ParseUUIDPipe) id: string) { return this.svc.describe(u, e, id); }
  @Patch(':entity/:id') @Auth('admin', 'ga_head') patch(@CurrentUser() u: AuthUser, @Param('entity') e: string, @Param('id', ParseUUIDPipe) id: string, @Body() d: ValuesDto) { return this.svc.update(u, e, id, d.values); }
  @Delete(':entity/:id') @Auth('admin', 'ga_head') remove(@CurrentUser() u: AuthUser, @Param('entity') e: string, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, e, id); }
  @Post(':entity/:id/archive') @Auth('admin', 'ga_head') archive(@CurrentUser() u: AuthUser, @Param('entity') e: string, @Param('id', ParseUUIDPipe) id: string) { return this.svc.archive(u, e, id); }
}

@Module({ controllers: [RecordsController], providers: [RecordsService] })
export class RecordsModule {}

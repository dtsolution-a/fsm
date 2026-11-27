-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('open', 'converted', 'closed');

-- CreateEnum
CREATE TYPE "JobEngineerRole" AS ENUM ('primary', 'supporting');

-- CreateEnum
CREATE TYPE "ClosureApproval" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('photo_before', 'photo_after', 'signature', 'reference_doc');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('stock_in', 'stock_out', 'transfer_in', 'transfer_out', 'audit_adjustment');

-- CreateEnum
CREATE TYPE "DefectiveStatus" AS ENUM ('logged', 'replacement_initiated', 'disposed');

-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('ordered', 'in_transit', 'received');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('draft', 'sent', 'approved', 'rejected', 'converted');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('unpaid', 'partially_paid', 'paid', 'overdue');

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "client_site_id" UUID,
    "site_product_id" UUID,
    "issue_description" TEXT,
    "priority_id" UUID NOT NULL,
    "source_channel" TEXT NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "job_number" TEXT NOT NULL,
    "service_request_id" UUID,
    "client_id" UUID NOT NULL,
    "client_site_id" UUID,
    "site_product_id" UUID,
    "contract_id" UUID,
    "job_type_id" UUID NOT NULL,
    "priority_id" UUID NOT NULL,
    "status_id" UUID NOT NULL,
    "scheduled_start" TIMESTAMP(3),
    "scheduled_end" TIMESTAMP(3),
    "actual_start" TIMESTAMP(3),
    "actual_end" TIMESTAMP(3),
    "is_backdated_closure" BOOLEAN NOT NULL DEFAULT false,
    "closure_approval_status" "ClosureApproval",
    "duplicate_of_job_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_engineers" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "role" "JobEngineerRole" NOT NULL,
    "contribution_notes" TEXT,
    "accepted_at" TIMESTAMP(3),

    CONSTRAINT "job_engineers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_status_history" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_attachments" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_parts_used" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "spare_part_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "allocated_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_parts_used_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_compatible_parts" (
    "product_model_id" UUID NOT NULL,
    "spare_part_id" UUID NOT NULL,

    CONSTRAINT "product_compatible_parts_pkey" PRIMARY KEY ("product_model_id","spare_part_id")
);

-- CreateTable
CREATE TABLE "inventory_stock" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "spare_part_id" UUID NOT NULL,
    "available_qty" INTEGER NOT NULL DEFAULT 0,
    "pending_qty" INTEGER NOT NULL DEFAULT 0,
    "defective_qty" INTEGER NOT NULL DEFAULT 0,
    "reorder_threshold" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "spare_part_id" UUID NOT NULL,
    "movement_type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "reference_type" TEXT,
    "reference_id" UUID,
    "recorded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defective_items" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "spare_part_id" UUID NOT NULL,
    "job_id" UUID,
    "quantity" INTEGER NOT NULL,
    "status" "DefectiveStatus" NOT NULL DEFAULT 'logged',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "defective_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "PoStatus" NOT NULL DEFAULT 'ordered',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "spare_part_id" UUID NOT NULL,
    "quantity_ordered" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_audits" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "conducted_by" UUID,
    "conducted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "stock_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_audit_items" (
    "id" UUID NOT NULL,
    "stock_audit_id" UUID NOT NULL,
    "spare_part_id" UUID NOT NULL,
    "system_count" INTEGER NOT NULL,
    "physical_count" INTEGER NOT NULL,
    "discrepancy" INTEGER NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "stock_audit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_service_costs" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_service_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "quotation_number" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "job_id" UUID,
    "line_items" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'draft',
    "is_price_locked" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "job_id" UUID,
    "client_id" UUID NOT NULL,
    "quotation_id" UUID,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "service_charges" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "parts_charges" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "labor_charges" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'unpaid',
    "pdf_url" TEXT,
    "shared_via" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_tax_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "tax_label" TEXT NOT NULL,
    "rate_percent" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_tax_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" UUID,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" UUID NOT NULL,
    "report_type" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "recipients" TEXT[],
    "export_format" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "created_by" UUID,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_ticket_number_key" ON "service_requests"("ticket_number");

-- CreateIndex
CREATE INDEX "service_requests_status_created_at_idx" ON "service_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_job_number_key" ON "jobs"("job_number");

-- CreateIndex
CREATE INDEX "jobs_client_id_client_site_id_site_product_id_status_id_idx" ON "jobs"("client_id", "client_site_id", "site_product_id", "status_id");

-- CreateIndex
CREATE INDEX "jobs_status_id_scheduled_start_idx" ON "jobs"("status_id", "scheduled_start");

-- CreateIndex
CREATE UNIQUE INDEX "job_engineers_job_id_engineer_id_key" ON "job_engineers"("job_id", "engineer_id");

-- CreateIndex
CREATE INDEX "job_status_history_job_id_idx" ON "job_status_history"("job_id");

-- CreateIndex
CREATE INDEX "job_parts_used_job_id_idx" ON "job_parts_used"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stock_warehouse_id_spare_part_id_key" ON "inventory_stock"("warehouse_id", "spare_part_id");

-- CreateIndex
CREATE INDEX "stock_movements_warehouse_id_created_at_idx" ON "stock_movements"("warehouse_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_quotation_number_key" ON "quotations"("quotation_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_client_site_id_fkey" FOREIGN KEY ("client_site_id") REFERENCES "client_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_site_product_id_fkey" FOREIGN KEY ("site_product_id") REFERENCES "site_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "job_priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_site_id_fkey" FOREIGN KEY ("client_site_id") REFERENCES "client_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_site_product_id_fkey" FOREIGN KEY ("site_product_id") REFERENCES "site_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_job_type_id_fkey" FOREIGN KEY ("job_type_id") REFERENCES "job_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "job_priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "job_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_duplicate_of_job_id_fkey" FOREIGN KEY ("duplicate_of_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_engineers" ADD CONSTRAINT "job_engineers_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_engineers" ADD CONSTRAINT "job_engineers_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_attachments" ADD CONSTRAINT "job_attachments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_parts_used" ADD CONSTRAINT "job_parts_used_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_parts_used" ADD CONSTRAINT "job_parts_used_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_parts_used" ADD CONSTRAINT "job_parts_used_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_compatible_parts" ADD CONSTRAINT "product_compatible_parts_product_model_id_fkey" FOREIGN KEY ("product_model_id") REFERENCES "product_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_compatible_parts" ADD CONSTRAINT "product_compatible_parts_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defective_items" ADD CONSTRAINT "defective_items_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defective_items" ADD CONSTRAINT "defective_items_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defective_items" ADD CONSTRAINT "defective_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_audits" ADD CONSTRAINT "stock_audits_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_audit_items" ADD CONSTRAINT "stock_audit_items_stock_audit_id_fkey" FOREIGN KEY ("stock_audit_id") REFERENCES "stock_audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_audit_items" ADD CONSTRAINT "stock_audit_items_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_service_costs" ADD CONSTRAINT "contract_service_costs_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_service_costs" ADD CONSTRAINT "contract_service_costs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_tax_lines" ADD CONSTRAINT "invoice_tax_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

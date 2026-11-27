-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceStatus" ADD VALUE 'draft';
ALTER TYPE "InvoiceStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "contract_service_costs" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "recorded_by" UUID,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "due_date" DATE,
ADD COLUMN     "is_amc" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "issued_at" TIMESTAMP(3),
ADD COLUMN     "last_reminder_at" TIMESTAMP(3),
ADD COLUMN     "line_items" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "client_site_id" UUID,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "site_product_id" UUID,
ADD COLUMN     "tax_breakup" JSONB,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "valid_until" DATE;

-- AlterTable
ALTER TABLE "spare_parts" ADD COLUMN     "unit_price" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "event_code" TEXT NOT NULL,
    "client_id" UUID,
    "ref_type" TEXT,
    "ref_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbound_messages_created_at_idx" ON "outbound_messages"("created_at");

-- CreateIndex
CREATE INDEX "outbound_messages_status_idx" ON "outbound_messages"("status");

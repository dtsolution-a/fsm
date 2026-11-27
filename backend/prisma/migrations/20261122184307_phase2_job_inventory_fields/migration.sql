-- AlterTable
ALTER TABLE "defective_items" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "job_engineers" ADD COLUMN     "decline_reason" TEXT,
ADD COLUMN     "declined_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "job_parts_used" ADD COLUMN     "deducted_at" TIMESTAMP(3),
ADD COLUMN     "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "closure_notes" TEXT,
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "not_accepted_alert_at" TIMESTAMP(3),
ADD COLUMN     "signed_by_name" TEXT;

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "contact_phone" TEXT;

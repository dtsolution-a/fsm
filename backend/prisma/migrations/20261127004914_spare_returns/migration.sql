-- AlterTable
ALTER TABLE "job_parts_used" ADD COLUMN     "return_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returned_at" TIMESTAMP(3),
ADD COLUMN     "returned_by" UUID;

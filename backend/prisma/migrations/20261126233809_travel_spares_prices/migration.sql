-- AlterTable
ALTER TABLE "client_sites" ADD COLUMN     "geo_at" TIMESTAMP(3),
ADD COLUMN     "geo_source" TEXT;

-- AlterTable
ALTER TABLE "engineer_locations" ADD COLUMN     "accuracy_m" INTEGER;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "auto_generated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "job_types" ADD COLUMN     "default_price" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "phase" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "language" TEXT;

-- CreateTable
CREATE TABLE "job_travels" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'travelling',
    "mode" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "start_lat" DECIMAL(9,6) NOT NULL,
    "start_lng" DECIMAL(9,6) NOT NULL,
    "site_lat" DECIMAL(9,6),
    "site_lng" DECIMAL(9,6),
    "site_geo_source" TEXT,
    "straight_km" DECIMAL(8,2),
    "expected_km" DECIMAL(8,2),
    "expected_minutes" INTEGER,
    "route_source" TEXT,
    "ended_at" TIMESTAMP(3),
    "end_lat" DECIMAL(9,6),
    "end_lng" DECIMAL(9,6),
    "arrival_distance_m" INTEGER,
    "arrived_by" TEXT,
    "actual_km" DECIMAL(8,2),
    "actual_minutes" INTEGER,
    "tolerance_km" DECIMAL(8,2),
    "excess_km" DECIMAL(8,2),
    "reason" TEXT,
    "reason_lang" TEXT,
    "reason_voice" BOOLEAN NOT NULL DEFAULT false,
    "review" TEXT NOT NULL DEFAULT 'none',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "payable_km" DECIMAL(8,2),
    "rate_per_km" DECIMAL(8,2),
    "amount" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_travels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_work_sessions" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "travel_id" UUID,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,

    CONSTRAINT "job_work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spare_requests" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "note" TEXT,
    "warehouse_id" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "collected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spare_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spare_request_items" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "spare_part_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "allocated_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "spare_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_travels_job_id_idx" ON "job_travels"("job_id");

-- CreateIndex
CREATE INDEX "job_travels_engineer_id_started_at_idx" ON "job_travels"("engineer_id", "started_at");

-- CreateIndex
CREATE INDEX "job_work_sessions_job_id_idx" ON "job_work_sessions"("job_id");

-- CreateIndex
CREATE INDEX "spare_requests_job_id_idx" ON "spare_requests"("job_id");

-- CreateIndex
CREATE INDEX "spare_requests_status_idx" ON "spare_requests"("status");

-- AddForeignKey
ALTER TABLE "job_travels" ADD CONSTRAINT "job_travels_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_travels" ADD CONSTRAINT "job_travels_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_sessions" ADD CONSTRAINT "job_work_sessions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_sessions" ADD CONSTRAINT "job_work_sessions_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spare_requests" ADD CONSTRAINT "spare_requests_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spare_requests" ADD CONSTRAINT "spare_requests_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spare_request_items" ADD CONSTRAINT "spare_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "spare_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spare_request_items" ADD CONSTRAINT "spare_request_items_spare_part_id_fkey" FOREIGN KEY ("spare_part_id") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

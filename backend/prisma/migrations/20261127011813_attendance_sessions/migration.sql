-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "check_in_at" TIMESTAMP(3) NOT NULL,
    "check_out_at" TIMESTAMP(3),

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_sessions_attendance_id_idx" ON "attendance_sessions"("attendance_id");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

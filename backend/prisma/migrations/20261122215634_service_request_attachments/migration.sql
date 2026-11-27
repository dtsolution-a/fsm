-- CreateTable
CREATE TABLE "service_request_attachments" (
    "id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "original_bytes" INTEGER NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_request_attachments_service_request_id_idx" ON "service_request_attachments"("service_request_id");

-- AddForeignKey
ALTER TABLE "service_request_attachments" ADD CONSTRAINT "service_request_attachments_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

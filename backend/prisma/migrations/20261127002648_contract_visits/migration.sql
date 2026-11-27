-- CreateTable
CREATE TABLE "contract_visits" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "job_id" UUID,
    "engineer_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_visits_due_date_status_idx" ON "contract_visits"("due_date", "status");

-- CreateIndex
CREATE INDEX "contract_visits_job_id_idx" ON "contract_visits"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_visits_contract_id_seq_key" ON "contract_visits"("contract_id", "seq");

-- AddForeignKey
ALTER TABLE "contract_visits" ADD CONSTRAINT "contract_visits_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

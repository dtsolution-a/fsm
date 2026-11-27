-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'ga_head', 'supervisor', 'engineer', 'client');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "user_code" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "legacy_group" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_zones" (
    "user_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,

    CONSTRAINT "user_zones_pkey" PRIMARY KEY ("user_id","zone_id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_priorities" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sla_hours" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_statuses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "skill_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_chargeable" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contract_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_event_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "default_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_event_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_charge_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "tax_label_in_state" TEXT,
    "tax_rate_in_state" DECIMAL(5,2),
    "tax_label_out_state" TEXT,
    "tax_rate_out_state" DECIMAL(5,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "service_charge_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "zone_id" UUID,
    "proprietor_name" TEXT,
    "proprietor_email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "client_code" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_sites" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "site_name" TEXT NOT NULL,
    "address" TEXT,
    "state" TEXT,
    "city" TEXT,
    "zone_label" TEXT,
    "pincode" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "site_contact_name" TEXT,
    "site_contact_phone" TEXT,
    "legacy_user_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "job_ref" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "submitted_via" TEXT NOT NULL,
    "ga_head_notified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_types" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_models" (
    "id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "specs" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_products" (
    "id" UUID NOT NULL,
    "client_site_id" UUID NOT NULL,
    "product_model_id" UUID,
    "serial_number" TEXT,
    "installation_date" DATE,
    "warranty_expiry" DATE,
    "decommissioned_at" TIMESTAMP(3),
    "legacy_amc_id" TEXT,
    "raw_brand" TEXT,
    "raw_product" TEXT,
    "raw_sub_product" TEXT,
    "raw_model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "contract_number" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "site_product_id" UUID,
    "contract_type_id" UUID NOT NULL,
    "external_contract_no" TEXT,
    "amount" DECIMAL(12,2),
    "tax_label" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "visit_frequency" INTEGER,
    "free_services_total" INTEGER NOT NULL DEFAULT 0,
    "free_services_completed" INTEGER NOT NULL DEFAULT 0,
    "document_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_renewals" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "previous_end_date" DATE NOT NULL,
    "new_end_date" DATE NOT NULL,
    "renewed_by" UUID,
    "renewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_code" TEXT,
    "designation" TEXT,
    "primary_zone_id" UUID,
    "city" TEXT,
    "date_of_joining" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineer_zones" (
    "engineer_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,

    CONSTRAINT "engineer_zones_pkey" PRIMARY KEY ("engineer_id","zone_id")
);

-- CreateTable
CREATE TABLE "engineer_skills" (
    "engineer_id" UUID NOT NULL,
    "skill_category_id" UUID NOT NULL,

    CONSTRAINT "engineer_skills_pkey" PRIMARY KEY ("engineer_id","skill_category_id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "record_date" DATE NOT NULL,
    "check_in_at" TIMESTAMP(3) NOT NULL,
    "check_out_at" TIMESTAMP(3),
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "is_backdated" BOOLEAN NOT NULL DEFAULT false,
    "flagged_for_review" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineer_locations" (
    "id" BIGSERIAL NOT NULL,
    "engineer_id" UUID NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineer_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spare_parts" (
    "id" UUID NOT NULL,
    "part_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hsn_code" TEXT,
    "job_category" TEXT,
    "product_type_id" UUID,
    "raw_product_name" TEXT,
    "unit" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spare_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "manager_user_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "event_code" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "payload" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_user_code_key" ON "users"("user_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "zones_name_key" ON "zones"("name");

-- CreateIndex
CREATE INDEX "activity_logs_entity_type_entity_id_idx" ON "activity_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "job_types_code_key" ON "job_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "job_priorities_code_key" ON "job_priorities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "job_statuses_code_key" ON "job_statuses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "skill_categories_code_key" ON "skill_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "contract_types_code_key" ON "contract_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_types_code_key" ON "notification_event_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "service_charge_codes_code_key" ON "service_charge_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_name_key" ON "branches"("name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_client_code_key" ON "clients"("client_code");

-- CreateIndex
CREATE INDEX "clients_company_name_idx" ON "clients"("company_name");

-- CreateIndex
CREATE UNIQUE INDEX "client_sites_legacy_user_id_key" ON "client_sites"("legacy_user_id");

-- CreateIndex
CREATE INDEX "client_sites_client_id_idx" ON "client_sites"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_sites_client_id_site_name_key" ON "client_sites"("client_id", "site_name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_types_brand_id_name_key" ON "product_types"("brand_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_type_id_name_key" ON "product_variants"("product_type_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_models_product_variant_id_name_key" ON "product_models"("product_variant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "site_products_legacy_amc_id_key" ON "site_products"("legacy_amc_id");

-- CreateIndex
CREATE INDEX "site_products_serial_number_idx" ON "site_products"("serial_number");

-- CreateIndex
CREATE INDEX "site_products_client_site_id_idx" ON "site_products"("client_site_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contract_number_key" ON "contracts"("contract_number");

-- CreateIndex
CREATE INDEX "contracts_end_date_idx" ON "contracts"("end_date");

-- CreateIndex
CREATE INDEX "contracts_client_id_idx" ON "contracts"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "engineers_user_id_key" ON "engineers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "engineers_employee_code_key" ON "engineers"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_engineer_id_record_date_key" ON "attendance_records"("engineer_id", "record_date");

-- CreateIndex
CREATE INDEX "engineer_locations_engineer_id_recorded_at_idx" ON "engineer_locations"("engineer_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "spare_parts_part_number_key" ON "spare_parts"("part_number");

-- CreateIndex
CREATE INDEX "spare_parts_name_idx" ON "spare_parts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_name_key" ON "warehouses"("name");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_is_read_idx" ON "notifications"("recipient_id", "is_read");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_zones" ADD CONSTRAINT "user_zones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_zones" ADD CONSTRAINT "user_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_sites" ADD CONSTRAINT "client_sites_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_models" ADD CONSTRAINT "product_models_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_products" ADD CONSTRAINT "site_products_client_site_id_fkey" FOREIGN KEY ("client_site_id") REFERENCES "client_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_products" ADD CONSTRAINT "site_products_product_model_id_fkey" FOREIGN KEY ("product_model_id") REFERENCES "product_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_site_product_id_fkey" FOREIGN KEY ("site_product_id") REFERENCES "site_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contract_type_id_fkey" FOREIGN KEY ("contract_type_id") REFERENCES "contract_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_renewals" ADD CONSTRAINT "contract_renewals_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_primary_zone_id_fkey" FOREIGN KEY ("primary_zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_zones" ADD CONSTRAINT "engineer_zones_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_zones" ADD CONSTRAINT "engineer_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_skills" ADD CONSTRAINT "engineer_skills_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_skills" ADD CONSTRAINT "engineer_skills_skill_category_id_fkey" FOREIGN KEY ("skill_category_id") REFERENCES "skill_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_locations" ADD CONSTRAINT "engineer_locations_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spare_parts" ADD CONSTRAINT "spare_parts_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

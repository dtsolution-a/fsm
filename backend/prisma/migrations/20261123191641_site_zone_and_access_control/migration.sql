-- AlterTable
ALTER TABLE "client_sites" ADD COLUMN     "zone_id" UUID,
ADD COLUMN     "zone_linked_by" TEXT;

-- CreateTable
CREATE TABLE "role_permissions" (
    "role" "Role" NOT NULL,
    "module" TEXT NOT NULL,
    "level" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role","module")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" UUID NOT NULL,
    "module" TEXT NOT NULL,
    "level" TEXT NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","module")
);

-- CreateIndex
CREATE INDEX "client_sites_zone_id_idx" ON "client_sites"("zone_id");

-- AddForeignKey
ALTER TABLE "client_sites" ADD CONSTRAINT "client_sites_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

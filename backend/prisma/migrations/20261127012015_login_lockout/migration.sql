-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_logins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "password_changed_at" TIMESTAMP(3);

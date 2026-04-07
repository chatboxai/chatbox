-- AlterTable
ALTER TABLE "AppRegistration" ADD COLUMN     "auth_provider" TEXT,
ADD COLUMN     "auth_required" BOOLEAN NOT NULL DEFAULT false;

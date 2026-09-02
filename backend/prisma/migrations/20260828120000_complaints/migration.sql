-- CreateEnum
CREATE TYPE "complaint_category" AS ENUM ('SERVICE_QUALITY', 'BILLING', 'COVERAGE', 'AGENT_CONDUCT', 'DATA_PRIVACY', 'SUGGESTION', 'OTHER');

-- CreateEnum
CREATE TYPE "complaint_status" AS ENUM ('RECEIVED', 'IN_REVIEW', 'RESOLVED', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'COMPLAINT_FILED';
ALTER TYPE "audit_action" ADD VALUE 'COMPLAINT_STATUS_CHANGED';

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'COMPLAINT_RECEIVED';

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "tracking_code_hash" TEXT NOT NULL,
    "category" "complaint_category" NOT NULL DEFAULT 'OTHER',
    "status" "complaint_status" NOT NULL DEFAULT 'RECEIVED',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "complainant_name" TEXT,
    "complainant_email" TEXT,
    "complainant_phone" TEXT,
    "about_entity_id" UUID,
    "resolution_note" TEXT,
    "handled_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "complaints_reference_number_key" ON "complaints"("reference_number");

-- CreateIndex
CREATE INDEX "complaints_status_idx" ON "complaints"("status");

-- CreateIndex
CREATE INDEX "complaints_category_idx" ON "complaints"("category");

-- CreateIndex
CREATE INDEX "complaints_about_entity_id_idx" ON "complaints"("about_entity_id");

-- CreateIndex
CREATE INDEX "complaints_created_at_idx" ON "complaints"("created_at");

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_about_entity_id_fkey" FOREIGN KEY ("about_entity_id") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


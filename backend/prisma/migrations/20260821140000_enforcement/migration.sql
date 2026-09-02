-- CreateEnum
CREATE TYPE "enforcement_reason" AS ENUM ('MISSED_DEADLINE');

-- CreateEnum
CREATE TYPE "enforcement_status" AS ENUM ('OPEN', 'RESOLVED', 'WAIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'ENFORCEMENT_CASE_OPENED';
ALTER TYPE "audit_action" ADD VALUE 'ENFORCEMENT_CASE_RESOLVED';
ALTER TYPE "audit_action" ADD VALUE 'ENFORCEMENT_CASE_WAIVED';

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'ENFORCEMENT_CASE_OPENED';

-- CreateTable
CREATE TABLE "enforcement_cases" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "reason" "enforcement_reason" NOT NULL DEFAULT 'MISSED_DEADLINE',
    "status" "enforcement_status" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enforcement_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enforcement_cases_status_idx" ON "enforcement_cases"("status");

-- CreateIndex
CREATE INDEX "enforcement_cases_entity_id_idx" ON "enforcement_cases"("entity_id");

-- CreateIndex
CREATE INDEX "enforcement_cases_period_id_idx" ON "enforcement_cases"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "enforcement_cases_entity_id_period_id_reason_key" ON "enforcement_cases"("entity_id", "period_id", "reason");

-- AddForeignKey
ALTER TABLE "enforcement_cases" ADD CONSTRAINT "enforcement_cases_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_cases" ADD CONSTRAINT "enforcement_cases_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "reporting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_cases" ADD CONSTRAINT "enforcement_cases_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


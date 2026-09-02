-- CreateEnum
CREATE TYPE "period_status" AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'PERIOD_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'PERIOD_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'PERIOD_OPENED';
ALTER TYPE "audit_action" ADD VALUE 'PERIOD_CLOSED';
ALTER TYPE "audit_action" ADD VALUE 'PERIOD_DELETED';

-- CreateTable
CREATE TABLE "reporting_periods" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "frequency" "reporting_frequency" NOT NULL,
    "label" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "grace_days" INTEGER NOT NULL DEFAULT 5,
    "status" "period_status" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "reporting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reporting_periods_template_id_idx" ON "reporting_periods"("template_id");

-- CreateIndex
CREATE INDEX "reporting_periods_status_idx" ON "reporting_periods"("status");

-- CreateIndex
CREATE INDEX "reporting_periods_due_date_idx" ON "reporting_periods"("due_date");

-- CreateIndex
CREATE INDEX "reporting_periods_deleted_at_idx" ON "reporting_periods"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_periods_template_id_frequency_label_key" ON "reporting_periods"("template_id", "frequency", "label");

-- AddForeignKey
ALTER TABLE "reporting_periods" ADD CONSTRAINT "reporting_periods_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "reporting_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'LEVY_RATE_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'LEVY_RATE_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'LEVY_RATE_DELETED';

-- AlterTable
ALTER TABLE "template_fields" ADD COLUMN     "is_levy_basis" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "levy_rates" (
    "id" UUID NOT NULL,
    "rate_percent" DECIMAL(6,4) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "label" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "levy_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "levy_rates_effective_from_idx" ON "levy_rates"("effective_from");

-- CreateIndex
CREATE INDEX "levy_rates_deleted_at_idx" ON "levy_rates"("deleted_at");


-- CreateEnum
CREATE TYPE "public_aggregation" AS ENUM ('SUM', 'AVERAGE', 'COUNT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'PUBLIC_INDICATOR_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'PUBLIC_INDICATOR_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'PUBLIC_INDICATOR_DELETED';

-- CreateTable
CREATE TABLE "public_indicators" (
    "id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "aggregation" "public_aggregation" NOT NULL DEFAULT 'SUM',
    "label" TEXT NOT NULL,
    "unit" TEXT,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "public_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_indicators_is_published_idx" ON "public_indicators"("is_published");

-- CreateIndex
CREATE INDEX "public_indicators_deleted_at_idx" ON "public_indicators"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "public_indicators_field_key_aggregation_key" ON "public_indicators"("field_key", "aggregation");


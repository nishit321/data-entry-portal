-- CreateEnum
CREATE TYPE "reference_category" AS ENUM ('SPECTRUM_BAND', 'TECHNOLOGY', 'SERVICE_TYPE', 'GEO_CLASSIFICATION', 'ENERGY_GENERATION_TYPE', 'ENERGY_STORAGE_TYPE', 'FIXED_ACCESS_TYPE', 'TRANSACTION_TYPE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'REFERENCE_ITEM_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'REFERENCE_ITEM_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'REFERENCE_ITEM_DELETED';

-- CreateTable
CREATE TABLE "reference_items" (
    "id" UUID NOT NULL,
    "category" "reference_category" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "reference_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reference_items_category_idx" ON "reference_items"("category");

-- CreateIndex
CREATE INDEX "reference_items_is_active_idx" ON "reference_items"("is_active");

-- CreateIndex
CREATE INDEX "reference_items_deleted_at_idx" ON "reference_items"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "reference_items_category_code_key" ON "reference_items"("category", "code");

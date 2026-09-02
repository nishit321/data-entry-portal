-- CreateEnum
CREATE TYPE "network_site_kind" AS ENUM ('BASE_STATION', 'FIBRE_NODE', 'POP', 'DATA_CENTRE', 'OTHER');

-- CreateEnum
CREATE TYPE "network_site_status" AS ENUM ('PLANNED', 'ACTIVE', 'DECOMMISSIONED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'NETWORK_SITE_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'NETWORK_SITE_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'NETWORK_SITE_DELETED';

-- CreateTable
CREATE TABLE "network_sites" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "site_reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "network_site_kind" NOT NULL DEFAULT 'BASE_STATION',
    "status" "network_site_status" NOT NULL DEFAULT 'ACTIVE',
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "location" TEXT,
    "technology" TEXT,
    "coverage_m" INTEGER,
    "commissioned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "network_sites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "network_sites_entity_id_idx" ON "network_sites"("entity_id");

-- CreateIndex
CREATE INDEX "network_sites_kind_idx" ON "network_sites"("kind");

-- CreateIndex
CREATE INDEX "network_sites_status_idx" ON "network_sites"("status");

-- CreateIndex
CREATE INDEX "network_sites_deleted_at_idx" ON "network_sites"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "network_sites_entity_id_site_reference_key" ON "network_sites"("entity_id", "site_reference");

-- AddForeignKey
ALTER TABLE "network_sites" ADD CONSTRAINT "network_sites_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;


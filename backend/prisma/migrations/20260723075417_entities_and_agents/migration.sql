-- CreateEnum
CREATE TYPE "entity_type" AS ENUM ('MNO', 'ISP', 'MMO', 'VENDOR', 'OTHER');

-- CreateEnum
CREATE TYPE "entity_status" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEREGISTERED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'ENTITY_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'ENTITY_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'ENTITY_STATUS_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'ENTITY_DELETED';
ALTER TYPE "audit_action" ADD VALUE 'AGENT_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'AGENT_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'AGENT_STATUS_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'AGENT_DELETED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "entity_id" UUID;

-- CreateTable
CREATE TABLE "entities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "entity_type" NOT NULL,
    "status" "entity_status" NOT NULL DEFAULT 'PENDING',
    "licence_number" TEXT NOT NULL,
    "licence_issued_at" TIMESTAMP(3),
    "years_in_operation" INTEGER,
    "geographic_scope" TEXT,
    "headquarters_address" TEXT,
    "primary_contact_name" TEXT,
    "primary_contact_title" TEXT,
    "primary_contact_email" TEXT,
    "primary_contact_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "agent_reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entities_licence_number_key" ON "entities"("licence_number");

-- CreateIndex
CREATE INDEX "entities_type_idx" ON "entities"("type");

-- CreateIndex
CREATE INDEX "entities_status_idx" ON "entities"("status");

-- CreateIndex
CREATE INDEX "entities_deleted_at_idx" ON "entities"("deleted_at");

-- CreateIndex
CREATE INDEX "agents_entity_id_idx" ON "agents"("entity_id");

-- CreateIndex
CREATE INDEX "agents_is_active_idx" ON "agents"("is_active");

-- CreateIndex
CREATE INDEX "agents_deleted_at_idx" ON "agents"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "agents_entity_id_agent_reference_key" ON "agents"("entity_id", "agent_reference");

-- CreateIndex
CREATE INDEX "users_entity_id_idx" ON "users"("entity_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

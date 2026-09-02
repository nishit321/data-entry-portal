-- CreateEnum
CREATE TYPE "document_kind" AS ENUM ('LICENCE', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "document_expiry_stage" AS ENUM ('EXPIRING', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'DOCUMENT_UPLOADED';
ALTER TYPE "audit_action" ADD VALUE 'DOCUMENT_REPLACED';
ALTER TYPE "audit_action" ADD VALUE 'DOCUMENT_DELETED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'DOCUMENT_EXPIRING';
ALTER TYPE "notification_type" ADD VALUE 'DOCUMENT_EXPIRED';

-- CreateTable
CREATE TABLE "document_records" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "kind" "document_kind" NOT NULL DEFAULT 'LICENCE',
    "title" TEXT NOT NULL,
    "reference" TEXT,
    "issued_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "alerted_stage" "document_expiry_stage",

    CONSTRAINT "document_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_records_supersedes_id_key" ON "document_records"("supersedes_id");

-- CreateIndex
CREATE INDEX "document_records_entity_id_idx" ON "document_records"("entity_id");

-- CreateIndex
CREATE INDEX "document_records_expires_at_idx" ON "document_records"("expires_at");

-- CreateIndex
CREATE INDEX "document_records_deleted_at_idx" ON "document_records"("deleted_at");

-- AddForeignKey
ALTER TABLE "document_records" ADD CONSTRAINT "document_records_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_records" ADD CONSTRAINT "document_records_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_records" ADD CONSTRAINT "document_records_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "document_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;


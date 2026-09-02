-- CreateEnum
CREATE TYPE "template_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "reporting_frequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'QUARTERLY_AND_ANNUAL');

-- CreateEnum
CREATE TYPE "field_type" AS ENUM ('INTEGER', 'DECIMAL', 'PERCENTAGE', 'MONETARY', 'BOOLEAN', 'DATE', 'TEXT', 'TEXTAREA', 'REFERENCE');

-- CreateEnum
CREATE TYPE "flow_or_stock" AS ENUM ('NONE', 'STOCK', 'FLOW_DERIVED', 'FLOW_ENTERED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_PUBLISHED';
ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_DELETED';
ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_VERSIONED';
ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_SECTION_SAVED';
ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_SECTION_DELETED';
ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_FIELD_SAVED';
ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_FIELD_DELETED';

-- CreateTable
CREATE TABLE "reporting_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "template_status" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "reporting_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_sections" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "applicable_entity_types" "entity_type"[],
    "frequency" "reporting_frequency" NOT NULL DEFAULT 'QUARTERLY_AND_ANNUAL',
    "required_service_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_fields" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "data_type" "field_type" NOT NULL,
    "unit" TEXT,
    "decimals" INTEGER,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "flow_or_stock" "flow_or_stock" NOT NULL DEFAULT 'NONE',
    "min_value" DECIMAL(18,2),
    "max_value" DECIMAL(18,2),
    "reference_category" "reference_category",
    "allows_other" BOOLEAN NOT NULL DEFAULT false,
    "frequency_override" "reporting_frequency",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reporting_templates_status_idx" ON "reporting_templates"("status");

-- CreateIndex
CREATE INDEX "reporting_templates_deleted_at_idx" ON "reporting_templates"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_templates_name_version_key" ON "reporting_templates"("name", "version");

-- CreateIndex
CREATE INDEX "template_sections_template_id_idx" ON "template_sections"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "template_sections_template_id_key_key" ON "template_sections"("template_id", "key");

-- CreateIndex
CREATE INDEX "template_fields_section_id_idx" ON "template_fields"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "template_fields_section_id_key_key" ON "template_fields"("section_id", "key");

-- AddForeignKey
ALTER TABLE "template_sections" ADD CONSTRAINT "template_sections_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "reporting_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "template_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

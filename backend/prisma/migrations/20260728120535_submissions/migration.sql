-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'SUBMISSION_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'SUBMISSION_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'SUBMISSION_SUBMITTED';
ALTER TYPE "audit_action" ADD VALUE 'SUBMISSION_DELETED';

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "reference_number" TEXT,
    "entity_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "status" "submission_status" NOT NULL DEFAULT 'DRAFT',
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMP(3),
    "signed_by_user_id" UUID,
    "signed_name" TEXT,
    "signed_at" TIMESTAMP(3),
    "validation_warnings" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_values" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "value_text" TEXT,
    "is_unavailable" BOOLEAN NOT NULL DEFAULT false,
    "unavailable_reason" TEXT,
    "other_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "submissions_reference_number_key" ON "submissions"("reference_number");

-- CreateIndex
CREATE INDEX "submissions_entity_id_idx" ON "submissions"("entity_id");

-- CreateIndex
CREATE INDEX "submissions_period_id_idx" ON "submissions"("period_id");

-- CreateIndex
CREATE INDEX "submissions_status_idx" ON "submissions"("status");

-- CreateIndex
CREATE INDEX "submissions_deleted_at_idx" ON "submissions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_entity_id_period_id_key" ON "submissions"("entity_id", "period_id");

-- CreateIndex
CREATE INDEX "submission_values_submission_id_idx" ON "submission_values"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_values_submission_id_field_id_key" ON "submission_values"("submission_id", "field_id");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "reporting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "reporting_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_values" ADD CONSTRAINT "submission_values_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_values" ADD CONSTRAINT "submission_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "template_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

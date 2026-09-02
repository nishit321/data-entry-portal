-- CreateEnum
CREATE TYPE "rule_type" AS ENUM ('SUM_EQUALS_TOTAL', 'LESS_OR_EQUAL', 'FLOAT_RECONCILE', 'PERIOD_ON_PERIOD', 'NONZERO_REQUIRES');

-- CreateEnum
CREATE TYPE "rule_severity" AS ENUM ('HARD', 'SOFT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_RULE_SAVED';
ALTER TYPE "audit_action" ADD VALUE 'TEMPLATE_RULE_DELETED';

-- CreateTable
CREATE TABLE "template_rules" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "type" "rule_type" NOT NULL,
    "severity" "rule_severity" NOT NULL DEFAULT 'HARD',
    "label" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "template_rules_template_id_idx" ON "template_rules"("template_id");

-- AddForeignKey
ALTER TABLE "template_rules" ADD CONSTRAINT "template_rules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "reporting_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "scheduled_report_kind" AS ENUM ('COMPLIANCE_WORKBOOK', 'LEVY_WORKBOOK', 'LEVY_STATEMENT');

-- CreateEnum
CREATE TYPE "report_frequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'REPORT_SCHEDULE_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'REPORT_SCHEDULE_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'REPORT_SCHEDULE_DELETED';
ALTER TYPE "audit_action" ADD VALUE 'REPORT_SCHEDULE_SENT';

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "scheduled_report_kind" NOT NULL DEFAULT 'COMPLIANCE_WORKBOOK',
    "frequency" "report_frequency" NOT NULL DEFAULT 'MONTHLY',
    "day_of_period" INTEGER NOT NULL DEFAULT 1,
    "hour" INTEGER NOT NULL DEFAULT 7,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_recipients" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "report_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_schedules_is_enabled_idx" ON "report_schedules"("is_enabled");

-- CreateIndex
CREATE INDEX "report_schedules_deleted_at_idx" ON "report_schedules"("deleted_at");

-- CreateIndex
CREATE INDEX "report_recipients_user_id_idx" ON "report_recipients"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_recipients_schedule_id_user_id_key" ON "report_recipients"("schedule_id", "user_id");

-- AddForeignKey
ALTER TABLE "report_recipients" ADD CONSTRAINT "report_recipients_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "report_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_recipients" ADD CONSTRAINT "report_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


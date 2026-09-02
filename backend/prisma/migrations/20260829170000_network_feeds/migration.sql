-- CreateEnum
CREATE TYPE "agreement_status" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "feed_frequency" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "feed_run_outcome" AS ENUM ('SUCCEEDED', 'FAILED', 'SKIPPED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'AGREEMENT_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'AGREEMENT_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'AGREEMENT_DELETED';
ALTER TYPE "audit_action" ADD VALUE 'FEED_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'FEED_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'FEED_DELETED';
ALTER TYPE "audit_action" ADD VALUE 'FEED_RUN';

-- CreateTable
CREATE TABLE "data_sharing_agreements" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "status" "agreement_status" NOT NULL DEFAULT 'DRAFT',
    "signed_at" TIMESTAMP(3),
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "data_sharing_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_feeds" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "frequency" "feed_frequency" NOT NULL DEFAULT 'DAILY',
    "hour" INTEGER NOT NULL DEFAULT 3,
    "day_of_week" INTEGER NOT NULL DEFAULT 1,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "auth_token" TEXT,
    "last_run_at" TIMESTAMP(3),
    "last_outcome" "feed_run_outcome",
    "last_error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "network_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_runs" (
    "id" UUID NOT NULL,
    "feed_id" UUID NOT NULL,
    "outcome" "feed_run_outcome" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "metric_count" INTEGER NOT NULL DEFAULT 0,
    "http_status" INTEGER,
    "message" TEXT,

    CONSTRAINT "feed_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_metrics" (
    "id" UUID NOT NULL,
    "feed_run_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" DECIMAL(20,4) NOT NULL,
    "unit" TEXT,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_sharing_agreements_reference_key" ON "data_sharing_agreements"("reference");

-- CreateIndex
CREATE INDEX "data_sharing_agreements_entity_id_idx" ON "data_sharing_agreements"("entity_id");

-- CreateIndex
CREATE INDEX "data_sharing_agreements_status_idx" ON "data_sharing_agreements"("status");

-- CreateIndex
CREATE INDEX "data_sharing_agreements_deleted_at_idx" ON "data_sharing_agreements"("deleted_at");

-- CreateIndex
CREATE INDEX "network_feeds_agreement_id_idx" ON "network_feeds"("agreement_id");

-- CreateIndex
CREATE INDEX "network_feeds_is_enabled_idx" ON "network_feeds"("is_enabled");

-- CreateIndex
CREATE INDEX "network_feeds_deleted_at_idx" ON "network_feeds"("deleted_at");

-- CreateIndex
CREATE INDEX "feed_runs_feed_id_idx" ON "feed_runs"("feed_id");

-- CreateIndex
CREATE INDEX "feed_runs_started_at_idx" ON "feed_runs"("started_at");

-- CreateIndex
CREATE INDEX "feed_metrics_entity_id_key_measured_at_idx" ON "feed_metrics"("entity_id", "key", "measured_at");

-- CreateIndex
CREATE INDEX "feed_metrics_feed_run_id_idx" ON "feed_metrics"("feed_run_id");

-- AddForeignKey
ALTER TABLE "data_sharing_agreements" ADD CONSTRAINT "data_sharing_agreements_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_feeds" ADD CONSTRAINT "network_feeds_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "data_sharing_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_runs" ADD CONSTRAINT "feed_runs_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "network_feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_metrics" ADD CONSTRAINT "feed_metrics_feed_run_id_fkey" FOREIGN KEY ("feed_run_id") REFERENCES "feed_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_metrics" ADD CONSTRAINT "feed_metrics_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "api_scope" AS ENUM ('READ_PERIODS', 'READ_RETURNS', 'SUBMIT_RETURNS', 'FEED_INGEST');

-- CreateEnum
CREATE TYPE "api_client_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'API_CLIENT_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'API_CLIENT_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'API_CLIENT_REVOKED';
ALTER TYPE "audit_action" ADD VALUE 'API_CLIENT_SECRET_ROTATED';
ALTER TYPE "audit_action" ADD VALUE 'API_REQUEST_ACCEPTED';
ALTER TYPE "audit_action" ADD VALUE 'API_REQUEST_REFUSED';

-- CreateTable
CREATE TABLE "api_clients" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "secret_last4" TEXT NOT NULL,
    "cert_fingerprint" TEXT,
    "allowed_cidrs" TEXT[],
    "scopes" "api_scope"[],
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
    "status" "api_client_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_nonces" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_client_id_key" ON "api_clients"("client_id");

-- CreateIndex
CREATE INDEX "api_clients_entity_id_idx" ON "api_clients"("entity_id");

-- CreateIndex
CREATE INDEX "api_clients_status_idx" ON "api_clients"("status");

-- CreateIndex
CREATE INDEX "api_clients_deleted_at_idx" ON "api_clients"("deleted_at");

-- CreateIndex
CREATE INDEX "api_nonces_expires_at_idx" ON "api_nonces"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_nonces_client_id_nonce_key" ON "api_nonces"("client_id", "nonce");

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_nonces" ADD CONSTRAINT "api_nonces_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;


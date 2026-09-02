-- CreateEnum
CREATE TYPE "signature_format" AS ENUM ('SIMPLE', 'PKI');

-- CreateEnum
CREATE TYPE "signing_certificate_status" AS ENUM ('ACTIVE', 'REVOKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'SIGNING_CERTIFICATE_REGISTERED';
ALTER TYPE "audit_action" ADD VALUE 'SIGNING_CERTIFICATE_REVOKED';
ALTER TYPE "audit_action" ADD VALUE 'SUBMISSION_SIGNATURE_VERIFIED';

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "signature_cert_id" UUID,
ADD COLUMN     "signature_digest" TEXT,
ADD COLUMN     "signature_format" "signature_format" NOT NULL DEFAULT 'SIMPLE',
ADD COLUMN     "signature_value" TEXT;

-- CreateTable
CREATE TABLE "signing_certificates" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "public_key_pem" TEXT NOT NULL,
    "certificate_pem" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "not_before" TIMESTAMP(3) NOT NULL,
    "not_after" TIMESTAMP(3) NOT NULL,
    "self_signed" BOOLEAN NOT NULL DEFAULT false,
    "status" "signing_certificate_status" NOT NULL DEFAULT 'ACTIVE',
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signing_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signing_certificates_fingerprint_key" ON "signing_certificates"("fingerprint");

-- CreateIndex
CREATE INDEX "signing_certificates_user_id_idx" ON "signing_certificates"("user_id");

-- CreateIndex
CREATE INDEX "signing_certificates_status_idx" ON "signing_certificates"("status");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_signature_cert_id_fkey" FOREIGN KEY ("signature_cert_id") REFERENCES "signing_certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_certificates" ADD CONSTRAINT "signing_certificates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


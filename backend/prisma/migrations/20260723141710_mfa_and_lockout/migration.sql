-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'USER_MFA_CHALLENGED';
ALTER TYPE "audit_action" ADD VALUE 'USER_MFA_FAILED';
ALTER TYPE "audit_action" ADD VALUE 'USER_LOCKED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_user_id_idx" ON "otp_challenges"("user_id");

-- CreateIndex
CREATE INDEX "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

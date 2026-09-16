-- CreateEnum
CREATE TYPE "mfa_method" AS ENUM ('EMAIL', 'TOTP');

-- AlterTable
ALTER TABLE "otp_challenges" ADD COLUMN     "method" "mfa_method" NOT NULL DEFAULT 'EMAIL',
ALTER COLUMN "code_hash" DROP NOT NULL;


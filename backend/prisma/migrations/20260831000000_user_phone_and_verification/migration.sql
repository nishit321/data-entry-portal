-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phone_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "phone_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phone_verifications_user_id_idx" ON "phone_verifications"("user_id");

-- CreateIndex
CREATE INDEX "phone_verifications_expires_at_idx" ON "phone_verifications"("expires_at");

-- AddForeignKey
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


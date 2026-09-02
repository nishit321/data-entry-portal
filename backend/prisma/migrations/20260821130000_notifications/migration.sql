-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('RETURN_AWAITING_REVIEW', 'RETURN_APPROVED', 'RETURN_REJECTED');

-- CreateEnum
CREATE TYPE "notification_delivery_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link_path" TEXT,
    "submission_id" UUID,
    "read_at" TIMESTAMP(3),
    "email_status" "notification_delivery_status",
    "email_attempts" INTEGER NOT NULL DEFAULT 0,
    "email_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_submission_id_idx" ON "notifications"("submission_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "sms_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sms_error" TEXT,
ADD COLUMN     "sms_provider_ref" TEXT,
ADD COLUMN     "sms_status" "notification_delivery_status";


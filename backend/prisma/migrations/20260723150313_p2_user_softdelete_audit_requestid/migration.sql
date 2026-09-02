-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "request_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

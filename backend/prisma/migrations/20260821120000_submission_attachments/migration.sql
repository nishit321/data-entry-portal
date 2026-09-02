-- CreateEnum
CREATE TYPE "attachment_kind" AS ENUM ('COVERAGE_MAP', 'FIBRE_MAP', 'AGENT_REGISTER', 'OTHER');

-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE 'ATTACHMENT_UPLOADED';
ALTER TYPE "audit_action" ADD VALUE 'ATTACHMENT_DELETED';

-- CreateTable
CREATE TABLE "submission_attachments" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "kind" "attachment_kind" NOT NULL DEFAULT 'OTHER',
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "submission_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submission_attachments_submission_id_idx" ON "submission_attachments"("submission_id");

-- CreateIndex
CREATE INDEX "submission_attachments_deleted_at_idx" ON "submission_attachments"("deleted_at");

-- AddForeignKey
ALTER TABLE "submission_attachments" ADD CONSTRAINT "submission_attachments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

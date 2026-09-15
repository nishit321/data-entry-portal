-- Evidence on a public complaint (NCA, 15 September 2026).
--
-- "Public Complaints: Incorporate an attachment upload option."
--
-- A separate table rather than a column on submission_attachments. That table's rows carry an
-- uploader, and a complaint has none: the filer may be anonymous and in no case holds an account,
-- so the tracking code issued at filing is what authorises the upload. Making the uploader
-- nullable there would have let a return attachment lose its uploader too, which is the one thing
-- that table must always know.
--
-- No foreign key to users, and no public read path. The blob is reachable only through the
-- Authority's case view; the citizen is told the file arrived and nothing further.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'COMPLAINT_ATTACHMENT_UPLOADED';
ALTER TYPE "audit_action" ADD VALUE 'COMPLAINT_ATTACHMENT_REMOVED';

-- CreateTable
CREATE TABLE "complaint_attachments" (
    "id" UUID NOT NULL,
    "complaint_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "complaint_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "complaint_attachments_complaint_id_idx" ON "complaint_attachments"("complaint_id");

-- CreateIndex
CREATE INDEX "complaint_attachments_deleted_at_idx" ON "complaint_attachments"("deleted_at");

-- AddForeignKey
ALTER TABLE "complaint_attachments" ADD CONSTRAINT "complaint_attachments_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

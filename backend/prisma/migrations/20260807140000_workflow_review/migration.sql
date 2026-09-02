-- CreateEnum
CREATE TYPE "review_stage" AS ENUM ('CHECKER', 'VERIFIER', 'APPROVER');

-- CreateEnum
CREATE TYPE "review_decision" AS ENUM ('APPROVE', 'REJECT');

-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE 'SUBMISSION_REVIEWED';
ALTER TYPE "audit_action" ADD VALUE 'SUBMISSION_APPROVED';
ALTER TYPE "audit_action" ADD VALUE 'SUBMISSION_REJECTED';
ALTER TYPE "audit_action" ADD VALUE 'SUBMISSION_RESUBMITTED';

-- DropIndex
DROP INDEX "submissions_entity_id_period_id_key";

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "locked_at" TIMESTAMP(3),
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "review_stage" "review_stage",
ADD COLUMN     "supersedes_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "review_steps" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "stage" "review_stage" NOT NULL,
    "decision" "review_decision" NOT NULL,
    "actor_id" UUID NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_streaks" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "template_name" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_streaks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_steps_submission_id_idx" ON "review_steps"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_streaks_entity_id_template_name_key" ON "compliance_streaks"("entity_id", "template_name");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_supersedes_id_key" ON "submissions"("supersedes_id");

-- CreateIndex
CREATE INDEX "submissions_review_stage_idx" ON "submissions"("review_stage");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_steps" ADD CONSTRAINT "review_steps_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_streaks" ADD CONSTRAINT "compliance_streaks_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

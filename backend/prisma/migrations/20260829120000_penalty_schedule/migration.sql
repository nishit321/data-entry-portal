-- AlterTable
ALTER TABLE "enforcement_cases" ADD COLUMN     "default_ended_at" TIMESTAMP(3),
ADD COLUMN     "default_started_at" TIMESTAMP(3),
ADD COLUMN     "penalty_amount" DECIMAL(18,2),
ADD COLUMN     "penalty_assessed_at" TIMESTAMP(3),
ADD COLUMN     "penalty_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "penalty_rule_id" UUID;

-- CreateTable
CREATE TABLE "penalty_rules" (
    "id" UUID NOT NULL,
    "reason" "enforcement_reason" NOT NULL DEFAULT 'MISSED_DEADLINE',
    "entity_type" "entity_type",
    "fixed_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "daily_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "max_amount" DECIMAL(18,2),
    "label" TEXT,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "penalty_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "penalty_rules_reason_entity_type_idx" ON "penalty_rules"("reason", "entity_type");

-- CreateIndex
CREATE INDEX "penalty_rules_effective_from_idx" ON "penalty_rules"("effective_from");

-- CreateIndex
CREATE INDEX "penalty_rules_deleted_at_idx" ON "penalty_rules"("deleted_at");

-- CreateIndex
CREATE INDEX "enforcement_cases_penalty_rule_id_idx" ON "enforcement_cases"("penalty_rule_id");

-- AddForeignKey
ALTER TABLE "enforcement_cases" ADD CONSTRAINT "enforcement_cases_penalty_rule_id_fkey" FOREIGN KEY ("penalty_rule_id") REFERENCES "penalty_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


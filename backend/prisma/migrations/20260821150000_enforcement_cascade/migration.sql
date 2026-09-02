-- DropForeignKey
ALTER TABLE "enforcement_cases" DROP CONSTRAINT "enforcement_cases_entity_id_fkey";

-- DropForeignKey
ALTER TABLE "enforcement_cases" DROP CONSTRAINT "enforcement_cases_period_id_fkey";

-- AddForeignKey
ALTER TABLE "enforcement_cases" ADD CONSTRAINT "enforcement_cases_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_cases" ADD CONSTRAINT "enforcement_cases_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "reporting_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The non-financial half of Tier 3 (NCA, 3 September 2026).
--
-- "Record as a formal enforcement order on the case — type (suspension full/partial, cancellation,
--  or licence-shortening), reason, legal basis, effective date and duration. Sign-off escalates
--  beyond the officer chain: DG approves a suspension; the Board approves a cancellation."
--
-- Suspension, cancellation and licence-shortening are decisions, not amounts, which is why they
-- are not columns on the penalty schedule. A decision has an author, a legal basis and a date.
--
-- The Board is recorded as a minute reference rather than as an account: a board meets and minutes
-- its decisions, it does not hold a login. Giving it one would put the Authority's most serious
-- sanction behind a shared password and record whichever officer typed it as the person who took
-- the decision.

-- CreateEnum
CREATE TYPE "enforcement_order_type" AS ENUM ('SUSPENSION_FULL', 'SUSPENSION_PARTIAL', 'CANCELLATION', 'LICENCE_SHORTENING');

-- CreateEnum
CREATE TYPE "enforcement_order_status" AS ENUM ('DRAFT', 'APPROVED', 'REVOKED');

-- CreateTable
CREATE TABLE "enforcement_orders" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "type" "enforcement_order_type" NOT NULL,
    "status" "enforcement_order_status" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "legal_basis" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "duration_days" INTEGER,
    "board_minute_ref" TEXT,
    "board_decided_at" TIMESTAMP(3),
    "drafted_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "revoked_by_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "revoked_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enforcement_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enforcement_orders_case_id_idx" ON "enforcement_orders"("case_id");

-- CreateIndex
CREATE INDEX "enforcement_orders_status_idx" ON "enforcement_orders"("status");

-- AddForeignKey
ALTER TABLE "enforcement_orders" ADD CONSTRAINT "enforcement_orders_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "enforcement_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_orders" ADD CONSTRAINT "enforcement_orders_drafted_by_id_fkey" FOREIGN KEY ("drafted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_orders" ADD CONSTRAINT "enforcement_orders_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_orders" ADD CONSTRAINT "enforcement_orders_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


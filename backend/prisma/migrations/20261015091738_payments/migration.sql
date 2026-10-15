-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('LEVY', 'PENALTY');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('BANK_TRANSFER', 'CHEQUE', 'MOBILE_MONEY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'PAYMENT_RECORDED';
ALTER TYPE "audit_action" ADD VALUE 'PAYMENT_REVERSED';

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "kind" "payment_kind" NOT NULL,
    "period_id" UUID,
    "enforcement_case_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" "payment_method" NOT NULL,
    "bank_reference" TEXT NOT NULL,
    "note" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMP(3),
    "reversed_by_id" UUID,
    "reversal_reason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_receipt_number_key" ON "payments"("receipt_number");

-- CreateIndex
CREATE INDEX "payments_entity_id_idx" ON "payments"("entity_id");

-- CreateIndex
CREATE INDEX "payments_period_id_idx" ON "payments"("period_id");

-- CreateIndex
CREATE INDEX "payments_enforcement_case_id_idx" ON "payments"("enforcement_case_id");

-- CreateIndex
CREATE INDEX "payments_paid_on_idx" ON "payments"("paid_on");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "reporting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_enforcement_case_id_fkey" FOREIGN KEY ("enforcement_case_id") REFERENCES "enforcement_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- What the schema cannot say, said in the database.
--
-- A payment is a financial record. The application never edits or deletes one, but "the
-- application never does it" is a convention, and a single `payment.updateMany` added in a hurry
-- would compile, pass every test, and quietly rewrite the Authority's receipts. The audit trail
-- was made append-only in Postgres for the same reason (20260903000000_audit_log_append_only).
--
-- The same caveat applies as there: a superuser can disable a trigger. That is why preflight
-- fails a deployment whose application connects as one.
-- ---------------------------------------------------------------------------------------------

-- Money arrives in positive amounts. A refund is not a negative payment; it is a reversal.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);

-- A levy payment names its period and nothing else; a penalty payment names its case and nothing
-- else. Without this a row could claim to settle both, or neither, and every balance that reads
-- it would have to guess.
ALTER TABLE "payments" ADD CONSTRAINT "payments_charge_matches_kind" CHECK (
  ("kind" = 'LEVY' AND "period_id" IS NOT NULL AND "enforcement_case_id" IS NULL)
  OR ("kind" = 'PENALTY' AND "enforcement_case_id" IS NOT NULL AND "period_id" IS NULL)
);

-- A reversal is all three facts or none of them: when, by whom, and why.
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversal_complete" CHECK (
  ("reversed_at" IS NULL AND "reversed_by_id" IS NULL AND "reversal_reason" IS NULL)
  OR ("reversed_at" IS NOT NULL AND "reversed_by_id" IS NOT NULL AND "reversal_reason" IS NOT NULL)
);

-- And never by the person who recorded the payment. The service refuses this too; this is the
-- floor under it.
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverser_differs" CHECK (
  "reversed_by_id" IS NULL OR "reversed_by_id" <> "recorded_by_id"
);

-- Exactly one change is ever allowed to a payment: reversing it, once. Every other column stays
-- as it was recorded, and a reversed payment stays reversed.
CREATE OR REPLACE FUNCTION payments_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."reversed_at" IS NULL
     AND NEW."reversed_at" IS NOT NULL
     AND ROW(NEW."id", NEW."receipt_number", NEW."entity_id", NEW."kind", NEW."period_id",
             NEW."enforcement_case_id", NEW."amount", NEW."paid_on", NEW."method",
             NEW."bank_reference", NEW."note", NEW."recorded_by_id", NEW."recorded_at")
         IS NOT DISTINCT FROM
         ROW(OLD."id", OLD."receipt_number", OLD."entity_id", OLD."kind", OLD."period_id",
             OLD."enforcement_case_id", OLD."amount", OLD."paid_on", OLD."method",
             OLD."bank_reference", OLD."note", OLD."recorded_by_id", OLD."recorded_at")
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payments cannot be changed once recorded, except to reverse them once'
    USING HINT = 'Reverse the payment with a reason and record the correct one. The receipt that '
                 'was issued has to stay exactly as it was issued.',
          ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE FUNCTION payments_refuse_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payments cannot be deleted: % is not allowed on this table', TG_OP
    USING HINT = 'Reverse it instead. A wipe of a whole server is a dropped and recreated '
                 'database, which this does not stand in the way of.',
          ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS payments_guard_update ON "payments";
CREATE TRIGGER payments_guard_update
  BEFORE UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_guard_update();

DROP TRIGGER IF EXISTS payments_no_delete ON "payments";
CREATE TRIGGER payments_no_delete
  BEFORE DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_refuse_delete();

-- Statement-level, because TRUNCATE fires no row triggers and would otherwise empty the table in
-- one statement while the trigger above sat there looking effective.
DROP TRIGGER IF EXISTS payments_no_truncate ON "payments";
CREATE TRIGGER payments_no_truncate
  BEFORE TRUNCATE ON "payments"
  FOR EACH STATEMENT EXECUTE FUNCTION payments_refuse_delete();

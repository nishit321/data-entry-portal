-- Audit actions for the formal enforcement orders (NCA, 3 September 2026).
--
-- Drafted, approved and revoked are three separate entries rather than one. The approval is the
-- act an operator will contest — it is when a suspension starts having effect — and an audit trail
-- that recorded only "an order happened" could not answer who authorised it or when.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'ENFORCEMENT_ORDER_DRAFTED';
ALTER TYPE "audit_action" ADD VALUE 'ENFORCEMENT_ORDER_APPROVED';
ALTER TYPE "audit_action" ADD VALUE 'ENFORCEMENT_ORDER_REVOKED';


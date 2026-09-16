-- The statutory 30-day remedy notice (NCA, 3 September 2026).
--
-- The Act requires thirty days' notice before any financial penalty. NCA set out exactly how that
-- meets the accrual, and the wording matters because the two obvious readings give very different
-- sums on a long default:
--
--   "From the original late date (after the grace window), but only assessed once the 30-day
--    remedy period lapses unremedied. So nothing is payable during the 30 days, but a defaulter
--    doesn't get a free month either. If they cure within 30 days, only the Tier 1 late charge
--    stands."
--
-- So the notice gates *assessment*, not accrual. `default_started_at` is untouched — the figure is
-- still calculated from the day the return was genuinely late — and these two columns decide when
-- that figure becomes payable.
ALTER TABLE enforcement_cases ADD COLUMN IF NOT EXISTS remedy_notice_at TIMESTAMP(3);
ALTER TABLE enforcement_cases ADD COLUMN IF NOT EXISTS remedy_due_at TIMESTAMP(3);

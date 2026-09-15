-- The USD rate lives on the reporting period it applies to.
--
-- NCA's instruction, and the reasoning is theirs: "store the rate per reporting period with a
-- date, so updating today's rate doesn't silently rewrite last year's audited USD figures".
-- A single current rate would do exactly that — enter this month's number and every prior year's
-- USD column restates itself, including figures that have already been audited and relied on.
--
-- Nullable, because periods already exist and inventing a rate for them would be worse than
-- admitting there was none. Their USD column stays empty until somebody sets it.
ALTER TABLE reporting_periods ADD COLUMN IF NOT EXISTS usd_rate DECIMAL(18, 4);
ALTER TABLE reporting_periods ADD COLUMN IF NOT EXISTS usd_rate_at TIMESTAMP(3);

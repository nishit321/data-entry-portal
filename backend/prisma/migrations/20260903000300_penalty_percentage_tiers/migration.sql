-- The penalty schedule can state the tiers NCA actually has (NCA, 3 September 2026).
--
-- The schedule held fixed + daily + cap, all absolute SSP. That expresses Tier 1 exactly ("late
-- return SSP 500,000/day, capped at SSP 20m") and cannot express the other two at all:
--
--   Tier 2  QoS, coverage, tariffs, float — a % of audited annual revenue, minimum SSP 50m
--   Tier 3  serious or wilful conduct     — up to 10% of gross annual revenue
--
-- Both need a percentage basis, and Tier 2 needs a floor. Without them the Authority could not
-- record its own schedule, which is worse than not applying it: the figures would live in a
-- document somewhere and be worked out by hand.
--
-- Tier 3's non-financial half — suspension, cancellation, shortening the licence period — is not
-- addressed here. It is not an amount, and pretending otherwise would put a number on something
-- the Act does not express as one.
ALTER TABLE penalty_rules ADD COLUMN IF NOT EXISTS min_amount DECIMAL(18, 2);
ALTER TABLE penalty_rules ADD COLUMN IF NOT EXISTS percent_of_revenue DECIMAL(7, 4);

-- What period a scheduled report covers (NCA, 15 September 2026).
--
-- "Report Scheduling: Include date selection functionality." Asked back, and answered: a recurring
-- schedule should send the period that has just closed, rather than a date fixed once when the
-- schedule was made. A fixed date would send the same figures every month.
--
-- Until now every scheduled report was built with no period at all, so each one covered "the
-- latest" whatever that happened to mean for that export. That is the right answer for a
-- compliance report, which is about who has not filed for the period that is open, and the wrong
-- one for a levy statement, which is about a period that has finished settling.
--
-- New schedules default to LAST_CLOSED_PERIOD, which is what NCA asked for. Rows that already
-- exist are set to LATEST_ACTIVITY instead: they were set up when that was the only behaviour, and
-- a migration that quietly changes what an existing report contains is a migration that gets
-- noticed at the wrong moment.

-- CreateEnum
CREATE TYPE "report_coverage" AS ENUM ('LAST_CLOSED_PERIOD', 'LATEST_ACTIVITY');

-- AlterTable
ALTER TABLE "report_schedules" ADD COLUMN "coverage" "report_coverage" NOT NULL DEFAULT 'LAST_CLOSED_PERIOD';

-- Keep every schedule that already exists on the behaviour it was created with.
UPDATE "report_schedules" SET "coverage" = 'LATEST_ACTIVITY';

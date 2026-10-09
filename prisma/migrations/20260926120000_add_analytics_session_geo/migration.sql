-- Visitor location on analytics sessions.
--
-- Analytics already recorded device, OS, browser and referral source but no
-- location, so "which city/state/country do our visitors come from" — and the
-- same question per product — could not be answered at all.
--
-- Resolved from the visitor's IP at ingest via a local GeoLite2 database. The
-- IP itself is deliberately NOT stored: it is the identifying part, and the
-- existing tracker's privacy posture (random visitor id, no fingerprinting,
-- DNT respected) would be undermined by persisting it.
--
-- All nullable with no defaults and no backfill: NULL means "not known", which
-- is exactly the truth for every session recorded before this migration and
-- for private or unroutable addresses afterwards. Reports render those as
-- "Unknown" rather than dropping the session, so visitor totals stay
-- consistent with the existing traffic report.
ALTER TABLE "analytics_sessions" ADD COLUMN "countryCode" TEXT;
ALTER TABLE "analytics_sessions" ADD COLUMN "country" TEXT;
ALTER TABLE "analytics_sessions" ADD COLUMN "region" TEXT;
ALTER TABLE "analytics_sessions" ADD COLUMN "regionCode" TEXT;
ALTER TABLE "analytics_sessions" ADD COLUMN "city" TEXT;

-- Every geo report filters on a date window first and groups by the location
-- column, so date is the trailing column in each composite.
CREATE INDEX "analytics_sessions_countryCode_startedAt_idx" ON "analytics_sessions"("countryCode", "startedAt");
CREATE INDEX "analytics_sessions_region_startedAt_idx" ON "analytics_sessions"("region", "startedAt");
CREATE INDEX "analytics_sessions_city_startedAt_idx" ON "analytics_sessions"("city", "startedAt");

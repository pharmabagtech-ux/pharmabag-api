-- AlterTable
ALTER TABLE "analytics_sessions" ADD COLUMN "sourceCategory" TEXT;
ALTER TABLE "analytics_sessions" ADD COLUMN "referrerDomain" TEXT;

-- CreateIndex
CREATE INDEX "analytics_sessions_sourceCategory_startedAt_idx" ON "analytics_sessions"("sourceCategory", "startedAt");

-- CreateIndex
CREATE INDEX "analytics_sessions_referrerDomain_idx" ON "analytics_sessions"("referrerDomain");

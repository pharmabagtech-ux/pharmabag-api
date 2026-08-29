-- AlterTable
ALTER TABLE "analytics_sessions" ADD COLUMN "deviceType" TEXT;
ALTER TABLE "analytics_sessions" ADD COLUMN "os" TEXT;
ALTER TABLE "analytics_sessions" ADD COLUMN "browser" TEXT;

-- CreateIndex
CREATE INDEX "analytics_sessions_deviceType_startedAt_idx" ON "analytics_sessions"("deviceType", "startedAt");

-- CreateIndex
CREATE INDEX "analytics_sessions_os_startedAt_idx" ON "analytics_sessions"("os", "startedAt");

-- CreateIndex
CREATE INDEX "analytics_sessions_browser_startedAt_idx" ON "analytics_sessions"("browser", "startedAt");

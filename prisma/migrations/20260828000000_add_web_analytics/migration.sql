-- CreateTable "analytics_visitors"
CREATE TABLE "analytics_visitors" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "firstSource" TEXT,
    "firstMedium" TEXT,
    "firstCampaign" TEXT,
    "firstReferrer" TEXT,
    "firstLanding" TEXT,
    "sessionsCount" INTEGER NOT NULL DEFAULT 0,
    "pageviewsCount" INTEGER NOT NULL DEFAULT 0,
    "isBot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "analytics_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable "analytics_sessions"
CREATE TABLE "analytics_sessions" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryPage" TEXT,
    "exitPage" TEXT,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "events" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "referrer" TEXT,
    "clickIds" JSONB,
    "userAgent" TEXT,
    "isNewVisitor" BOOLEAN NOT NULL DEFAULT false,
    "isBot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "analytics_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable "analytics_events"
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT,
    "name" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "page" TEXT,
    "productId" TEXT,
    "props" JSONB,
    "isBot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_visitors_lastSeenAt_idx" ON "analytics_visitors"("lastSeenAt");

-- CreateIndex
CREATE INDEX "analytics_visitors_userId_idx" ON "analytics_visitors"("userId");

-- CreateIndex
CREATE INDEX "analytics_sessions_visitorId_idx" ON "analytics_sessions"("visitorId");

-- CreateIndex
CREATE INDEX "analytics_sessions_lastEventAt_idx" ON "analytics_sessions"("lastEventAt");

-- CreateIndex
CREATE INDEX "analytics_events_ts_idx" ON "analytics_events"("ts");

-- CreateIndex
CREATE INDEX "analytics_events_name_ts_idx" ON "analytics_events"("name", "ts");

-- CreateIndex
CREATE INDEX "analytics_events_visitorId_ts_idx" ON "analytics_events"("visitorId", "ts");

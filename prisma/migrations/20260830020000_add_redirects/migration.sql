-- CreateEnum
CREATE TYPE "RedirectSource" AS ENUM ('MANUAL', 'PRODUCT_RENAME');

-- CreateTable "url_redirects"
CREATE TABLE "url_redirects" (
    "id" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 301,
    "source" "RedirectSource" NOT NULL DEFAULT 'MANUAL',
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "url_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable "not_found_hits"
CREATE TABLE "not_found_hits" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReferrer" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "not_found_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "url_redirects_fromPath_key" ON "url_redirects"("fromPath");

-- CreateIndex
CREATE UNIQUE INDEX "not_found_hits_path_key" ON "not_found_hits"("path");

-- CreateIndex
CREATE INDEX "not_found_hits_resolved_hits_idx" ON "not_found_hits"("resolved", "hits");

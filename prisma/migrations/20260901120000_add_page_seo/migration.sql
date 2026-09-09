-- Per-page SEO overrides, keyed by storefront path.
--
-- Path-keyed rather than (entityType, entityId): every storefront page already
-- knows its own path, so one lookup serves products, categories, dosage forms,
-- brands, molecules, locations, blog posts and static pages alike. entityType
-- and entityId are carried for reference and admin filtering only.
CREATE TABLE "page_seo" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "title" TEXT,
    "description" TEXT,
    "canonicalUrl" TEXT,
    "robots" TEXT,
    "ogTitle" TEXT,
    "ogDescription" TEXT,
    "ogImage" TEXT,
    "twitterCard" TEXT,
    "focusKeyword" TEXT,
    "secondaryKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entityDescription" TEXT,
    "aiSummary" TEXT,
    "faq" JSONB,
    "structuredData" JSONB,
    "imageAlts" JSONB,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "page_seo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "page_seo_path_key" ON "page_seo"("path");
CREATE INDEX "page_seo_entityType_idx" ON "page_seo"("entityType");
CREATE INDEX "page_seo_updatedAt_idx" ON "page_seo"("updatedAt");

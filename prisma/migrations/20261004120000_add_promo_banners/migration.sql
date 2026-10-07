-- CreateEnum
CREATE TYPE "BannerScope" AS ENUM ('HOMEPAGE', 'ALL_CATEGORIES', 'CATEGORY');

-- CreateTable
CREATE TABLE "promo_banners" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "mobileImageUrl" TEXT,
    "altText" TEXT NOT NULL,
    "linkUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_banner_placements" (
    "id" TEXT NOT NULL,
    "bannerId" TEXT NOT NULL,
    "scope" "BannerScope" NOT NULL,
    "categoryId" TEXT,

    CONSTRAINT "promo_banner_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promo_banners_active_position_idx" ON "promo_banners"("active", "position");

-- CreateIndex
CREATE INDEX "promo_banner_placements_scope_categoryId_idx" ON "promo_banner_placements"("scope", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "promo_banner_placements_bannerId_scope_categoryId_key" ON "promo_banner_placements"("bannerId", "scope", "categoryId");

-- AddForeignKey
ALTER TABLE "promo_banner_placements" ADD CONSTRAINT "promo_banner_placements_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "promo_banners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_banner_placements" ADD CONSTRAINT "promo_banner_placements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

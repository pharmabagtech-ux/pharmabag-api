-- Per-image SEO alt text. NULL means the storefront renders its automatic
-- default: "<product name> - PharmaBag".
ALTER TABLE "master_product_images" ADD COLUMN "altText" TEXT;

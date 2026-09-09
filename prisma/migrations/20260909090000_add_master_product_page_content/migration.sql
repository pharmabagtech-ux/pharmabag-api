-- Editable page content on the product itself.
--
-- `pageIntro` overrides the generated "About <product>" paragraph; `faq`
-- overrides the generated FAQ list, which is also what feeds the FAQPage
-- structured data on the product page.
--
-- On MasterProduct rather than in the path-keyed page_seo table on purpose:
-- product slugs get REWRITTEN by bulk uploads (the reason the redirects
-- manager exists), and a path-keyed row would be silently orphaned by a
-- rename — the admin would see their FAQs vanish from a live page with no
-- error anywhere.
--
-- Nullable, no defaults: NULL means "the storefront generates this", so
-- adding the columns changes no live page.
ALTER TABLE "master_products" ADD COLUMN "pageIntro" TEXT;
ALTER TABLE "master_products" ADD COLUMN "faq" JSONB;

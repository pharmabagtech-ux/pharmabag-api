-- On-page content overrides, on top of the head/meta overrides in page_seo.
--
-- The head fields alone let an admin change what Google lists. These three let
-- an admin change what a visitor actually reads: the heading, the opening
-- paragraph and the prose block a landing page carries. Without them the words
-- on ~1,640 landing pages stay locked in the storefront's page templates.
--
-- Nullable with no default, like every other column here: NULL means "the
-- storefront generates this", so adding the columns changes no live page.
ALTER TABLE "page_seo" ADD COLUMN "h1" TEXT;
ALTER TABLE "page_seo" ADD COLUMN "intro" TEXT;
ALTER TABLE "page_seo" ADD COLUMN "bodyHtml" TEXT;

-- Sellers can already choose "Special / Fixed Price" in the seller portal, but
-- the enum had no matching value, so every save was rejected by the DTO with
-- "discountType must be one of the following values: ...".
--
-- Additive only: adding a label to an enum rewrites no rows and invalidates no
-- existing value, so listings already stored keep working untouched.
-- IF NOT EXISTS keeps this safe to re-run.
ALTER TYPE "DiscountType" ADD VALUE IF NOT EXISTS 'SPECIAL_PRICE';

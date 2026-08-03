import { Prisma } from '@prisma/client';

/**
 * What makes a seller listing visible to a buyer.
 *
 * Three conditions, and all three must travel together:
 *   isActive          - the seller has not paused this listing
 *   deletedAt: null   - the listing has not been removed
 *   seller.isVacation - the seller is not away
 *
 * The vacation condition was the missing one. `isVacation` was stored on
 * SellerProfile and toggled from the seller dashboard, which told the seller
 * "Your store is now hidden from buyers" — but no query ever read it, so the
 * listings stayed fully visible and purchasable. A seller who went away
 * trusting that message would keep taking orders they could not fulfil.
 *
 * It lives in one constant rather than being written out at each call site
 * because that is exactly how it went missing. Two rules in this codebase have
 * already shipped to some surfaces and not others (the 20k minimum and the
 * scheme lot stepping); a listing-visibility rule copied by hand into eight
 * places would go the same way. Import this instead.
 */
export const ACTIVE_LISTING: Prisma.ProductWhereInput = {
  isActive: true,
  deletedAt: null,
  seller: { isVacation: false },
};

/**
 * The same rule with extra conditions merged in, for the call sites that need
 * more than the base (a category filter, a discount filter, and so on).
 */
export function activeListing(
  extra: Prisma.ProductWhereInput = {},
): Prisma.ProductWhereInput {
  return { ...ACTIVE_LISTING, ...extra };
}

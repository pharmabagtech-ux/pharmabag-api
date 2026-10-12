import { Prisma } from '@prisma/client';

/**
 * What makes a seller listing visible to a buyer.
 *
 * Four conditions, and all four must travel together:
 *   isActive            - the seller has not paused this listing
 *   deletedAt: null     - the listing has not been removed
 *   seller.isVacation   - the seller is not away
 *   seller.user.status  - the seller's account is not blocked
 *
 * The vacation condition was the missing one. `isVacation` was stored on
 * SellerProfile and toggled from the seller dashboard, which told the seller
 * "Your store is now hidden from buyers" — but no query ever read it, so the
 * listings stayed fully visible and purchasable. A seller who went away
 * trusting that message would keep taking orders they could not fulfil.
 *
 * The blocked condition was the same gap one field over. `User.status =
 * BLOCKED` was only ever read by auth (auth.service + jwt.strategy refuse the
 * login), so blocking a seller locked them out of their own account while
 * leaving every listing live and purchasable — buyers could still order from a
 * seller who could no longer sign in to fulfil it. `blockUser` is also exactly
 * what `deleteUser` tells admins to use instead when an account has traded, so
 * it has to actually take the seller off the storefront.
 *
 * BLOCKED only, deliberately: PENDING / NEW / REJECTED sellers are left
 * visible because that is the status a good deal of the live catalogue sits
 * in, and hiding them here would silently empty the storefront.
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
  seller: {
    isVacation: false,
    user: { status: { not: 'BLOCKED' } },
  },
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

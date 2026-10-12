import { ACTIVE_LISTING, activeListing } from './active-listing';

/**
 * Vacation mode was stored, toggled and displayed — the seller dashboard even
 * said "Your store is now hidden from buyers" — but no query ever read the
 * flag, so listings stayed visible and purchasable. Verified in production:
 * a seller with isVacation = true still had three offers live on the public
 * API.
 *
 * These pin the shape of the rule. The reason it belongs in one constant is
 * that this codebase has twice shipped a listing rule to some surfaces and not
 * others (the 20k minimum, the scheme lot stepping).
 */
/**
 * The same gap again, one field over. Blocking a seller set User.status =
 * BLOCKED, which auth reads (they cannot log in) — but no storefront query
 * read it, so a blocked seller's listings stayed visible AND purchasable.
 * Verified from production: seller 8985505636 showed BLOCKED in
 * admin.pharmabag.in/users?status=BLOCKED while its offers were still live
 * under "2 VERIFIED SELLERS" on the public product page.
 *
 * Blocking is the tool the delete guard tells admins to reach for
 * (admin.delete-user-guard.spec.ts), so it has to actually take a seller off
 * the storefront.
 */
describe('ACTIVE_LISTING', () => {
  it('requires the seller not to be on vacation', () => {
    expect((ACTIVE_LISTING.seller as any).isVacation).toBe(false);
  });

  it('excludes listings whose seller account is blocked', () => {
    expect((ACTIVE_LISTING.seller as any).user).toEqual({
      status: { not: 'BLOCKED' },
    });
  });

  it('still requires the listing to be active and not deleted', () => {
    expect(ACTIVE_LISTING.isActive).toBe(true);
    expect(ACTIVE_LISTING.deletedAt).toBeNull();
  });

  it('carries all four conditions, so none can be applied without the others', () => {
    expect(Object.keys(ACTIVE_LISTING).sort()).toEqual([
      'deletedAt',
      'isActive',
      'seller',
    ]);
    expect(Object.keys(ACTIVE_LISTING.seller as any).sort()).toEqual([
      'isVacation',
      'user',
    ]);
  });
});

describe('activeListing()', () => {
  it('merges extra conditions without dropping the seller rules', () => {
    const where = activeListing({ discountType: { not: null } });
    expect(where.seller).toEqual({
      isVacation: false,
      user: { status: { not: 'BLOCKED' } },
    });
    expect(where.isActive).toBe(true);
    expect(where.discountType).toEqual({ not: null });
  });

  it('is a fresh object each call, so a caller cannot mutate the shared rule', () => {
    const a = activeListing({ sellerId: 'x' });
    expect(ACTIVE_LISTING).not.toHaveProperty('sellerId');
    expect(a).not.toBe(ACTIVE_LISTING);
  });

  it('lets a caller narrow, but the seller rules survive a spread', () => {
    // the shape used at the call sites: { id, ...ACTIVE_LISTING }
    const where = { id: 'product-1', ...ACTIVE_LISTING };
    expect(where.seller).toEqual({
      isVacation: false,
      user: { status: { not: 'BLOCKED' } },
    });
    expect(where.id).toBe('product-1');
  });
});

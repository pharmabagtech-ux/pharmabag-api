import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * Deleting one user destroyed other people's financial records.
 *
 * The old `deleteUser` cleared the foreign keys that were in its way rather
 * than respecting what they protected, and its own comment admitted the
 * consequence ("might leave orders empty or with incorrect totals"):
 *
 *  - Deleting a SELLER ran `orderItem.deleteMany({ sellerId })`, pulling that
 *    seller's lines out of OTHER BUYERS' completed orders, and
 *    `sellerSettlement.deleteMany`, erasing the record of money paid or owed.
 *  - Deleting a BUYER cascades User → Order → OrderItem, taking every seller's
 *    record of those sales with it; the settlements attached to those items
 *    were pre-deleted purely to unblock the cascade.
 *
 * A user who has traded can no longer be hard-deleted. A user who has not —
 * the abandoned signups and test accounts this button is actually for —
 * deletes exactly as before.
 */

const USER = 'user-1';
const SELLER_PROFILE = 'seller-profile-1';

interface Counts {
  orders?: number;
  orderItems?: number;
  settlements?: number;
}

interface Harness {
  service: AdminService;
  deleted: string[];
  destructive: string[];
}

const makeService = (
  user: { role: string; sellerProfile?: any; buyerProfile?: any },
  counts: Counts = {},
): Harness => {
  const deleted: string[] = [];
  /** Any write that would touch a record belonging to someone else. */
  const destructive: string[] = [];

  const tx: any = {
    sellerSettlement: {
      deleteMany: async () => {
        destructive.push('sellerSettlement.deleteMany');
        return {};
      },
    },
    orderItem: {
      deleteMany: async () => {
        destructive.push('orderItem.deleteMany');
        return {};
      },
    },
    customOrder: { deleteMany: async () => ({}) },
    referralCode: { updateMany: async () => ({}) },
    notificationBroadcast: { deleteMany: async () => ({}) },
    order: { findMany: async () => [] },
    user: {
      delete: async (args: any) => {
        deleted.push(args.where.id);
        return { id: args.where.id };
      },
    },
  };

  const prisma: any = {
    user: { findUnique: async () => ({ id: USER, ...user }) },
    order: { count: async () => counts.orders ?? 0 },
    orderItem: { count: async () => counts.orderItems ?? 0 },
    sellerSettlement: { count: async () => counts.settlements ?? 0 },
    $transaction: async (fn: any) => fn(tx),
  };

  // `deleteUser` touches neither of the other two collaborators, but the
  // constructor takes them and `tsc --noEmit` is part of the build — a spec
  // that only satisfies ts-jest would break CI.
  const unused: any = {};
  const service = new AdminService(prisma, unused, unused);
  return { service, deleted, destructive };
};

describe('AdminService.deleteUser — protects the counterparty', () => {
  it('refuses to delete a SELLER who has sold to other buyers', async () => {
    const { service, deleted, destructive } = makeService(
      { role: 'SELLER', sellerProfile: { id: SELLER_PROFILE } },
      { orderItems: 12, settlements: 3 },
    );

    await expect(service.deleteUser(USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(deleted).toHaveLength(0);
    // Crucially: it must not have "cleared the way" first.
    expect(destructive).toHaveLength(0);
  });

  it('refuses to delete a BUYER who has placed orders', async () => {
    const { service, deleted, destructive } = makeService(
      { role: 'BUYER', buyerProfile: { id: 'buyer-profile-1' } },
      { orders: 4 },
    );

    await expect(service.deleteUser(USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(deleted).toHaveLength(0);
    expect(destructive).toHaveLength(0);
  });

  it('names what is blocking, so the admin is not guessing', async () => {
    const { service } = makeService(
      { role: 'SELLER', sellerProfile: { id: SELLER_PROFILE } },
      { orderItems: 1, settlements: 2 },
    );

    await expect(service.deleteUser(USER)).rejects.toThrow(
      /1 order line sold to other buyers.*2 settlement records/,
    );
  });

  it('still deletes a user with no trading history', async () => {
    const { service, deleted, destructive } = makeService({
      role: 'BUYER',
      buyerProfile: { id: 'buyer-profile-1' },
    });

    await service.deleteUser(USER);

    expect(deleted).toEqual([USER]);
    expect(destructive).toHaveLength(0);
  });

  it('still deletes a seller who never sold anything', async () => {
    const { service, deleted } = makeService({
      role: 'SELLER',
      sellerProfile: { id: SELLER_PROFILE },
    });

    await service.deleteUser(USER);

    expect(deleted).toEqual([USER]);
  });
});

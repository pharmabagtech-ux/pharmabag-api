import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * Two buyers could both buy the last stock.
 *
 * The pre-flight check at the top of `checkout` runs OUTSIDE the transaction,
 * and the decrement inside it was unconditional — `{ decrement }` with no
 * guard on the current value — computed from `batch.stock` as it looked during
 * that earlier read. Two checkouts for the last 100 units both validated, both
 * decremented, and the batch went to -100: two orders accepted for goods that
 * exist once.
 *
 * The fix makes each deduction a conditional `updateMany` (`stock >= deduct`),
 * so the loser matches no rows, cannot fill the line, and has its whole
 * transaction rolled back. Whoever checks out first wins outright.
 *
 * These tests drive the real `checkout` against a fake Prisma whose
 * `productBatch` behaves like Postgres for this one operation: `updateMany`
 * applies only if the WHERE still matches the CURRENT value.
 */

const PRODUCT = 'product-1';
const BATCH = 'batch-1';

/** A fake batch table that honours conditional updates, like the DB does. */
const makeStore = (initialStock: number) => {
  const rows: Record<string, { id: string; productId: string; stock: number; expiryDate: Date }> = {
    [BATCH]: { id: BATCH, productId: PRODUCT, stock: initialStock, expiryDate: new Date() },
  };
  return {
    rows,
    productBatch: {
      findMany: async ({ where }: any) =>
        Object.values(rows).filter(
          (r) => r.productId === where.productId && r.stock > 0,
        ),
      updateMany: async ({ where, data }: any) => {
        const row = rows[where.id];
        const need = data.stock.decrement;
        // The guard the fix adds. Without it this is an unconditional write.
        if (!row || (where.stock?.gte !== undefined && row.stock < where.stock.gte)) {
          return { count: 0 };
        }
        row.stock -= need;
        return { count: 1 };
      },
      update: async ({ where, data }: any) => {
        rows[where.id].stock -= data.stock.decrement;
        return rows[where.id];
      },
    },
  };
};

const makeService = (store: ReturnType<typeof makeStore>, quantity: number) => {
  const cart = {
    id: 'cart-1',
    items: [
      {
        quantity,
        unitPrice: 25000,
        product: {
          id: PRODUCT,
          name: 'Sinarest Syrup 75 mL',
          isActive: true,
          deletedAt: null,
          gstPercent: 12,
          sellerId: 'seller-1',
          seller: { verificationStatus: 'VERIFIED', isVacation: false, companyName: 'S' },
          // Pre-flight view of stock — deliberately the STALE numbers.
          batches: Object.values(store.rows).map((r) => ({ ...r })),
        },
      },
    ],
  };

  const prisma: any = {
    cart: { findUnique: async () => cart },
    // A fully onboarded buyer — the checks before the stock logic are not
    // what these tests are about.
    buyerProfile: {
      findUnique: async () => ({
        id: 'buyer-1',
        legalName: 'Test Pharmacy',
        verificationStatus: 'VERIFIED',
        creditTier: 'PREPAID',
        referralCodeId: null,
      }),
    },
    order: { findUnique: async () => ({ id: 'order-1', items: [] }) },
    $transaction: async (fn: any) =>
      fn({
        order: { create: async () => ({ id: 'order-1' }) },
        orderItem: { create: async () => ({}), createMany: async () => ({}) },
        orderAddress: { create: async () => ({}) },
        cartItem: { deleteMany: async () => ({}) },
        productBatch: store.productBatch,
      }),
  };

  return new OrdersService(prisma);
};

const dto: any = {
  name: 'A',
  phone: '9000000000',
  address: 'x',
  city: 'Mumbai',
  state: 'MH',
  pincode: '400001',
};

describe('OrdersService.checkout — concurrent stock', () => {
  it('lets only ONE of two buyers take the last units', async () => {
    // 100 units on the shelf; both buyers try to take all 100.
    const store = makeStore(100);
    const a = makeService(store, 100);
    const b = makeService(store, 100);

    const results = await Promise.allSettled([
      a.checkout('user-a', dto),
      b.checkout('user-b', dto),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      BadRequestException,
    );

    // The whole point: stock never goes negative.
    expect(store.rows[BATCH].stock).toBe(0);
  });

  it('never lets stock go negative even when the pre-flight read was stale', async () => {
    const store = makeStore(10);
    const service = makeService(store, 10);

    // Someone else empties the shelf after the cart was read.
    store.rows[BATCH].stock = 0;

    await expect(service.checkout('user-a', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.rows[BATCH].stock).toBe(0);
  });

  it('tells the buyer how short the order fell', async () => {
    const store = makeStore(10);
    const service = makeService(store, 10);
    store.rows[BATCH].stock = 4; // 6 short

    await expect(service.checkout('user-a', dto)).rejects.toThrow(
      /6 of the 10 units you ordered are no longer available/,
    );
  });

  it('still completes a normal checkout and deducts exactly once', async () => {
    const store = makeStore(100);
    const service = makeService(store, 30);

    await service.checkout('user-a', dto);

    expect(store.rows[BATCH].stock).toBe(70);
  });
});

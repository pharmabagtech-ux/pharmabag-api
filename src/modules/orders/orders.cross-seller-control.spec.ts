import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OrdersService } from './orders.service';

/**
 * Checkout puts every seller's lines into ONE order, and the status lives on
 * that order rather than per line. `updateOrderStatus` verified only that the
 * caller had SOME item in it, then wrote the order-level status.
 *
 * So a seller holding one cheap line in a three-seller bag could:
 *   - drive the whole order to DELIVERED, which mints sellerSettlement rows
 *     for EVERY item in it — booking the other two sellers as owed for goods
 *     they never shipped; or
 *   - pass CANCELLED, which falls through to cancelOrder, whose permission
 *     block only ever tested for Role.BUYER — so a seller walked straight
 *     through and destroyed the other sellers' sales, restoring their stock.
 *
 * There is no per-seller fulfilment status to fall back on, so a shared order
 * is not something one seller can decide.
 */

const SELLER_A = { id: 'seller-a', userId: 'user-a' };

const makeService = (opts: {
  sellerItems: any[];
  totalItems: number;
  orderItems?: any[];
  orderStatus?: string;
}) => {
  const prisma = {
    sellerProfile: { findUnique: jest.fn().mockResolvedValue(SELLER_A) },
    orderItem: {
      findMany: jest.fn().mockResolvedValue(opts.sellerItems),
      count: jest.fn().mockResolvedValue(opts.totalItems),
    },
    order: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        buyerId: 'buyer-1',
        orderStatus: opts.orderStatus ?? 'PLACED',
        paymentStatus: 'PENDING',
        items: opts.orderItems ?? [],
      }),
      update: jest.fn().mockResolvedValue({ id: 'order-1', items: [] }),
    },
    sellerSettlement: { findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };

  return { service: new OrdersService(prisma as any) as any, prisma };
};

describe('updateOrderStatus — a seller cannot move a shared order', () => {
  it('refuses when the order also holds another seller items', async () => {
    const { service, prisma } = makeService({
      sellerItems: [{ id: 'item-1', sellerId: 'seller-a' }],
      totalItems: 3,
    });

    await expect(
      service.updateOrderStatus('user-a', 'order-1', { status: 'DELIVERED' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Nothing was written.
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('says why, so the seller knows to contact support', async () => {
    const { service } = makeService({
      sellerItems: [{ id: 'item-1', sellerId: 'seller-a' }],
      totalItems: 2,
    });

    await expect(
      service.updateOrderStatus('user-a', 'order-1', { status: 'ACCEPTED' }),
    ).rejects.toThrow(/more than one seller/i);
  });

  it('still allows a seller to move an order that is entirely theirs', async () => {
    const { service, prisma } = makeService({
      sellerItems: [
        { id: 'item-1', sellerId: 'seller-a' },
        { id: 'item-2', sellerId: 'seller-a' },
      ],
      totalItems: 2,
    });

    await service.updateOrderStatus('user-a', 'order-1', { status: 'ACCEPTED' });

    expect(prisma.order.update).toHaveBeenCalled();
  });

  it('still refuses a seller with no items at all', async () => {
    const { service } = makeService({ sellerItems: [], totalItems: 4 });

    await expect(
      service.updateOrderStatus('user-a', 'order-1', { status: 'ACCEPTED' }),
    ).rejects.toThrow(/do not have any items/i);
  });
});

describe('cancelOrder — sellers were never permission-checked', () => {
  it('refuses a seller cancelling an order containing other sellers goods', async () => {
    const { service } = makeService({
      sellerItems: [{ id: 'item-1', sellerId: 'seller-a' }],
      totalItems: 2,
      orderItems: [
        { id: 'item-1', sellerId: 'seller-a', product: { batches: [] }, quantity: 1 },
        { id: 'item-2', sellerId: 'seller-b', product: { batches: [] }, quantity: 1 },
      ],
    });

    await expect(
      service.cancelOrder('user-a', 'order-1', Role.SELLER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a seller with no profile', async () => {
    const { service, prisma } = makeService({
      sellerItems: [],
      totalItems: 1,
      orderItems: [{ id: 'item-1', sellerId: 'seller-b', product: { batches: [] }, quantity: 1 }],
    });
    prisma.sellerProfile.findUnique.mockResolvedValue(null);

    await expect(
      service.cancelOrder('nobody', 'order-1', Role.SELLER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still refuses a buyer cancelling someone else order', async () => {
    const { service } = makeService({
      sellerItems: [],
      totalItems: 1,
      orderItems: [],
    });

    await expect(
      service.cancelOrder('another-buyer', 'order-1', Role.BUYER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

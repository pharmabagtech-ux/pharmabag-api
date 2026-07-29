import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * A seller opening an order they participate in must see ONLY their own line
 * items. Previously getOrderDetail returned the entire order to any seller
 * holding at least one item, exposing other sellers' products, quantities,
 * prices, company details and settlement records — and showing order-wide
 * totals against a single seller's item.
 *
 * getSellerOrders (the list view) already scopes to the seller's own items and
 * sums a sellerTotal; this pins the same contract for the detail view.
 */
const SELLER_A = 'seller-a';
const SELLER_B = 'seller-b';

const orderFixture = {
  id: 'order-1',
  buyerId: 'buyer-1',
  totalAmount: 65163,
  totalGstAmount: 4463,
  items: [
    {
      id: 'item-1',
      sellerId: SELLER_A,
      quantity: 40,
      unitPrice: 500,
      totalPrice: 20000,
      product: { id: 'p1', name: 'Telekast 10mg Tablet', gstPercent: 12 },
    },
    {
      id: 'item-2',
      sellerId: SELLER_B,
      quantity: 29,
      unitPrice: 700,
      totalPrice: 20300,
      product: { id: 'p2', name: 'Citelec 500mg Tablet', gstPercent: 12 },
    },
    {
      id: 'item-3',
      sellerId: SELLER_B,
      quantity: 30,
      unitPrice: 680,
      totalPrice: 20400,
      product: { id: 'p3', name: '3-Nite Vag Capsule', gstPercent: 12 },
    },
  ],
  address: { city: 'Kolkata' },
};

const makeService = (user: any) => {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    order: {
      findUnique: jest
        .fn()
        .mockResolvedValue(JSON.parse(JSON.stringify(orderFixture))),
    },
  };
  return new OrdersService(prisma as any);
};

describe('OrdersService.getOrderDetail — seller scoping', () => {
  it('returns only the requesting seller\'s items', async () => {
    const service = makeService({
      role: 'SELLER',
      sellerProfile: { id: SELLER_A },
    });

    const order: any = await service.getOrderDetail('user-a', 'order-1');

    expect(order.items).toHaveLength(1);
    expect(order.items[0].product.name).toBe('Telekast 10mg Tablet');
    const names = order.items.map((i: any) => i.product.name);
    expect(names).not.toContain('Citelec 500mg Tablet');
    expect(names).not.toContain('3-Nite Vag Capsule');
  });

  it('reports totals for the seller\'s own items, not the whole order', async () => {
    const service = makeService({
      role: 'SELLER',
      sellerProfile: { id: SELLER_A },
    });

    const order: any = await service.getOrderDetail('user-a', 'order-1');

    // 20000 subtotal + 12% GST = 22400, NOT the order-wide 65163
    expect(order.sellerTotal).toBe(20000);
    expect(order.totalGstAmount).toBe(2400);
    expect(order.totalAmount).toBe(22400);
  });

  it('still returns every item to the buyer who placed the order', async () => {
    const service = makeService({ role: 'BUYER', sellerProfile: null });

    const order: any = await service.getOrderDetail('buyer-1', 'order-1');

    expect(order.items).toHaveLength(3);
    expect(order.totalAmount).toBe(65163);
  });

  it('still returns every item to an admin', async () => {
    const service = makeService({ role: 'ADMIN', sellerProfile: null });

    const order: any = await service.getOrderDetail('admin-1', 'order-1');

    expect(order.items).toHaveLength(3);
    expect(order.totalAmount).toBe(65163);
  });

  it('hides the order from a seller with no item in it', async () => {
    const service = makeService({
      role: 'SELLER',
      sellerProfile: { id: 'seller-c' },
    });

    await expect(
      service.getOrderDetail('user-c', 'order-1'),
    ).rejects.toThrow(NotFoundException);
  });
});

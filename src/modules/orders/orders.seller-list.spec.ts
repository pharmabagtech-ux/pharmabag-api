import { OrdersService } from './orders.service';

/**
 * The seller portal must report the same money the buyer was charged.
 *
 * `getSellerOrders` summed only `item.totalPrice`, which is GST-EXCLUSIVE, and
 * the product select did not even fetch `gstPercent` — so the list could not
 * have included tax if it wanted to. A seller therefore saw a smaller figure
 * than the buyer paid for the very same order (reported from production:
 * ₹68,648.72 shown against an order the buyer paid GST on top of).
 *
 * Contract pinned here:
 *   sellerTotal     — GST-EXCLUSIVE, the settlement basis (commission is 5%
 *                     of goods value, so this must NOT gain tax)
 *   totalGstAmount  — GST on this seller's items only
 *   totalAmount     — GST-INCLUSIVE, what the buyer paid for those items
 *
 * Rounding mirrors `checkout`: sum raw, round each total once. Rounding per
 * item first can land a rupee away from the charged figure.
 */
const SELLER_A = 'seller-a';

/** Mirrors the real order in the report: three lines, mixed GST slabs. */
const itemsFixture = [
  {
    id: 'item-1',
    order: {
      id: 'order-1',
      orderStatus: 'PLACED',
      paymentStatus: 'PENDING',
      createdAt: new Date('2026-08-02T09:35:00Z'),
      address: null,
    },
    quantity: 36,
    unitPrice: 630.85,
    totalPrice: 22710.6,
    product: { id: 'p1', name: '1 AL 5mg Tablet', gstPercent: 5 },
  },
  {
    id: 'item-2',
    order: {
      id: 'order-1',
      orderStatus: 'PLACED',
      paymentStatus: 'PENDING',
      createdAt: new Date('2026-08-02T09:35:00Z'),
      address: null,
    },
    quantity: 100,
    unitPrice: 170,
    totalPrice: 17000,
    product: { id: 'p2', name: 'Amarsundri Ghutika', gstPercent: 12 },
  },
  {
    id: 'item-3',
    order: {
      id: 'order-1',
      orderStatus: 'PLACED',
      paymentStatus: 'PENDING',
      createdAt: new Date('2026-08-02T09:35:00Z'),
      address: null,
    },
    quantity: 28,
    unitPrice: 641.97,
    totalPrice: 17975.16,
    product: { id: 'p3', name: 'Bon K2 HD Tablet', gstPercent: 12 },
  },
];

function buildService(items: any[]) {
  const prisma: any = {
    // getSellerOrders resolves the seller profile from the user id first.
    sellerProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: SELLER_A, userId: SELLER_A }),
    },
    orderItem: { findMany: jest.fn().mockResolvedValue(items) },
  };
  return new OrdersService(prisma);
}

/** The exact arithmetic `checkout` performs, for cross-checking. */
function checkoutTotals(items: any[]) {
  let subtotal = 0;
  let gst = 0;
  for (const it of items) {
    subtotal += it.totalPrice;
    gst += it.totalPrice * ((it.product.gstPercent ?? 12) / 100);
  }
  return { subtotal: Math.round(subtotal), gst: Math.round(gst) };
}

describe('getSellerOrders — totals match what the buyer paid', () => {
  it('returns a GST-INCLUSIVE totalAmount', async () => {
    const service = buildService(itemsFixture);
    const [order] = await service.getSellerOrders(SELLER_A);

    const expected = checkoutTotals(itemsFixture);
    expect(order.totalGstAmount).toBe(expected.gst);
    expect(order.totalAmount).toBe(expected.subtotal + expected.gst);
    // The whole point: the inclusive figure is strictly larger than the old one.
    expect(order.totalAmount).toBeGreaterThan(order.sellerTotal);
  });

  it('keeps sellerTotal GST-EXCLUSIVE, because it is the settlement basis', async () => {
    const service = buildService(itemsFixture);
    const [order] = await service.getSellerOrders(SELLER_A);

    const goodsValue = itemsFixture.reduce((s, i) => s + i.totalPrice, 0);
    expect(order.sellerTotal).toBe(Math.round(goodsValue));
    // 5% commission must still be taken on goods value, never on tax.
    expect(order.sellerTotal).toBeLessThan(order.totalAmount);
  });

  it('exposes per-item gstPercent and gstAmount so a line can be reconciled', async () => {
    const service = buildService(itemsFixture);
    const [order] = await service.getSellerOrders(SELLER_A);

    expect(order.items).toHaveLength(3);
    const line = order.items.find((i: any) => i.id === 'item-1');
    expect(line.gstPercent).toBe(5);
    expect(line.gstAmount).toBeCloseTo(22710.6 * 0.05, 2);
  });

  it('rounds once over the raw sums, not per item', async () => {
    /**
     * Two lines whose GST each ends .5: rounding per item rounds both up and
     * overstates by 1, while the raw sum is a whole number.
     */
    const edge = [
      { ...itemsFixture[0], id: 'e1', totalPrice: 10, product: { id: 'x', name: 'X', gstPercent: 5 } },
      { ...itemsFixture[1], id: 'e2', totalPrice: 10, product: { id: 'y', name: 'Y', gstPercent: 5 } },
    ];
    const service = buildService(edge);
    const [order] = await service.getSellerOrders(SELLER_A);

    // raw GST = 0.5 + 0.5 = 1 exactly; per-item rounding would give 1 + 1 = 2
    expect(order.totalGstAmount).toBe(1);
  });

  it('falls back to 12% when a product carries no slab, as checkout does', async () => {
    const noSlab = [
      { ...itemsFixture[0], id: 'n1', totalPrice: 1000, product: { id: 'z', name: 'Z', gstPercent: null } },
    ];
    const service = buildService(noSlab);
    const [order] = await service.getSellerOrders(SELLER_A);

    expect(order.totalGstAmount).toBe(120);
    expect(order.totalAmount).toBe(1120);
  });
});

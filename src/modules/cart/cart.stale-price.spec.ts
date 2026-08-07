import { CartService } from './cart.service';

/**
 * Reproduces the live bug reported 2026-08-07: a buyer's bag showed Sumoflam
 * Tablet at 113 units / Rs 20,094.56 (comfortably above the Rs 20,000 floor),
 * but the platform rejected the same quantity with "currently Rs 19,409.95 -
 * increase to at least 117 units".
 *
 * The cart item's `unitPrice` had been snapshotted at Rs 163.59 (an earlier
 * discount on the listing). The seller's live discount had since moved to
 * 12%, pricing the listing at Rs 169.36 - which is what the storefront was
 * showing, fresh, everywhere else. `updateCartItem` alone kept validating and
 * persisting against the stale Rs 163.59 snapshot instead of the current
 * listing, so the check the buyer saw contradicted the bag on screen.
 */
const PRODUCT = {
  id: 'listing-1',
  name: 'Sumoflam Tablet',
  mrp: 252.6,
  gstPercent: 5,
  discountType: 'PTR_DISCOUNT',
  discountMeta: { discountPercent: 12 }, // live discount -> net 169.36
  minimumOrderQuantity: 1,
  maximumOrderQuantity: null,
  isActive: true,
  deletedAt: null,
  batches: [{ stock: 2000 }],
};

const makeService = (cartItemOverrides: Record<string, any> = {}) => {
  const cartItem = {
    id: 'item-1',
    quantity: 100,
    unitPrice: 163.59, // stale snapshot from an earlier, deeper discount
    cart: { userId: 'user-1' },
    product: PRODUCT,
    ...cartItemOverrides,
  };

  const updateCalls: any[] = [];

  const prisma = {
    cartItem: {
      findUnique: jest.fn(() => Promise.resolve(cartItem)),
      update: jest.fn(({ data }: any) => {
        updateCalls.push(data);
        return Promise.resolve({ ...cartItem, ...data, product: PRODUCT });
      }),
    },
  };

  const service = new CartService(prisma as any);
  return { service, updateCalls };
};

describe('CartService.updateCartItem — price freshness', () => {
  it('validates the Rs 20,000 minimum against the LIVE listing price, not the stale snapshot', async () => {
    const { service } = makeService();

    // 113 units at the CURRENT price (169.36) clears Rs 20,000
    // (20,094.56); at the stale snapshot (163.59) it does not (19,409.95).
    await expect(
      service.updateCartItem('user-1', 'item-1', { quantity: 113 } as any),
    ).resolves.toBeDefined();
  });

  it('persists the refreshed price on the cart item, not the old snapshot', async () => {
    const { service, updateCalls } = makeService();

    await service.updateCartItem('user-1', 'item-1', { quantity: 113 } as any);

    expect(updateCalls[0]).toMatchObject({ quantity: 113, unitPrice: 169.36 });
  });

  it('still rejects a quantity that falls short even at the fresh price, with fresh figures in the message', async () => {
    const { service } = makeService();

    await expect(
      service.updateCartItem('user-1', 'item-1', { quantity: 50 } as any),
    ).rejects.toThrow(/Rs 8,891\.4/);
  });

  it('does not reject a quantity the stale price alone would have blocked', async () => {
    // At the stale 163.59 rate, 113 units falls short and used to demand 117.
    // At the live 169.36 rate it already clears the floor - the fix must not
    // still be quoting a "need 117" style message here.
    const { service } = makeService();

    await expect(
      service.updateCartItem('user-1', 'item-1', { quantity: 113 } as any),
    ).resolves.not.toMatchObject({ error: expect.anything() });
  });
});

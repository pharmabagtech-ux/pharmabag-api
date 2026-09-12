import { Role } from '@prisma/client';
import { OrdersService } from './orders.service';
import { CartService } from '../cart/cart.service';

/**
 * Standing rule on this platform: a buyer never learns who the seller is.
 * PharmaBag is the counterparty, and a supplier's name plus their city is
 * enough for a buyer to go around the marketplace entirely.
 *
 * The product page was fixed earlier. These four authenticated buyer payloads
 * were not: the bag, the checkout response, the order list and the order
 * detail all returned companyName — three of them with city and state too.
 *
 * The order detail went further and attached the SETTLEMENT record: the bank
 * payout reference and the payout-proof document for the platform's transfer
 * to the seller.
 */

const SELLER_ROW = {
  id: 'seller-1',
  companyName: 'ACME DISTRIBUTORS PVT LTD',
  city: 'Kolkata',
  state: 'West Bengal',
  rating: 4.5,
};

/** Pulls every `seller: { select: {...} }` out of a Prisma query argument. */
function collectSellerSelects(node: any, found: any[] = []): any[] {
  if (!node || typeof node !== 'object') return found;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'seller' && (value as any)?.select) found.push((value as any).select);
    collectSellerSelects(value, found);
  }
  return found;
}

describe('buyer payloads never carry seller identity', () => {
  const identityFields = ['companyName', 'city', 'state'];

  it('the bag does not ask the database for seller identity', async () => {
    const captured: any[] = [];
    const prisma = {
      cart: {
        findUnique: jest.fn((args: any) => {
          captured.push(args);
          return Promise.resolve(null);
        }),
        create: jest.fn().mockResolvedValue({ id: 'cart-1', items: [] }),
      },
    };

    const service = new CartService(prisma as any) as any;
    await service.getCart('user-1').catch(() => undefined);

    for (const select of captured.flatMap((a) => collectSellerSelects(a))) {
      for (const field of identityFields) {
        expect(select[field]).toBeUndefined();
      }
    }
  });

  it.each([
    ['getBuyerOrders', (s: any) => s.getBuyerOrders('user-1')],
    ['getOrderDetail', (s: any) => s.getOrderDetail('user-1', 'order-1')],
  ])('%s does not ask the database for seller identity', async (_name, call) => {
    const captured: any[] = [];
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          role: Role.BUYER,
          sellerProfile: null,
        }),
      },
      order: {
        findMany: jest.fn((args: any) => {
          captured.push(args);
          return Promise.resolve([]);
        }),
        findUnique: jest.fn((args: any) => {
          captured.push(args);
          return Promise.resolve(null);
        }),
      },
    };

    const service = new OrdersService(prisma as any) as any;
    await call(service).catch(() => undefined);

    const selects = captured.flatMap((a) => collectSellerSelects(a));
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      for (const field of identityFields) {
        expect(select[field]).toBeUndefined();
      }
    }
    // The opaque id and the rating are fine — neither names anyone.
    expect(selects.some((s) => s.id === true)).toBe(true);
  });
});

describe('getOrderDetail — the buyer does not see what the seller was paid', () => {
  const makeService = (role: Role) => {
    const order = {
      id: 'order-1',
      buyerId: 'user-1',
      items: [
        {
          id: 'item-1',
          sellerId: 'seller-1',
          totalPrice: 1000,
          product: { gstPercent: 5 },
          settlement: {
            id: 'settlement-1',
            payoutStatus: 'PAID',
            payoutReference: 'NEFT-REF-99887766',
            paymentProofUrl: 'https://s3/payout-proof.pdf',
            payoutDate: new Date(),
          },
        },
      ],
    };

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          role,
          sellerProfile: role === Role.SELLER ? { id: 'seller-1' } : null,
        }),
      },
      order: { findUnique: jest.fn().mockResolvedValue(order) },
    };

    return new OrdersService(prisma as any) as any;
  };

  it('strips the payout reference and proof from the buyer response', async () => {
    const result = await makeService(Role.BUYER).getOrderDetail('user-1', 'order-1');

    for (const item of result.items) {
      expect(item.settlement).toBeUndefined();
    }
  });

  it('leaves the rest of the buyer order untouched', async () => {
    const result = await makeService(Role.BUYER).getOrderDetail('user-1', 'order-1');

    expect(result.id).toBe('order-1');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].totalPrice).toBe(1000);
  });

  it('still gives admin the settlement, which is where payouts are managed', async () => {
    const result = await makeService(Role.ADMIN).getOrderDetail('user-1', 'order-1');

    expect(result.items[0].settlement?.payoutReference).toBe('NEFT-REF-99887766');
  });
});

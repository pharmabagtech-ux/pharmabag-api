import { ProductsService } from './products.service';

/**
 * Reproduces the live bug reported 2026-08-07 (Sumoflam Tablet): four sellers
 * list the same master product at the same printed MRP but different scheme
 * discounts, so the "best listing" the grid and detail page point buyers at
 * used to be picked with `orderBy: { mrp: 'asc' }`. Every listing here ties on
 * MRP, so that sort never actually distinguishes them - the row that lands
 * first is whatever order Postgres happens to return, not the cheapest one.
 * Live data showed the MOST expensive of four listings (Rs 169.36) being
 * shown as "best" ahead of three cheaper ones (as low as Rs 150.12).
 *
 * "Best" must mean lowest NET price (post-discount), the figure the buyer
 * actually pays - not lowest MRP, which four sellers can share identically.
 */
const MASTER_ID = 'master-1';

// Same MRP/GST as the real Sumoflam listings; only the discount differs.
// Net prices work out to 169.36 / 150.12 / 163.59 / 153.97 respectively -
// the cheapest is the SECOND one in DB order, deliberately not first or last.
const LISTINGS = [
  { id: 'listing-expensive', mrp: 252.6, gstPercent: 5, discountType: 'PTR_DISCOUNT', discountMeta: { discountPercent: 12 }, minimumOrderQuantity: 1, batches: [{ stock: 10 }] },
  { id: 'listing-cheapest', mrp: 252.6, gstPercent: 5, discountType: 'PTR_DISCOUNT', discountMeta: { discountPercent: 22 }, minimumOrderQuantity: 1, batches: [{ stock: 10 }] },
  { id: 'listing-mid-a', mrp: 252.6, gstPercent: 5, discountType: 'PTR_DISCOUNT', discountMeta: { discountPercent: 15 }, minimumOrderQuantity: 1, batches: [{ stock: 10 }] },
  { id: 'listing-mid-b', mrp: 252.6, gstPercent: 5, discountType: 'PTR_DISCOUNT', discountMeta: { discountPercent: 20 }, minimumOrderQuantity: 1, batches: [{ stock: 10 }] },
];

describe('ProductsService — best listing is the cheapest NET price, not tied MRP order', () => {
  it('findAll: grid price/bestListingId point at the lowest net price, not listings[0]', async () => {
    const prisma = {
      masterProduct: {
        count: jest.fn(() => Promise.resolve(1)),
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: MASTER_ID,
              name: 'Sumoflam Tablet',
              images: [],
              products: LISTINGS,
            },
          ]),
        ),
      },
    };

    const service = new ProductsService(
      prisma as any,
      {} as any,
      {} as any,
      { recordView: jest.fn() } as any,
    );

    const res: any = await service.findAll({ page: 1, limit: 20 } as any);
    const product = res.products[0];

    expect(product.bestListingId).toBe('listing-cheapest');
    expect(product.price).toBeCloseTo(150.12, 2);
  });

  it('findOne (master detail): listings are ordered cheapest net price first', async () => {
    const prisma = {
      product: { findFirst: jest.fn(() => Promise.resolve(null)) },
      masterProduct: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            id: MASTER_ID,
            name: 'Sumoflam Tablet',
            slug: 'sumoflam-tablet',
            images: [],
            products: LISTINGS.map((l) => ({ ...l, seller: { id: 's' }, images: [] })),
          }),
        ),
      },
    };

    const service = new ProductsService(
      prisma as any,
      {} as any,
      {} as any,
      { recordView: jest.fn() } as any,
    );

    const res: any = await service.findOne(MASTER_ID);

    expect(res.listings[0].id).toBe('listing-cheapest');
    expect(res.listings[0].price).toBeCloseTo(150.12, 2);
    // still every listing present, just reordered
    expect(res.listings).toHaveLength(4);
  });
});

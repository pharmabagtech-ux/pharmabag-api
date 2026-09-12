import { ProductsService } from './products.service';

/**
 * The storefront grid shaper has always returned `bestListingId`, and
 * products.best-listing.spec.ts has always asserted it is the cheapest
 * listing — yet live responses from /products carried no such key at all.
 *
 * The reason the test could not see it: that spec hands findMany a mock whose
 * listings already have an `id`, so Prisma's `select` never runs. In
 * production the select omitted `id`, `best.id` was therefore `undefined`, and
 * JSON.stringify drops undefined keys — the field silently vanished from every
 * grid response.
 *
 * The cost was not cosmetic. With no listing id, every grid (category pages,
 * /products, the homepage carousel) added the MASTER product id to the bag,
 * while the product page and quick view added the LISTING id. One product
 * could occupy two cart lines, and at checkout the second add was rejected
 * with a raw "Product already in cart. Use PATCH /api/cart/item/:id" string
 * shown verbatim to the buyer.
 *
 * So this asserts the shape of the QUERY, which is the thing that was wrong.
 */
describe('ProductsService.findAll — the grid query must select the listing id', () => {
  const runFindAll = async () => {
    const findMany = jest.fn((_args?: any) => Promise.resolve([]));
    const prisma = {
      masterProduct: {
        // Non-zero: findAll short-circuits before querying when the count is 0.
        count: jest.fn(() => Promise.resolve(1)),
        findMany,
      },
    };

    const service = new ProductsService(
      prisma as any,
      {} as any,
      {} as any,
      { recordView: jest.fn() } as any,
    );

    await service.findAll({ page: 1, limit: 20 } as any);
    return findMany;
  };

  it('selects id on the nested listings', async () => {
    const findMany = await runFindAll();

    expect(findMany).toHaveBeenCalled();
    const args = findMany.mock.calls[0][0] as any;
    const listingSelect = (args.include ?? args.select)?.products?.select;

    expect(listingSelect).toBeDefined();
    expect(listingSelect.id).toBe(true);
  });

  it('still selects everything the grid price needs', async () => {
    const findMany = await runFindAll();
    const args = findMany.mock.calls[0][0] as any;
    const listingSelect = (args.include ?? args.select)?.products?.select;

    // Guards against a future "tidy-up" dropping a field the shaper reads —
    // each of these has been missing from this select at some point.
    for (const field of [
      'mrp',
      'gstPercent',
      'discountType',
      'discountMeta',
      'minimumOrderQuantity',
    ]) {
      expect(listingSelect[field]).toBe(true);
    }
    expect(listingSelect.batches).toBeDefined();
  });

  it('returns a real bestListingId end to end', async () => {
    const prisma = {
      masterProduct: {
        count: jest.fn(() => Promise.resolve(1)),
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'master-1',
              name: 'AB Flo 100mg Capsule',
              images: [],
              products: [
                {
                  id: 'listing-1',
                  mrp: 100,
                  gstPercent: 5,
                  discountType: null,
                  discountMeta: null,
                  minimumOrderQuantity: 1,
                  batches: [{ stock: 10 }],
                },
              ],
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

    // The master id and the listing id are different things; the bag needs the
    // listing. Asserting they differ is the whole point of the fix.
    expect(res.products[0].id).toBe('master-1');
    expect(res.products[0].bestListingId).toBe('listing-1');
  });
});

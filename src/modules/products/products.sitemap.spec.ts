import { ProductsService } from './products.service';

/**
 * The sitemap endpoint exists so the storefront's XML sitemap builder can
 * enumerate the catalogue in ~6 large pages instead of 269 throttled grid
 * calls. These tests pin the contract the web side depends on:
 *
 *  - pagination maths (skip/take, clamped limit, meta totals)
 *  - a STABLE ordering, so products do not wander between chunk files
 *  - `hasSellers` derived from the take-1 active-listing probe
 *  - only slim fields returned (no pricing/listing payload)
 */
const TOTAL = 12_345;

const makeService = () => {
  const calls: Array<{ skip: number; take: number; orderBy: any; select: any }> = [];

  const prisma = {
    masterProduct: {
      count: jest.fn(() => Promise.resolve(TOTAL)),
      findMany: jest.fn(({ skip, take, orderBy, select }: any) => {
        calls.push({ skip, take, orderBy, select });
        const rows = Array.from({ length: Math.min(take, 3) }, (_, i) => ({
          slug: `product-${skip + i}`,
          updatedAt: new Date('2026-08-01T00:00:00Z'),
          createdAt: new Date('2026-07-01T00:00:00Z'),
          // first row has an active listing, the rest do not
          products: i === 0 ? [{ id: 'listing-1' }] : [],
        }));
        return Promise.resolve(rows);
      }),
    },
  };

  const service = new ProductsService(
    prisma as any,
    {} as any,
    {} as any,
    { recordView: jest.fn() } as any,
  );
  return { service, calls, prisma };
};

describe('ProductsService.findAllForSitemap', () => {
  it('pages with skip/take and defaults to the 5000 limit', async () => {
    const { service, calls } = makeService();

    const res = await service.findAllForSitemap({ page: 2 });

    expect(calls[0]).toMatchObject({ skip: 5000, take: 5000 });
    expect(res.meta).toEqual({
      total: TOTAL,
      page: 2,
      limit: 5000,
      totalPages: Math.ceil(TOTAL / 5000),
    });
  });

  it('clamps limit to 5000 and page to a minimum of 1', async () => {
    const { service, calls } = makeService();

    await service.findAllForSitemap({ page: 0, limit: 999_999 });

    expect(calls[0]).toMatchObject({ skip: 0, take: 5000 });
  });

  it('orders by (createdAt, id) so chunk membership is stable between crawls', async () => {
    const { service, calls } = makeService();

    await service.findAllForSitemap({});

    expect(calls[0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('derives hasSellers from the active-listing probe and strips the relation', async () => {
    const { service } = makeService();

    const res = await service.findAllForSitemap({});

    expect(res.products[0]).toEqual({
      slug: 'product-0',
      updatedAt: new Date('2026-08-01T00:00:00Z'),
      createdAt: new Date('2026-07-01T00:00:00Z'),
      hasSellers: true,
    });
    expect(res.products[1].hasSellers).toBe(false);
    // The raw relation array must not leak into the payload.
    expect((res.products[0] as any).products).toBeUndefined();
  });

  it('selects only sitemap fields — no pricing, listings or includes', async () => {
    const { service, calls } = makeService();

    await service.findAllForSitemap({});

    const select = calls[0].select;
    expect(Object.keys(select).sort()).toEqual(
      ['createdAt', 'products', 'slug', 'updatedAt'].sort(),
    );
    // The relation probe must be capped at one row.
    expect(select.products.take).toBe(1);
  });
});

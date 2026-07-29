import { ProductsService } from './products.service';

/**
 * The storefront grid must list products a buyer can actually purchase before
 * the admin-uploaded catalogue entries that have no seller behind them (those
 * render as N/A for price, MOQ and rate).
 *
 * Ordering by relation _count cannot express this — it cannot filter on active
 * listings, so masters whose only listings are inactive would still rank first.
 * These tests pin the two-bucket pagination instead.
 */
const SELLABLE_TOTAL = 3;
const GRAND_TOTAL = 10;

/** Does this where-clause target the sellable bucket or the catalogue one? */
const bucketOf = (where: any): 'sellable' | 'catalogue' | 'all' => {
  const clause = (where?.AND ?? []).find((c: any) => c?.products);
  if (!clause) return 'all';
  return clause.products.some ? 'sellable' : 'catalogue';
};

const makeService = () => {
  const calls: Array<{ bucket: string; skip: number; take: number }> = [];

  const prisma = {
    masterProduct: {
      count: jest.fn(({ where }: any) =>
        Promise.resolve(bucketOf(where) === 'sellable' ? SELLABLE_TOTAL : GRAND_TOTAL),
      ),
      findMany: jest.fn(({ where, skip, take }: any) => {
        const bucket = bucketOf(where);
        calls.push({ bucket, skip, take });
        // The sellable bucket only has SELLABLE_TOTAL rows to give
        const available =
          bucket === 'sellable' ? Math.max(0, SELLABLE_TOTAL - skip) : 50;
        const rows = Array.from({ length: Math.min(take, available) }, (_, i) => ({
          id: `${bucket}-${skip + i}`,
          name: `${bucket} ${skip + i}`,
          products: [],
          images: [],
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
  return { service, calls };
};

describe('ProductsService.findAll — sellable products first', () => {
  it('fills the first page entirely from products that have sellers', async () => {
    const { service, calls } = makeService();

    const res: any = await service.findAll({ page: 1, limit: 2 } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ bucket: 'sellable', skip: 0, take: 2 });
    expect(res.products).toHaveLength(2);
  });

  it('tops the page up from the catalogue when sellable products run out', async () => {
    const { service, calls } = makeService();

    // skip 2, sellable has 3 -> 1 sellable row, 1 catalogue row
    const res: any = await service.findAll({ page: 2, limit: 2 } as any);

    expect(calls[0]).toMatchObject({ bucket: 'sellable', skip: 2, take: 2 });
    expect(calls[1]).toMatchObject({ bucket: 'catalogue', skip: 0, take: 1 });
    expect(res.products).toHaveLength(2);
  });

  it('reads only the catalogue once past the sellable products, with the skip rebased', async () => {
    const { service, calls } = makeService();

    // skip 4 >= sellableTotal 3 -> catalogue at skip 1
    const res: any = await service.findAll({ page: 3, limit: 2 } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ bucket: 'catalogue', skip: 1, take: 2 });
    expect(res.products).toHaveLength(2);
  });

  it('reports the unchanged grand total so paging is unaffected', async () => {
    const { service } = makeService();

    const res: any = await service.findAll({ page: 1, limit: 2 } as any);

    expect(res.meta.total).toBe(GRAND_TOTAL);
    expect(res.meta.totalPages).toBe(Math.ceil(GRAND_TOTAL / 2));
  });
});

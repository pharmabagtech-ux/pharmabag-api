import { buildSearchRelevanceTiers } from './search-condition.util';
import { ProductsService } from './products.service';

/**
 * Reported: searching "1 al 10 mg" did not surface "1 AL 10mg Tablet".
 *
 * The product was never missing — it sat at position 358 of 2,966 results,
 * because the search was a FILTER with no ranking. Every master whose name,
 * manufacturer or composition merely contained "al", "10" and "mg" scored
 * identically, and "Nortipan M Tablet" qualified on its composition
 * ("Pregabalin ... 10mg") alone. Searching the exact full name put the exact
 * match fourth, behind three unrelated products.
 *
 * These tests pin the ranking: a name match outranks an incidental
 * composition match, and the sellable-first rule applies WITHIN a relevance
 * tier rather than above it — otherwise every product without a seller stays
 * unreachable by name, which is the reported bug.
 */

/** Which relevance tier does this bucket's where-clause target? */
const tierOf = (where: any): string => {
  const parts: any[] = where?.AND ?? [];
  for (const p of parts) {
    if (p?.name?.equals) return 'exact';
    if (p?.name?.startsWith) return 'prefix';
    if (Array.isArray(p?.AND) && p.AND.some((c: any) => c?.name?.contains)) {
      return 'name-words';
    }
    if (p?.NOT) return 'other';
  }
  return 'none';
};

const sellableOf = (where: any): string => {
  const clause = (where?.AND ?? []).find((c: any) => c?.products);
  if (!clause) return 'all';
  return clause.products.some ? 'sellable' : 'catalogue';
};

const keyOf = (where: any) => `${tierOf(where)}:${sellableOf(where)}`;

/**
 * @param counts rows available per bucket key; anything unlisted is empty.
 */
const makeService = (counts: Record<string, number>) => {
  const calls: Array<{ key: string; skip: number; take: number }> = [];

  const prisma = {
    masterProduct: {
      count: jest.fn(({ where }: any) => {
        const key = keyOf(where);
        // The grand-total count has no tier and no sellable clause.
        if (key === 'none:all') {
          return Promise.resolve(
            Object.values(counts).reduce((a, b) => a + b, 0),
          );
        }
        return Promise.resolve(counts[key] ?? 0);
      }),
      findMany: jest.fn(({ where, skip, take }: any) => {
        const key = keyOf(where);
        calls.push({ key, skip, take });
        const available = Math.max(0, (counts[key] ?? 0) - skip);
        const rows = Array.from({ length: Math.min(take, available) }, (_, i) => ({
          id: `${key}-${skip + i}`,
          name: `${key} ${skip + i}`,
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

describe('buildSearchRelevanceTiers', () => {
  it('returns null when there is nothing to search for', () => {
    expect(buildSearchRelevanceTiers('')).toBeNull();
    expect(buildSearchRelevanceTiers('   ')).toBeNull();
    expect(buildSearchRelevanceTiers(undefined)).toBeNull();
  });

  it('orders the tiers exact name, prefix, all words in the name, then the rest', () => {
    const tiers = buildSearchRelevanceTiers('1 AL 10mg Tablet') as any[];

    expect(tiers).toHaveLength(4);
    expect(tierOf({ AND: [tiers[0]] })).toBe('exact');
    expect(tierOf({ AND: [tiers[1]] })).toBe('prefix');
    expect(tierOf({ AND: [tiers[2]] })).toBe('name-words');
    expect(tierOf({ AND: [tiers[3]] })).toBe('other');
  });

  it('matches the exact name case-insensitively', () => {
    const [exact] = buildSearchRelevanceTiers('1 AL 10mg Tablet') as any[];

    expect(exact.name.equals).toBe('1 AL 10mg Tablet');
    expect(exact.name.mode).toBe('insensitive');
  });

  it('normalises whitespace before matching the exact name', () => {
    const [exact] = buildSearchRelevanceTiers('  1 AL   10mg Tablet ') as any[];

    expect(exact.name.equals).toBe('1 AL 10mg Tablet');
  });

  /**
   * Tiers must not overlap, or a product would be counted twice and paging
   * would skip rows: every tier after the first excludes the ones before it.
   */
  it('keeps the tiers mutually exclusive', () => {
    const tiers = buildSearchRelevanceTiers('telekast tablet') as any[];

    // prefix excludes the exact match
    expect(tiers[1].NOT.name.equals).toBe('telekast tablet');
    // name-words excludes anything already caught by the prefix tier
    expect(tiers[2].NOT.name.startsWith).toBe('telekast tablet');
    // the catch-all excludes everything with all the words in the name
    expect(tiers[3].NOT.AND).toBeDefined();
  });

  it('requires every word in the name for the all-words tier', () => {
    const tiers = buildSearchRelevanceTiers('telekast tablet') as any[];
    const words = tiers[2].AND.filter((c: any) => c.name?.contains).map(
      (c: any) => c.name.contains,
    );

    expect(words).toEqual(['telekast', 'tablet']);
  });
});

describe('ProductsService.findAll — search relevance', () => {
  it('reads the exact-name bucket before anything else', async () => {
    const { service, calls } = makeService({
      'exact:sellable': 1,
      'other:sellable': 20,
    });

    await service.findAll({ search: '1 AL 10mg Tablet', page: 1, limit: 2 } as any);

    expect(calls[0].key).toBe('exact:sellable');
  });

  /**
   * The heart of the reported bug: "1 AL 10mg Tablet" has no seller, so under
   * sellable-first it lost to every priced product that merely contained the
   * words. Typing a product's name must surface that product.
   */
  it('puts an exact name match above a sellable product that only contains the words', async () => {
    const { service, calls } = makeService({
      'exact:catalogue': 1,
      'other:sellable': 20,
    });

    const res: any = await service.findAll({
      search: '1 AL 10mg Tablet',
      page: 1,
      limit: 2,
    } as any);

    expect(calls[0].key).toBe('exact:catalogue');
    expect(res.products[0].id).toBe('exact:catalogue-0');
    expect(calls[1].key).toBe('other:sellable');
    expect(res.products).toHaveLength(2);
  });

  it('still prefers sellable products within the same tier', async () => {
    const { service, calls } = makeService({
      'name-words:sellable': 5,
      'name-words:catalogue': 5,
    });

    await service.findAll({ search: 'telekast tablet', page: 1, limit: 2 } as any);

    expect(calls[0].key).toBe('name-words:sellable');
  });

  it('pages across tier boundaries without repeating or skipping a row', async () => {
    const { service, calls } = makeService({
      'exact:sellable': 1,
      'prefix:sellable': 2,
      'other:sellable': 10,
    });

    // skip 2 consumes the exact match and the first prefix row, so this page
    // starts one row into the prefix tier and runs over into the last tier
    const res: any = await service.findAll({
      search: 'telekast',
      page: 2,
      limit: 2,
    } as any);

    expect(calls.map((c) => c.key)).toEqual(['prefix:sellable', 'other:sellable']);
    expect(res.products.map((p: any) => p.id)).toEqual([
      'prefix:sellable-1',
      'other:sellable-0',
    ]);
  });

  it('reports the unchanged grand total so paging is unaffected', async () => {
    const { service } = makeService({
      'exact:sellable': 1,
      'other:sellable': 9,
    });

    const res: any = await service.findAll({
      search: 'telekast',
      page: 1,
      limit: 2,
    } as any);

    expect(res.meta.total).toBe(10);
    expect(res.meta.totalPages).toBe(5);
  });

  it('leaves an unsearched browse on the plain two-bucket ordering', async () => {
    const { service, calls } = makeService({
      'none:sellable': 3,
      'none:catalogue': 7,
    });

    await service.findAll({ page: 1, limit: 2 } as any);

    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('none:sellable');
  });
});

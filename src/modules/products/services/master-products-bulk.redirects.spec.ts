import { MasterProductsBulkService } from './master-products-bulk.service';

/**
 * Bulk uploads rewrite catalogue slugs wholesale (generateUniqueSlug runs on
 * every UPDATE row), which orphans every renamed product's live URL. The
 * service must hand each old→new slug pair to the redirects service — and an
 * upload must NEVER fail because redirect creation did.
 *
 * These tests drive the real `executeBulkOperation` with an in-memory prisma
 * double, pinning the hook's wiring rather than re-testing RedirectsService.
 */
const CSV_HEADERS = ['SKU', 'Product name', 'Company', 'Chemical Composition', 'Main Category', 'Sub Category'];

const row = (sku: string, name: string) => ({
  SKU: sku,
  'Product name': name,
  Company: 'Cipla',
  'Chemical Composition': 'Paracetamol 500mg',
  'Main Category': 'Generic',
  'Sub Category': 'Tablet',
});

const makeService = (opts: {
  existing: { sku: string; slug: string }[];
  renameFails?: boolean;
}) => {
  const created: { oldSlug: string; newSlug: string }[][] = [];

  const prisma = {
    category: {
      createMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => [{ id: 'cat-1', name: 'Generic' }]),
    },
    subCategory: {
      createMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => [{ id: 'sub-1', name: 'Tablet', categoryId: 'cat-1' }]),
    },
    company: {
      createMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => [{ id: 'co-1', name: 'Cipla' }]),
    },
    chemicalComposition: {
      createMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => [{ id: 'ch-1', name: 'Paracetamol 500mg' }]),
    },
    masterProduct: {
      findMany: jest.fn(async () => opts.existing.map((e, i) => ({ id: `m-${i}`, sku: e.sku, slug: e.slug }))),
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
    },
    masterProductImage: { createMany: jest.fn(async () => ({ count: 0 })) },
    $queryRaw: jest.fn(async () => []),
    $executeRaw: jest.fn(async () => 0),
  };

  const redirectsService = {
    createFromRename: jest.fn(async (pairs: { oldSlug: string; newSlug: string }[]) => {
      created.push(pairs);
      if (opts.renameFails) throw new Error('redirects table on fire');
      return pairs.length;
    }),
  };

  const service = new MasterProductsBulkService(prisma as any, redirectsService as any);
  // The private bulk UPDATE writer talks raw SQL; stub it — its own behaviour
  // is covered elsewhere, here only the surrounding hook matters.
  (service as any).bulkUpdateMasterProducts = jest.fn(async (toUpdate: any[]) => ({
    updatedCount: toUpdate.length,
    errors: [],
  }));
  (service as any).propagateToSellerListings = jest.fn(async () => ({ renamed: 0, suspicious: [] }));

  return { service, redirectsService, created };
};

describe('bulk upload → rename redirects hook', () => {
  it('passes changed slugs to the redirects service and reports the count', async () => {
    const { service, redirectsService } = makeService({
      // Existing product whose recomputed slug will differ.
      existing: [{ sku: 'PB1', slug: 'old-name-pb1' }],
    });

    const result: any = await (service as any).executeBulkOperation(
      [row('PB1', 'New Name')],
      'UPDATE',
    );

    expect(redirectsService.createFromRename).toHaveBeenCalledWith([
      { oldSlug: 'old-name-pb1', newSlug: 'new-name-pb1' },
    ]);
    expect(result.redirectsCreated).toBe(1);
  });

  it('creates nothing when the slug is unchanged', async () => {
    const { service, redirectsService } = makeService({
      existing: [{ sku: 'PB1', slug: 'same-name-pb1' }],
    });

    const result: any = await (service as any).executeBulkOperation(
      [row('PB1', 'Same Name')],
      'UPDATE',
    );

    expect(redirectsService.createFromRename).not.toHaveBeenCalled();
    expect(result.redirectsCreated).toBe(0);
  });

  it('the upload SUCCEEDS even when redirect creation blows up', async () => {
    const { service } = makeService({
      existing: [{ sku: 'PB1', slug: 'old-name-pb1' }],
      renameFails: true,
    });

    const result: any = await (service as any).executeBulkOperation(
      [row('PB1', 'New Name')],
      'UPDATE',
    );

    expect(result.successCount).toBe(1);
  });
});

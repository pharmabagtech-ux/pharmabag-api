import { MasterProductsBulkService } from './master-products-bulk.service';

/**
 * A CSV upload used to CREATE any category or sub-category it happened to
 * mention (`category.createMany` / `subCategory.createMany` with
 * skipDuplicates). A typo in one cell of a 26,000-row sheet therefore minted a
 * real category — which immediately gets its own landing page, its own FAQ
 * block and an entry in categories.xml, with nothing gating it.
 *
 * Categories are now created deliberately, in Admin → Categories. An upload
 * that names one which does not exist skips those rows and reports them, using
 * the mapping check the uploader already had.
 */
const row = (
  sku: string,
  name: string,
  mainCategory = 'Generic',
  subCategory = 'Tablet',
) => ({
  SKU: sku,
  'Product name': name,
  Company: 'Cipla',
  'Chemical Composition': 'Paracetamol 500mg',
  'Main Category': mainCategory,
  'Sub Category': subCategory,
});

const makeService = (opts: {
  categories?: { id: string; name: string }[];
  subCategories?: { id: string; name: string; categoryId: string }[];
}) => {
  const categories = opts.categories ?? [{ id: 'cat-1', name: 'Generic' }];
  const subCategories = opts.subCategories ?? [
    { id: 'sub-1', name: 'Tablet', categoryId: 'cat-1' },
  ];

  const prisma = {
    category: {
      createMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async ({ where }: any) =>
        categories.filter((c) => where.name.in.includes(c.name)),
      ),
    },
    subCategory: {
      createMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async ({ where }: any) =>
        subCategories.filter((s) => where.name.in.includes(s.name)),
      ),
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
      findMany: jest.fn(async () => []),
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
    },
    masterProductImage: { createMany: jest.fn(async () => ({ count: 0 })) },
    $queryRaw: jest.fn(async () => []),
    $executeRaw: jest.fn(async () => 0),
  };

  const redirectsService = { createFromRename: jest.fn(async () => 0) };

  const service = new MasterProductsBulkService(
    prisma as any,
    redirectsService as any,
  );
  (service as any).bulkUpdateMasterProducts = jest.fn(async (toUpdate: any[]) => ({
    updatedCount: toUpdate.length,
    errors: [],
  }));
  (service as any).propagateToSellerListings = jest.fn(async () => ({
    renamed: 0,
    suspicious: [],
  }));

  return { service, prisma };
};

describe('bulk upload → categories are never created implicitly', () => {
  it('imports a row whose category and sub-category already exist', async () => {
    const { service, prisma } = makeService({});

    const result: any = await (service as any).executeBulkOperation(
      [row('PB1', 'Crocin 500mg Tablet')],
      'CREATE',
    );

    expect(result.successCount).toBe(1);
    expect(result.errors).toEqual([]);
    expect(prisma.masterProduct.createMany).toHaveBeenCalled();
  });

  it('never creates a category or sub-category, whatever the CSV says', async () => {
    const { service, prisma } = makeService({});

    await (service as any).executeBulkOperation(
      [row('PB1', 'Crocin 500mg Tablet'), row('PB2', 'New Thing', 'Invented', 'Powder')],
      'CREATE',
    );

    expect(prisma.category.createMany).not.toHaveBeenCalled();
    expect(prisma.subCategory.createMany).not.toHaveBeenCalled();
  });

  it('skips a row naming an unknown category and says how to fix it', async () => {
    const { service } = makeService({});

    const result: any = await (service as any).executeBulkOperation(
      [row('PB2', 'New Thing', 'Invented', 'Tablet')],
      'CREATE',
    );

    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Category 'Invented' does not exist");
    expect(result.errors[0]).toContain('Categories');
  });

  it('skips a row naming an unknown sub-category under a real category', async () => {
    const { service } = makeService({});

    const result: any = await (service as any).executeBulkOperation(
      [row('PB3', 'New Thing', 'Generic', 'Invented Form')],
      'CREATE',
    );

    expect(result.failCount).toBe(1);
    expect(result.errors[0]).toContain("Sub-category 'Invented Form' does not exist");
    expect(result.errors[0]).toContain('Generic');
  });

  /** One bad row must not cost the other 25,999. */
  it('imports the good rows alongside the skipped one', async () => {
    const { service } = makeService({});

    const result: any = await (service as any).executeBulkOperation(
      [
        row('PB1', 'Crocin 500mg Tablet'),
        row('PB2', 'New Thing', 'Invented', 'Tablet'),
      ],
      'CREATE',
    );

    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(1);
  });
});

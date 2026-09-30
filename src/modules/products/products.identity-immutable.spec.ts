import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProductApprovalStatus } from '@prisma/client';
import { ProductsService } from './products.service';
import { UpdateProductDto } from './dto/update-product.dto';

/**
 * A seller could rename a listing into a product that is not in the catalogue.
 *
 * Listings are now required to be listings OF a catalogue product, but that was
 * only enforced on create(). update() passed name, manufacturer,
 * chemicalComposition, categoryId and subCategoryId straight through to
 * prisma.product.update, so the rule could be walked around in two requests:
 * list a real catalogue product — auto-approved, active, visible to buyers —
 * then PATCH the name to anything at all.
 *
 * The comparison is against THE ROW'S OWN current values, deliberately not
 * against its master's. The seller edit form rebuilds its whole payload on every
 * save, so an ordinary price edit resends all five identity fields unchanged;
 * rejecting on presence would break every edit, and only a value comparison can
 * tell a resubmit from a rename. Comparing against the master would also reject
 * innocent edits on historical rows whose category has drifted from it.
 *
 * The isActive case here is a separate, pre-existing hole found alongside:
 * isActive is on UpdateProductDto and flowed through the ...productData spread
 * untouched, so a seller on a PENDING listing could PATCH {"isActive": true} and
 * publish without review. Deactivating stays allowed — pausing your own listing
 * is legitimate.
 */

const CURRENT = {
  id: 'product-1',
  name: 'Sinarest Syrup 75 mL',
  manufacturer: 'Centaur',
  chemicalComposition: 'Paracetamol',
  categoryId: 'cat-ethical',
  subCategoryId: 'sub-syrup',
  masterProductId: 'master-1',
  approvalStatus: ProductApprovalStatus.APPROVED as ProductApprovalStatus,
};

interface Harness {
  service: ProductsService;
  updated: any[];
}

const makeService = (overrides: Partial<typeof CURRENT> = {}): Harness => {
  const product = { ...CURRENT, ...overrides };
  const updated: any[] = [];

  const prisma: any = {
    sellerProfile: { findUnique: async () => ({ id: 'seller-1' }) },
    company: { upsert: async () => ({ id: 'company' }) },
    chemicalComposition: { upsert: async () => ({ id: 'cc' }) },
    masterProduct: { update: async () => ({}) },
    productImage: { deleteMany: async () => ({}), createMany: async () => ({}), findMany: async () => [] },
    productBatch: { findFirst: async () => ({ id: 'batch', stock: 5 }) },
    product: {
      findFirst: async () => product,
      update: async (args: any) => {
        updated.push(args);
        return {
          ...product,
          ...args.data,
          category: { name: 'Ethical' },
          subCategory: { name: 'Syrup' },
        };
      },
    },
  };

  const noop: any = {
    updateDefaultBatch: async () => ({}),
    createDefaultBatch: async () => ({}),
    upsert: () => undefined,
    initialise: () => undefined,
    trackEvent: async () => ({}),
    recordEvent: async () => ({}),
  };

  return { service: new ProductsService(prisma, noop, noop, noop), updated };
};

const dto = (over: Partial<UpdateProductDto> = {}): UpdateProductDto =>
  ({
    // What the seller portal resends on every save, unchanged.
    name: CURRENT.name,
    manufacturer: CURRENT.manufacturer,
    chemicalComposition: CURRENT.chemicalComposition,
    categoryId: CURRENT.categoryId,
    subCategoryId: CURRENT.subCategoryId,
    ...over,
  }) as UpdateProductDto;

describe('ProductsService.update — a listing keeps its catalogue identity', () => {
  it('allows an ordinary edit that resends every identity field unchanged', async () => {
    // The regression that matters: the seller form always sends these, so a
    // presence-based check would reject every price edit in the portal.
    const { service, updated } = makeService();

    await service.update('user-1', 'product-1', dto({ mrp: 120 }));

    expect(updated).toHaveLength(1);
    expect(updated[0].data.mrp).toBe(120);
  });

  it('ignores case and surrounding whitespace when deciding what changed', async () => {
    const { service, updated } = makeService();

    await service.update(
      'user-1',
      'product-1',
      dto({ name: '  sinarest syrup 75 ML  ', mrp: 120 }),
    );

    expect(updated).toHaveLength(1);
  });

  it('accepts a partial edit that sends no identity fields at all', async () => {
    const { service, updated } = makeService();

    await service.update('user-1', 'product-1', { stock: 40 } as UpdateProductDto);

    expect(updated).toHaveLength(1);
  });

  it('rejects a rename', async () => {
    const { service, updated } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ name: 'Pregnancy Test Kit' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updated).toHaveLength(0);
  });

  it('rejects a manufacturer change', async () => {
    const { service } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ manufacturer: 'Acme Diagnostics' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a composition change', async () => {
    const { service } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ chemicalComposition: 'Ibuprofen' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a re-categorisation', async () => {
    const { service } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ categoryId: 'cat-ayurvedic' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.update('user-1', 'product-1', dto({ subCategoryId: 'sub-tablet' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tells the seller what they can edit instead', async () => {
    const { service } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ name: 'Something Else' })),
    ).rejects.toThrow(/price, stock, expiry or discount/s);
  });

  it('freezes legacy listings that have no master too', async () => {
    // These predate the rule and should never have existed; editing one into a
    // different product is exactly what must not happen.
    const { service } = makeService({ masterProductId: null as any });

    await expect(
      service.update('user-1', 'product-1', dto({ name: 'Something Else' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ProductsService.update — a seller cannot publish an unapproved listing', () => {
  it('rejects isActive:true on a listing that is not approved', async () => {
    const { service, updated } = makeService({
      approvalStatus: ProductApprovalStatus.PENDING,
    });

    await expect(
      service.update('user-1', 'product-1', dto({ isActive: true })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(updated).toHaveLength(0);
  });

  it('rejects isActive:true on a rejected listing', async () => {
    const { service } = makeService({
      approvalStatus: ProductApprovalStatus.REJECTED,
    });

    await expect(
      service.update('user-1', 'product-1', dto({ isActive: true })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows isActive:true on an approved listing', async () => {
    const { service, updated } = makeService();

    await service.update('user-1', 'product-1', dto({ isActive: true }));

    expect(updated[0].data.isActive).toBe(true);
  });

  it('allows a seller to pause their own listing', async () => {
    const { service, updated } = makeService({
      approvalStatus: ProductApprovalStatus.PENDING,
    });

    await service.update('user-1', 'product-1', dto({ isActive: false }));

    expect(updated[0].data.isActive).toBe(false);
  });
});

import { ForbiddenException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';

/**
 * A seller could take over another seller's listing.
 *
 * `create()` treated a matching `externalId` or slug as "this is the same
 * product, update it" and called `upsertExistingProduct`, which wrote
 * `sellerId` along with mrp, stock, images, `isActive: true` and
 * `deletedAt: null`. Nothing checked who owned the row, so the match handed
 * the victim's listing — and every future order placed against it — to the
 * caller.
 *
 * The crafted-request version needed `isMigration: true` and a slug lifted off
 * the public storefront. The version that mattered more needed nothing at all:
 * the seller bulk-CSV importer sends no slug and no externalId, so the slug is
 * derived from the catalogue name and `isMigration` is hardcoded true
 * (`seller-bulk-csv.service.ts`). Two sellers listing the same medicine derive
 * the same slug, so an ordinary CSV upload by seller B silently took over
 * seller A's listing and reported success.
 *
 * These tests pin both halves of the fix: same-seller upsert still works
 * exactly as before, and a cross-seller match never writes the other seller's
 * row.
 */

const SELLER_A = 'seller-a';
const SELLER_B = 'seller-b';
const VICTIM_PRODUCT = 'product-owned-by-a';

interface Harness {
  service: ProductsService;
  updated: any[];
  created: any[];
}

/**
 * @param existing the row that a lookup by externalId/slug will return, or
 * null for "no match" (the plain create path).
 */
const makeService = (existing: { id: string; sellerId: string } | null): Harness => {
  const updated: any[] = [];
  const created: any[] = [];

  const prisma: any = {
    sellerProfile: {
      // The CALLER is always seller B in these tests.
      findUnique: async () => ({ id: SELLER_B }),
    },
    category: { findUnique: async () => ({ id: 'cat', name: 'Cat' }) },
    subCategory: { findUnique: async () => ({ id: 'sub', name: 'Sub' }) },
    masterProduct: { findFirst: async () => null },
    company: { upsert: async () => ({ id: 'company' }) },
    chemicalComposition: { upsert: async () => ({ id: 'cc' }) },
    productImage: {
      createMany: async () => ({}),
      deleteMany: async () => ({}),
      findMany: async () => [],
    },
    productBatch: {
      findFirst: async () => ({ id: 'batch', stock: 0 }),
      update: async () => ({}),
      create: async () => ({}),
      updateMany: async () => ({}),
    },
    product: {
      // externalId lookup
      findUnique: async () => existing,
      // First call is the slug lookup; the second is the same-seller duplicate
      // check further down create(), which must stay empty or we never reach
      // the create branch this test is asserting on.
      findFirst: (() => {
        let call = 0;
        return async () => (call++ === 0 ? existing : null);
      })(),
      update: async (args: any) => {
        updated.push(args);
        return { id: args.where.id, name: 'x', slug: 's' };
      },
      create: async (args: any) => {
        created.push(args);
        return { id: 'new-product', name: 'x', slug: 's', images: [] };
      },
    },
  };

  const noop: any = {
    createDefaultBatch: async () => ({}),
    updateDefaultBatch: async () => ({}),
    upsert: () => undefined,
    initialise: () => undefined,
    trackEvent: async () => ({}),
    recordEvent: async () => ({}),
  };

  const service = new ProductsService(prisma, noop, noop, noop);
  return { service, updated, created };
};

const dto = (over: Partial<CreateProductDto> = {}): CreateProductDto =>
  ({
    name: 'Sinarest Syrup 75 mL',
    manufacturer: 'Centaur',
    chemicalComposition: 'Paracetamol',
    categoryId: 'cat',
    subCategoryId: 'sub',
    mrp: 100,
    gstPercent: 12,
    stock: 10,
    ...over,
  }) as CreateProductDto;

describe('ProductsService.create — listing ownership', () => {
  it('refuses to upsert another seller’s listing matched by externalId', async () => {
    const { service, updated } = makeService({
      id: VICTIM_PRODUCT,
      sellerId: SELLER_A,
    });

    await expect(
      service.create('user-b', dto({ externalId: 'EXT-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The victim's row must not have been touched at all.
    expect(updated).toHaveLength(0);
  });

  it('still upserts the caller’s OWN listing matched by externalId', async () => {
    const { service, updated } = makeService({
      id: 'product-owned-by-b',
      sellerId: SELLER_B,
    });

    await service.create('user-b', dto({ externalId: 'EXT-1' }));

    expect(updated).toHaveLength(1);
    expect(updated[0].where.id).toBe('product-owned-by-b');
  });

  it('creates a SEPARATE listing instead of taking over another seller’s row on a slug match (the bulk-CSV path)', async () => {
    const { service, updated, created } = makeService({
      id: VICTIM_PRODUCT,
      sellerId: SELLER_A,
    });

    // Exactly what seller-bulk-csv.service.ts sends: no slug, no externalId,
    // isMigration true. The slug is derived from the name and collides.
    await service.create('user-b', dto({ isMigration: true }));

    expect(updated).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(created[0].data.seller.connect.id).toBe(SELLER_B);
  });

  it('still upserts the caller’s OWN listing on a slug match', async () => {
    const { service, updated, created } = makeService({
      id: 'product-owned-by-b',
      sellerId: SELLER_B,
    });

    await service.create('user-b', dto({ isMigration: true }));

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].where.id).toBe('product-owned-by-b');
  });

  it('never writes sellerId when updating an existing listing', async () => {
    const { service, updated } = makeService({
      id: 'product-owned-by-b',
      sellerId: SELLER_B,
    });

    await service.create('user-b', dto({ externalId: 'EXT-1' }));

    // Ownership transfer must be structurally impossible, not merely unused:
    // `upsertExistingProduct` no longer takes a seller and no longer writes one.
    expect(updated[0].data).not.toHaveProperty('sellerId');
  });
});

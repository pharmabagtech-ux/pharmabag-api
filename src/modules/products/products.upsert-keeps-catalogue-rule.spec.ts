import { ProductApprovalStatus } from '@prisma/client';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';

/**
 * C1: create()'s externalId/slug upsert paths bypassed all three catalogue
 * invariants — no row with masterProductId: null, no seller-controlled
 * identity, no isActive: true on anything but an APPROVED row — because both
 * "matched by externalId" and "matched by slug" returned straight into
 * upsertExistingProduct before resolveCatalogueMaster or any approval check
 * ever ran. products.master-required.spec.ts's harness hard-wires
 * product.findUnique/findFirst to null specifically so create() never takes
 * this path, so nothing there ever covered it.
 *
 * Route 2 (a crafted request): POST an externalId matching the seller's own
 * live, catalogue-linked listing, plus a new name. upsertExistingProduct used
 * to write dto.name straight through — the same two-request identity walkaround
 * assertListingIdentityUnchanged exists to stop in update(), just using POST
 * instead of PATCH.
 *
 * Route 1 (no crafted request — the seller CSV importer): a seller has a
 * legacy orphan listing (masterProductId: null, PENDING, isActive: false) for
 * a product since added to the catalogue. Their CSV upload sends isMigration:
 * true, no slug, no externalId, and the catalogue's own name — which is what
 * makes normalizeDto derive a slug that collides with the orphan's own. The
 * match lands on the same seller's row, so control reaches
 * upsertExistingProduct, which used to set isActive: true unconditionally and
 * never wrote masterProductId at all: all three invariants broken by one
 * ordinary CSV upload, reported back to the seller as success.
 */

const SELLER_ID = 'seller-1';
const MASTER_ID = 'master-1';
const PRODUCT_NAME = 'Sinarest Syrup 75 mL';

interface ExistingRow {
  id: string;
  sellerId: string;
  masterProductId: string | null;
  approvalStatus: ProductApprovalStatus;
  name: string;
}

interface Harness {
  service: ProductsService;
  updated: any[];
  created: any[];
}

/**
 * @param existing the seller's own row that the externalId or slug lookup
 * will match.
 * @param matchBy which of create()'s two upsert branches the match should
 * come through — externalId (Route 2's shape) or slug (Route 1's shape).
 */
const makeService = (
  existing: ExistingRow,
  matchBy: 'externalId' | 'slug' = 'externalId',
): Harness => {
  const updated: any[] = [];
  const created: any[] = [];

  const prisma: any = {
    sellerProfile: { findUnique: async () => ({ id: SELLER_ID }) },
    category: { findUnique: async () => ({ id: 'cat', name: 'Cat' }) },
    subCategory: { findUnique: async () => ({ id: 'sub', name: 'Sub' }) },
    masterProduct: {
      // Only reached when resolveCatalogueMaster actually runs, i.e. when
      // the matched row is still unlinked (the orphan case).
      findFirst: async (args: any) => {
        if (args?.where?.id !== undefined) {
          return args.where.id === MASTER_ID ? { id: MASTER_ID } : null;
        }
        return { id: MASTER_ID };
      },
      update: async () => ({}),
    },
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
      findUnique: async () => (matchBy === 'externalId' ? existing : null),
      // First call is the slug lookup; a second call would be the
      // same-seller duplicate check further down create() — which must
      // never be reached in these tests, since reaching it means the
      // upsert branch was NOT taken.
      findFirst: (() => {
        let call = 0;
        return async () => (matchBy === 'slug' && call++ === 0 ? existing : null);
      })(),
      update: async (args: any) => {
        updated.push(args);
        return {
          id: args.where.id,
          name: existing.name,
          slug: 's',
          manufacturer: 'Centaur',
          chemicalComposition: 'Paracetamol',
          masterProductId:
            args.data.masterProduct?.connect?.id ?? existing.masterProductId,
          // Mirrors the real query's `include`. The search index is labelled
          // from the returned ROW rather than from the DTO, precisely so a DTO
          // naming another category cannot decide where a listing surfaces in
          // search — so the mock has to supply these.
          category: { name: 'Ethical' },
          subCategory: { name: 'Syrup' },
        };
      },
      create: async (args: any) => {
        created.push(args);
        return { id: 'new-product', name: args.data.name, slug: 's', images: [] };
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
    name: PRODUCT_NAME,
    manufacturer: 'Centaur',
    chemicalComposition: 'Paracetamol',
    categoryId: 'cat',
    subCategoryId: 'sub',
    mrp: 100,
    gstPercent: 12,
    stock: 10,
    ...over,
  }) as CreateProductDto;

describe('ProductsService.create — the upsert paths keep the catalogue rule too', () => {
  it('does not let a new name (or the other four identity fields) reach prisma.product.update via an externalId match', async () => {
    const existing: ExistingRow = {
      id: 'product-1',
      sellerId: SELLER_ID,
      masterProductId: MASTER_ID,
      approvalStatus: ProductApprovalStatus.APPROVED,
      name: PRODUCT_NAME,
    };
    const { service, updated } = makeService(existing);

    // Route 2: same externalId, a different name and the other four
    // identity fields too.
    await service.create(
      'user-1',
      dto({
        externalId: 'EXT-1',
        name: 'Something Else Entirely',
        manufacturer: 'A Different Manufacturer',
        chemicalComposition: 'A Different Composition',
        categoryId: 'a-different-category',
        subCategoryId: 'a-different-subcategory',
      }),
    );

    expect(updated).toHaveLength(1);
    const data = updated[0].data;
    expect(data).not.toHaveProperty('name');
    expect(data).not.toHaveProperty('slug');
    expect(data).not.toHaveProperty('manufacturer');
    expect(data).not.toHaveProperty('chemicalComposition');
    expect(data).not.toHaveProperty('categoryId');
    expect(data).not.toHaveProperty('subCategoryId');
  });

  it('writes a masterProductId link on the upsert path', async () => {
    const existing: ExistingRow = {
      id: 'product-1',
      sellerId: SELLER_ID,
      masterProductId: MASTER_ID,
      approvalStatus: ProductApprovalStatus.APPROVED,
      name: PRODUCT_NAME,
    };
    const { service, updated } = makeService(existing);

    await service.create('user-1', dto({ externalId: 'EXT-1' }));

    expect(updated[0].data.masterProduct.connect.id).toBe(MASTER_ID);
  });

  it('does not set isActive: true on a PENDING row via the upsert path', async () => {
    const existing: ExistingRow = {
      id: 'product-1',
      sellerId: SELLER_ID,
      masterProductId: MASTER_ID,
      approvalStatus: ProductApprovalStatus.PENDING,
      name: PRODUCT_NAME,
    };
    const { service, updated } = makeService(existing);

    await service.create('user-1', dto({ externalId: 'EXT-1' }));

    expect(updated[0].data.isActive).toBe(false);
  });

  it('does set isActive: true on an APPROVED row via the upsert path', async () => {
    const existing: ExistingRow = {
      id: 'product-1',
      sellerId: SELLER_ID,
      masterProductId: MASTER_ID,
      approvalStatus: ProductApprovalStatus.APPROVED,
      name: PRODUCT_NAME,
    };
    const { service, updated } = makeService(existing);

    await service.create('user-1', dto({ externalId: 'EXT-1' }));

    expect(updated[0].data.isActive).toBe(true);
  });

  it('links and does not publish a legacy orphan hit by a slug collision (Route 1: the CSV importer)', async () => {
    // The orphan: predates the catalogue rule, never linked, never approved.
    const existing: ExistingRow = {
      id: 'orphan-1',
      sellerId: SELLER_ID,
      masterProductId: null,
      approvalStatus: ProductApprovalStatus.PENDING,
      name: PRODUCT_NAME,
    };
    const { service, updated, created } = makeService(existing, 'slug');

    // Exactly what seller-bulk-csv.service.ts sends: isMigration true, no
    // slug, no externalId, the masterProductId of the catalogue row it
    // matched the CSV line against, and that row's own name — which is what
    // makes normalizeDto derive a slug that collides with the orphan's.
    await service.create(
      'user-1',
      dto({ isMigration: true, masterProductId: MASTER_ID, name: PRODUCT_NAME }),
    );

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
    const data = updated[0].data;

    // The three invariants, all at once, on the exact shape that reaches
    // production through the bulk-CSV importer.
    expect(data.masterProduct.connect.id).toBe(MASTER_ID); // (a) linked
    expect(data).not.toHaveProperty('name'); // (b) identity untouched
    expect(data.isActive).toBe(false); // (c) not published while PENDING
  });
});

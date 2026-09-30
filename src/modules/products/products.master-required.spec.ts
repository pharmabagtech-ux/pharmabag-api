import { BadRequestException } from '@nestjs/common';
import { ProductApprovalStatus } from '@prisma/client';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';

/**
 * A seller could invent a product that does not exist in the catalogue.
 *
 * The seller portal's "Add New Product" form offered Quick Search as an
 * optional convenience — "select from suggestions to auto-fill product details,
 * or enter manually below" — so a seller could type any name, manufacturer and
 * composition and submit. `create()` then looked for an exact
 * name + manufacturer match against MasterProduct and, finding none, created
 * the listing anyway as `approvalStatus: PENDING, isActive: false`.
 *
 * That row is invisible to buyers (the storefront grid queries MasterProduct
 * and joins listings), so the seller saw "Product added successfully" and then
 * a product nobody could ever buy. The rows accumulated with no one reviewing
 * them. The seller bulk-CSV importer had never allowed this — it skips
 * unmatched rows with "product not in catalog" — so the manual form was the
 * one path that let uncatalogued products in.
 *
 * Sellers who genuinely stock something we do not carry use the product-request
 * flow (`POST /products/requests`, reviewed by admin at /product-requests),
 * which is what the form now points them at.
 *
 * These tests pin the rule and the two ways a listing legitimately resolves to
 * a master: an explicit id from the picker, and the name + manufacturer
 * fallback that bulk callers rely on. Migration mode keeps its old unlinked
 * behaviour so historical backfills still import.
 */

const SELLER = 'seller-1';
const MASTER = 'master-product-1';

interface Harness {
  service: ProductsService;
  created: any[];
}

/**
 * @param master the row the name + manufacturer catalogue lookup returns, or
 * null for "this product is not in the catalogue".
 */
const makeService = (master: { id: string } | null): Harness => {
  const created: any[] = [];

  const prisma: any = {
    sellerProfile: { findUnique: async () => ({ id: SELLER }) },
    category: { findUnique: async () => ({ id: 'cat', name: 'Cat' }) },
    subCategory: { findUnique: async () => ({ id: 'sub', name: 'Sub' }) },
    masterProduct: {
      findFirst: async () => master,
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
      // No externalId/slug match and no existing duplicate, so create() reaches
      // the catalogue check rather than returning early down the upsert path.
      findUnique: async () => null,
      findFirst: async () => null,
      update: async () => ({}),
      create: async (args: any) => {
        created.push(args);
        return {
          id: 'new-product',
          name: args.data.name,
          slug: 's',
          manufacturer: args.data.manufacturer,
          chemicalComposition: args.data.chemicalComposition,
          // Echoed back so the "touch the master" branch runs as it would in
          // production.
          masterProductId: args.data.masterProduct?.connect?.id ?? null,
          images: [],
        };
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
  return { service, created };
};

const dto = (over: Partial<CreateProductDto> = {}): CreateProductDto =>
  ({
    name: 'Pregnancy Test Kit',
    manufacturer: 'Acme Diagnostics',
    chemicalComposition: 'N/A',
    categoryId: 'cat',
    subCategoryId: 'sub',
    mrp: 100,
    gstPercent: 12,
    stock: 10,
    expiryDate: '2027-12-31',
    ...over,
  }) as CreateProductDto;

describe('ProductsService.create — listings must come from the catalogue', () => {
  it('rejects a product that matches nothing in the catalogue', async () => {
    const { service, created } = makeService(null);

    await expect(service.create('user-1', dto())).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(created).toHaveLength(0);
  });

  it('names the product and points at the request flow so the seller knows what to do next', async () => {
    const { service } = makeService(null);

    await expect(service.create('user-1', dto())).rejects.toThrow(
      /Pregnancy Test Kit.*not in the PharmaBag catalogue/s,
    );
    await expect(service.create('user-1', dto())).rejects.toThrow(
      /product request/s,
    );
  });

  it('accepts an explicit masterProductId from the search picker', async () => {
    // The catalogue lookup returns null, proving the id alone carried it.
    const { service, created } = makeService(null);

    await service.create('user-1', dto({ masterProductId: MASTER }));

    expect(created).toHaveLength(1);
    expect(created[0].data.masterProduct.connect.id).toBe(MASTER);
  });

  it('falls back to an exact name + manufacturer match when no id is sent', async () => {
    const { service, created } = makeService({ id: MASTER });

    await service.create('user-1', dto());

    expect(created).toHaveLength(1);
    expect(created[0].data.masterProduct.connect.id).toBe(MASTER);
  });

  it('publishes a catalogue-linked listing immediately', async () => {
    const { service, created } = makeService({ id: MASTER });

    await service.create('user-1', dto());

    expect(created[0].data.approvalStatus).toBe(ProductApprovalStatus.APPROVED);
    expect(created[0].data.isActive).toBe(true);
  });

  it('does not let isMigration buy a bypass', async () => {
    // `isMigration` is an optional boolean on CreateProductDto and
    // POST /products is seller-facing, so honouring it here would enforce the
    // catalogue rule only against sellers who did not think to send it.
    const { service, created } = makeService(null);

    await expect(
      service.create('user-1', dto({ isMigration: true })),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(created).toHaveLength(0);
  });
});

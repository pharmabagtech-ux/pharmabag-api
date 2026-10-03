import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ProductApprovalStatus } from '@prisma/client';
import { ProductsService } from './products.service';
import { UpdateProductDto } from './dto/update-product.dto';

/**
 * Every seller edit of a catalogue-linked listing failed with a 400.
 *
 * products.identity-immutable.spec.ts froze the five identity fields a listing
 * takes from the catalogue, and did it by VALUE comparison precisely because
 * "the seller edit form rebuilds its whole payload on every save" — a presence
 * check would reject every ordinary price edit. masterProductId is a sixth
 * field that same form resends, and it never made it onto UpdateProductDto.
 *
 * So it was not the identity rule that rejected it. The global ValidationPipe
 * in main.ts runs with whitelist + forbidNonWhitelisted, which turns any
 * undeclared property into a 400 before the service is reached at all. The
 * seller portal showed the raw message — "property masterProductId should not
 * exist" — on every save, and no edit to price, stock, expiry or discount
 * could be saved from the portal from 2026-09-30 until this fix. Listings with
 * no master (legacy, unlinked) kept working, which is why it could look
 * intermittent.
 *
 * The fix is the same shape as the rule it was missing from: the field is
 * accepted so an unchanged resubmit passes, and compared by value so a
 * re-point is rejected. It is also stripped from the data handed to
 * prisma.product.update, because unlike the other five this one IS the
 * catalogue link — letting it through the ...productData spread would let a
 * seller move a live, approved listing onto a different catalogue product,
 * which is the exact hole the identity freeze was written to close.
 */

const CURRENT = {
  id: 'product-1',
  name: 'Furic 40mg Tablet',
  manufacturer: 'Lupin',
  chemicalComposition: 'Furosemide 40mg',
  categoryId: 'cat-ethical',
  subCategoryId: 'sub-tablet',
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
          subCategory: { name: 'Tablet' },
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

/** Exactly what the seller portal PATCHes for a stock edit on a linked listing. */
const dto = (over: Partial<UpdateProductDto> = {}): UpdateProductDto =>
  ({
    name: CURRENT.name,
    manufacturer: CURRENT.manufacturer,
    chemicalComposition: CURRENT.chemicalComposition,
    categoryId: CURRENT.categoryId,
    subCategoryId: CURRENT.subCategoryId,
    masterProductId: CURRENT.masterProductId,
    ...over,
  }) as UpdateProductDto;

describe('PATCH /products/:id payload — the seller form payload gets past validation', () => {
  // Same options as the global pipe in main.ts. The bug was here, not in the
  // service, so testing the service alone would have kept passing throughout.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const run = (payload: Record<string, unknown>) =>
    pipe.transform(payload, { type: 'body', metatype: UpdateProductDto });

  it('accepts masterProductId instead of rejecting the whole request', async () => {
    await expect(
      run({ stock: 1470, maximumOrderQuantity: 1470, masterProductId: 'master-1' }),
    ).resolves.toMatchObject({ masterProductId: 'master-1' });
  });

  it('still rejects a property nobody declared', async () => {
    // The whitelist is doing its job otherwise — this fix widens it by one
    // field, it does not turn it off.
    await expect(run({ stock: 1470, nonsenseField: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('coerces masterProductId to a string, as it does every other string field', async () => {
    // enableImplicitConversion is on globally, so @IsString() converts rather
    // than rejects here — exactly as it already does for name and categoryId.
    // Pinned down because the identity check below is a string comparison, and
    // a coerced value still has to meet it.
    await expect(run({ masterProductId: 42 })).resolves.toMatchObject({
      masterProductId: '42',
    });
  });
});

describe('ProductsService.update — a listing keeps its catalogue link', () => {
  it('allows the ordinary stock edit that resends the same master unchanged', async () => {
    // The reported bug, end to end: Furic 40mg Tablet, stock 1400 -> 1470.
    const { service, updated } = makeService();

    await service.update('user-1', 'product-1', dto({ stock: 1470 }));

    expect(updated).toHaveLength(1);
  });

  it('never writes masterProductId to the row, even when it matches', async () => {
    // It arrives only because the form resends it. There is nothing to refresh,
    // and leaving it in the spread is what would make a re-point possible.
    const { service, updated } = makeService();

    await service.update('user-1', 'product-1', dto({ mrp: 300 }));

    expect(updated[0].data).not.toHaveProperty('masterProductId');
    expect(updated[0].data.mrp).toBe(300);
  });

  it('rejects moving the listing onto a different catalogue product', async () => {
    const { service, updated } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ masterProductId: 'master-2' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updated).toHaveLength(0);
  });

  it('rejects a seller linking a legacy unlinked listing to a master itself', async () => {
    // Linking is admin's call via the catalogue, not something a seller can do
    // by PATCHing a row that predates the rule.
    const { service, updated } = makeService({ masterProductId: null as any });

    await expect(
      service.update('user-1', 'product-1', dto({ masterProductId: 'master-9' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updated).toHaveLength(0);
  });

  it('still allows an edit on a legacy unlinked listing that sends no master', async () => {
    const { service, updated } = makeService({ masterProductId: null as any });

    await service.update('user-1', 'product-1', {
      stock: 40,
    } as UpdateProductDto);

    expect(updated).toHaveLength(1);
  });
});

import { AdminService } from './admin.service';

/**
 * The product page renders six MasterProduct columns that the admin modal
 * never exposed — directions for use, safety advice, therapeutic class, side
 * effects, pack size and storage. They were writable only by CSV import, so
 * the words on a live product page could not be corrected by hand.
 *
 * These tests pin the same three-state contract the SEO overrides use: a value
 * stores it, an empty string clears it to null, an omitted field is left
 * alone. Truthiness spreads would swallow the clear and the admin would see a
 * field empty after saving while the live page kept the old text.
 */
describe('AdminService.updateSuggestion — product content fields', () => {
  const makeService = () => {
    const captured: { data?: any } = {};
    const prisma = {
      masterProduct: {
        findUnique: jest.fn(async () => ({ id: 'm-1', name: 'Dolo 650' })),
        update: jest.fn(async ({ data }: any) => {
          captured.data = data;
          return { id: 'm-1', ...data };
        }),
      },
    };
    const service = Object.create(AdminService.prototype) as AdminService;
    (service as any).prisma = prisma;
    return { service, captured };
  };

  it('persists every content field, trimmed', async () => {
    const { service, captured } = makeService();
    await service.updateSuggestion('m-1', {
      directionsForUse: '  As directed by the physician.  ',
      safetyAdvice: 'Keep out of reach of children.',
      therapeuticClass: 'Analgesic',
      sideEffects: 'Nausea, rash.',
      packSize: '15 tablets',
      storageAndHandling: 'Store below 25°C.',
    } as any);

    expect(captured.data).toMatchObject({
      directionsForUse: 'As directed by the physician.',
      safetyAdvice: 'Keep out of reach of children.',
      therapeuticClass: 'Analgesic',
      sideEffects: 'Nausea, rash.',
      packSize: '15 tablets',
      storageAndHandling: 'Store below 25°C.',
    });
  });

  it('empty string CLEARS a content field to null', async () => {
    const { service, captured } = makeService();
    await service.updateSuggestion('m-1', {
      directionsForUse: '',
      packSize: '   ',
    } as any);

    expect(captured.data.directionsForUse).toBeNull();
    expect(captured.data.packSize).toBeNull();
  });

  it('leaves a content field untouched when it is absent', async () => {
    const { service, captured } = makeService();
    await service.updateSuggestion('m-1', { name: 'Dolo 650' } as any);

    expect(captured.data.directionsForUse).toBeUndefined();
    expect(captured.data.safetyAdvice).toBeUndefined();
    expect(captured.data.therapeuticClass).toBeUndefined();
  });
});

/**
 * createSuggestion shares UpdateSuggestionDto with the update path, but wrote
 * only the ten basic columns — so anything an admin typed into the SEO or
 * content fields while ADDING a product was accepted by validation and then
 * silently dropped. That is why the SEO panel was edit-only.
 */
describe('AdminService.createSuggestion — content and SEO on create', () => {
  const makeService = () => {
    const captured: { data?: any } = {};
    const prisma = {
      masterProduct: {
        create: jest.fn(async ({ data }: any) => {
          captured.data = data;
          return { id: 'new-1', ...data };
        }),
      },
    };
    const service = Object.create(AdminService.prototype) as AdminService;
    (service as any).prisma = prisma;
    return { service, captured };
  };

  it('persists content and SEO fields given at creation', async () => {
    const { service, captured } = makeService();
    await service.createSuggestion({
      name: 'Dolo 650',
      manufacturer: 'Micro Labs',
      categoryId: 'cat-1',
      subCategoryId: 'sub-1',
      directionsForUse: 'As directed.',
      safetyAdvice: 'Store safely.',
      therapeuticClass: 'Analgesic',
      sideEffects: 'Nausea.',
      packSize: '15 tablets',
      storageAndHandling: 'Below 25°C.',
      metaTitle: 'Dolo 650 Wholesale',
      metaDescription: 'Bulk rates.',
      ogImage: 'https://img.example/og.png',
    } as any);

    expect(captured.data).toMatchObject({
      name: 'Dolo 650',
      directionsForUse: 'As directed.',
      safetyAdvice: 'Store safely.',
      therapeuticClass: 'Analgesic',
      sideEffects: 'Nausea.',
      packSize: '15 tablets',
      storageAndHandling: 'Below 25°C.',
      metaTitle: 'Dolo 650 Wholesale',
      metaDescription: 'Bulk rates.',
      ogImage: 'https://img.example/og.png',
    });
  });

  it('stores null rather than empty string for fields left blank', async () => {
    const { service, captured } = makeService();
    await service.createSuggestion({
      name: 'Dolo 650',
      manufacturer: 'Micro Labs',
      categoryId: 'cat-1',
      subCategoryId: 'sub-1',
      metaTitle: '',
      directionsForUse: '',
    } as any);

    expect(captured.data.metaTitle).toBeNull();
    expect(captured.data.directionsForUse).toBeNull();
  });
});

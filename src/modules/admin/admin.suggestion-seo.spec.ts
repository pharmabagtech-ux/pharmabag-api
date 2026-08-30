import { AdminService } from './admin.service';

/**
 * updateSuggestion's data object historically used TRUTHINESS spreads, under
 * which an empty string silently vanishes. The SEO override fields need
 * empty-string to mean "clear back to the generated head" — these tests pin
 * that contract (set → value, '' → null, omitted → untouched).
 */
describe('AdminService.updateSuggestion — SEO overrides', () => {
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

  it('persists trimmed override values', async () => {
    const { service, captured } = makeService();
    await service.updateSuggestion('m-1', {
      metaTitle: '  Dolo 650 Wholesale — Micro Labs  ',
      metaDescription: 'Bulk rates.',
      ogImage: 'https://img.example/og.png',
    } as any);
    expect(captured.data).toMatchObject({
      metaTitle: 'Dolo 650 Wholesale — Micro Labs',
      metaDescription: 'Bulk rates.',
      ogImage: 'https://img.example/og.png',
    });
  });

  it('empty string CLEARS an override to null', async () => {
    const { service, captured } = makeService();
    await service.updateSuggestion('m-1', { metaTitle: '' } as any);
    expect(captured.data.metaTitle).toBeNull();
  });

  it('omitted fields stay untouched', async () => {
    const { service, captured } = makeService();
    await service.updateSuggestion('m-1', { name: 'Dolo 650' } as any);
    expect('metaTitle' in captured.data).toBe(false);
    expect('metaDescription' in captured.data).toBe(false);
    expect('ogImage' in captured.data).toBe(false);
  });
});

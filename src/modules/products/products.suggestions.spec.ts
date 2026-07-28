import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../../database/prisma.service';
import { InventoryService } from './services/inventory.service';
import { SearchIndexService } from './services/search-index.service';
import { AnalyticsService } from './services/analytics.service';

/**
 * Recursively evaluate a (subset of) Prisma `where` object against a plain
 * object, so the mocked findMany actually filters like the DB would. Supports
 * the shapes getSuggestions builds: AND / OR arrays, scalar equality
 * (deletedAt / isActive / approvalStatus) and `{ contains, mode }` on
 * name / manufacturer / chemicalComposition.
 */
function matchWhere(item: any, where: any): boolean {
  return Object.entries(where).every(([key, val]: [string, any]) => {
    if (key === 'AND') return (val as any[]).every((w) => matchWhere(item, w));
    if (key === 'OR') return (val as any[]).some((w) => matchWhere(item, w));
    if (val && typeof val === 'object' && 'contains' in val) {
      const hay = String(item[key] ?? '').toLowerCase();
      return hay.includes(String(val.contains).toLowerCase());
    }
    return item[key] === val;
  });
}

// Catalog mirroring the real bug report: the four alphabetically-first
// products all *incidentally* contain the tokens "a", "to", "z" across
// name/manufacturer/chemicalComposition, while the genuine "A to Z ..."
// family sorts later.
const CATALOG = [
  { id: '4u', sku: 'PB4U', name: '4U Q10 Plus Capsule', manufacturer: 'Dr. Johns Laboratories', chemicalComposition: 'Coenzyme Q10' },
  { id: '6mp', sku: 'PB6MP', name: '6 MP Tablet', manufacturer: 'Zydus Lifescience', chemicalComposition: 'Mercaptopurine 50mg' },
  { id: 'abd', sku: 'PBABD', name: 'Abd Plus Tablet', manufacturer: 'Intas', chemicalComposition: 'Pantoprazole 40mg + Domperidone 10mg' },
  { id: 'abz', sku: 'PBABZ', name: 'ABZ Syrup 200 mL', manufacturer: 'Elder Laboratories', chemicalComposition: 'Albendazole 200mg/5mL' },
  { id: 'atoz-amino', sku: 'PBAMINO', name: 'A to Z Amino Tablet', manufacturer: 'Alkem', chemicalComposition: 'Multivitamin + Amino Acids' },
  { id: 'atoz-gold', sku: 'PBGOLD', name: 'A to Z Gold Soft NS Capsule', manufacturer: 'Alkem', chemicalComposition: 'Multivitamin' },
  { id: 'atoz-ns', sku: 'PBNS', name: 'A to Z NS Tablet', manufacturer: 'Alkem', chemicalComposition: 'Multivitamin + Minerals' },
].map((p) => ({
  ...p,
  company: { name: p.manufacturer },
  slug: p.sku.toLowerCase(),
  chemicalCompositionRef: { name: p.chemicalComposition },
  mrp: 100,
  gstPercent: 12,
  categoryId: 'cat-1',
  subCategoryId: 'sub-1',
  images: [],
  deletedAt: null,
  isActive: true,
}));

const mockPrisma = {
  masterProduct: {
    findMany: jest.fn(({ where, take, orderBy }: any) => {
      let rows = CATALOG.filter((item) => matchWhere(item, where));
      if (orderBy?.name === 'asc') {
        rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
      }
      if (take) rows = rows.slice(0, take);
      return Promise.resolve(rows);
    }),
  },
  product: { findMany: jest.fn().mockResolvedValue([]) },
};

describe('ProductsService.getSuggestions (autocomplete ranking)', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: {} },
        { provide: SearchIndexService, useValue: {} },
        { provide: AnalyticsService, useValue: {} },
      ],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
    jest.clearAllMocks();
  });

  it('ranks whole-phrase name matches first for a short multi-word query', async () => {
    const results = await service.getSuggestions('A to Z', 'master');
    const names = results.map((r: any) => r.productName);

    // The bug: without phrase ranking, the alphabetically-first token noise
    // (4U / 6 MP / Abd / ABZ) is returned and the A-to-Z family never appears.
    expect(names[0]).toMatch(/^A to Z/);
    expect(names).toEqual(
      expect.arrayContaining([
        'A to Z Amino Tablet',
        'A to Z Gold Soft NS Capsule',
        'A to Z NS Tablet',
      ]),
    );
  });

  it('still resolves an exact full product name', async () => {
    const results = await service.getSuggestions('A to Z Amino Tablet', 'master');
    expect(results.map((r: any) => r.productName)).toContain('A to Z Amino Tablet');
  });

  it('falls back to cross-field matching when the phrase is not in any name', async () => {
    // "Zydus" appears only as a manufacturer, so phrase-on-name finds nothing
    // and the per-word fallback must still surface the product.
    const results = await service.getSuggestions('Zydus', 'master');
    expect(results.map((r: any) => r.productName)).toContain('6 MP Tablet');
  });

  it('returns empty for queries shorter than two characters', async () => {
    expect(await service.getSuggestions('A', 'master')).toEqual([]);
  });
});

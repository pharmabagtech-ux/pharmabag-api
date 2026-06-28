import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SellerBulkCsvService } from './seller-bulk-csv.service';
import { PrismaService } from '../../../database/prisma.service';
import { ProductsService } from '../products.service';

const mockPrisma = {
  masterProduct: { findMany: jest.fn(), findFirst: jest.fn() },
  sellerProfile: { findUnique: jest.fn() },
  product: { findFirst: jest.fn() },
};

const mockProductsService = { create: jest.fn() };

describe('SellerBulkCsvService', () => {
  let service: SellerBulkCsvService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerBulkCsvService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProductsService, useValue: mockProductsService },
      ],
    }).compile();
    service = module.get<SellerBulkCsvService>(SellerBulkCsvService);
    jest.clearAllMocks();
  });

  describe('generateTemplate', () => {
    it('returns CSV with header and one row per active master product', async () => {
      mockPrisma.masterProduct.findMany.mockResolvedValue([
        { name: 'Dolo 650' },
        { name: 'Calpol, 500mg' },
      ]);
      const csv = await service.generateTemplate();
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Product Name,Stock,Price');
      expect(lines[1]).toBe('"Dolo 650",,');
      expect(lines[2]).toBe('"Calpol, 500mg",,');
    });
  });

  describe('processUpload', () => {
    const sellerId = 'seller-uuid';
    const userId = 'user-uuid';

    beforeEach(() => {
      mockPrisma.sellerProfile.findUnique.mockResolvedValue({ id: sellerId });
    });

    it('throws ForbiddenException when seller profile not found', async () => {
      mockPrisma.sellerProfile.findUnique.mockResolvedValue(null);
      const csv = Buffer.from('Product Name,Stock,Price\nDolo 650,100,28\n');
      await expect(service.processUpload(csv, userId)).rejects.toThrow(ForbiddenException);
    });

    it('skips row with blank stock', async () => {
      const csv = Buffer.from('Product Name,Stock,Price\nDolo 650,,28\n');
      const result = await service.processUpload(csv, userId);
      expect(result.skippedCount).toBe(1);
      expect(result.skipped[0].reason).toBe('missing stock or price');
      expect(result.successCount).toBe(0);
    });

    it('skips row with blank price', async () => {
      const csv = Buffer.from('Product Name,Stock,Price\nDolo 650,100,\n');
      const result = await service.processUpload(csv, userId);
      expect(result.skippedCount).toBe(1);
      expect(result.skipped[0].reason).toBe('missing stock or price');
    });

    it('skips row whose name has no master catalog match', async () => {
      mockPrisma.masterProduct.findFirst.mockResolvedValue(null);
      const csv = Buffer.from('Product Name,Stock,Price\nUnknown Product,100,28\n');
      const result = await service.processUpload(csv, userId);
      expect(result.skippedCount).toBe(1);
      expect(result.skipped[0].reason).toBe('product not in catalog');
    });

    it('skips row when seller already has a listing for that master product', async () => {
      mockPrisma.masterProduct.findFirst.mockResolvedValue({
        id: 'master-1', name: 'Dolo 650', categoryId: 'cat-1', subCategoryId: 'sub-1',
        manufacturer: 'Micro Labs', chemicalComposition: 'Paracetamol 650mg',
        gstPercent: 12, description: null, company: null,
      });
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'existing-product' });
      const csv = Buffer.from('Product Name,Stock,Price\nDolo 650,100,28\n');
      const result = await service.processUpload(csv, userId);
      expect(result.skippedCount).toBe(1);
      expect(result.skipped[0].reason).toBe('already listed');
    });

    it('creates product when name matches and no existing listing', async () => {
      mockPrisma.masterProduct.findFirst.mockResolvedValue({
        id: 'master-1', name: 'Dolo 650', categoryId: 'cat-1', subCategoryId: 'sub-1',
        manufacturer: 'Micro Labs', chemicalComposition: 'Paracetamol 650mg',
        gstPercent: 12, description: 'Pain relief', company: { name: 'Micro Labs Ltd' },
      });
      mockPrisma.product.findFirst.mockResolvedValue(null);
      mockProductsService.create.mockResolvedValue({ id: 'new-product' });
      const csv = Buffer.from('Product Name,Stock,Price\nDolo 650,100,28\n');
      const result = await service.processUpload(csv, userId);
      expect(result.successCount).toBe(1);
      expect(result.skippedCount).toBe(0);
      expect(mockProductsService.create).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          masterProductId: 'master-1',
          categoryId: 'cat-1',
          subCategoryId: 'sub-1',
          manufacturer: 'Micro Labs Ltd',
          stock: 100,
          mrp: 28,
        }),
      );
    });
  });
});

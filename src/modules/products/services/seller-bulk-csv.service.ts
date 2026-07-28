import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { ProductsService } from '../products.service';
import * as csvParserModule from 'csv-parser';
const csv = (csvParserModule as any).default || csvParserModule;
import { Readable } from 'stream';

export interface SkippedRow {
  row: number;
  name: string;
  reason: 'missing stock or price' | 'product not in catalog' | 'already listed' | 'failed to create listing';
}

export interface BulkUploadResult {
  successCount: number;
  skippedCount: number;
  skipped: SkippedRow[];
}

@Injectable()
export class SellerBulkCsvService {
  private readonly logger = new Logger(SellerBulkCsvService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
  ) {}

  async generateTemplate(): Promise<string> {
    const masters = await this.prisma.masterProduct.findMany({
      where: { isActive: true, deletedAt: null },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    const header = 'Product Name,Stock,Price';
    const rows = masters.map((m) => `"${m.name.replace(/"/g, '""')}",,`);
    return [header, ...rows].join('\n');
  }

  async processUpload(buffer: Buffer, userId: string): Promise<BulkUploadResult> {
    const seller = await this.prisma.sellerProfile.findUnique({ where: { userId } });
    if (!seller) throw new ForbiddenException('Seller profile not found');

    const rows = await this.parseCsv(buffer);
    if (rows.length === 0) throw new BadRequestException('CSV has no data rows');

    const result: BulkUploadResult = { successCount: 0, skippedCount: 0, skipped: [] };
    const defaultExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    for (const [index, row] of rows.entries()) {
      const rowNum = index + 2;
      const name = row['Product Name']?.trim();
      const stockRaw = row['Stock']?.trim();
      const priceRaw = row['Price']?.trim();

      if (!name || !stockRaw || !priceRaw) {
        result.skippedCount++;
        result.skipped.push({ row: rowNum, name: name || '(blank)', reason: 'missing stock or price' });
        continue;
      }

      const stock = parseInt(stockRaw, 10);
      const price = parseFloat(priceRaw);

      if (isNaN(stock) || isNaN(price) || stock < 0 || price <= 0) {
        result.skippedCount++;
        result.skipped.push({ row: rowNum, name, reason: 'missing stock or price' });
        continue;
      }

      const master = await this.prisma.masterProduct.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, isActive: true, deletedAt: null },
        include: { company: { select: { name: true } } },
      });

      if (!master) {
        result.skippedCount++;
        result.skipped.push({ row: rowNum, name, reason: 'product not in catalog' });
        continue;
      }

      const existing = await this.prisma.product.findFirst({
        where: { sellerId: seller.id, masterProductId: master.id, deletedAt: null },
      });

      if (existing) {
        result.skippedCount++;
        result.skipped.push({ row: rowNum, name, reason: 'already listed' });
        continue;
      }

      try {
        await this.productsService.create(userId, {
          name: master.name,
          masterProductId: master.id,
          categoryId: master.categoryId,
          subCategoryId: master.subCategoryId,
          manufacturer: master.company?.name ?? master.manufacturer ?? 'N/A',
          chemicalComposition: master.chemicalComposition ?? 'N/A',
          description: master.description ?? undefined,
          mrp: price,
          gstPercent: master.gstPercent ?? 0,
          stock,
          expiryDate: defaultExpiry,
          isMigration: true,
        });
        result.successCount++;
      } catch (err) {
        result.skippedCount++;
        result.skipped.push({ row: rowNum, name, reason: 'failed to create listing' });
        this.logger.warn(`Bulk CSV row ${rowNum} failed: ${(err as Error).message}`);
      }
    }

    return result;
  }

  private parseCsv(buffer: Buffer): Promise<Record<string, string>[]> {
    const rows: Record<string, string>[] = [];
    const content = buffer.toString('utf8').replace(/^﻿/, '');
    const stream = Readable.from([content]);
    return new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row: Record<string, string>) => rows.push(row))
        .on('end', () => resolve(rows))
        .on('error', (err: Error) =>
          reject(new BadRequestException(`Failed to parse CSV: ${err.message}`)),
        );
    });
  }
}

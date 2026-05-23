import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import * as csvParserModule from 'csv-parser';
const csv = (csvParserModule as any).default || csvParserModule;
import { Readable } from 'stream';

@Injectable()
export class MasterProductsBulkService {
  private readonly logger = new Logger(MasterProductsBulkService.name);

  constructor(private readonly prisma: PrismaService) {}

  async processBulkCsv(buffer: Buffer, operation: 'NEW' | 'UPDATE' | 'DELETE'): Promise<any> {
    const results: any[] = [];
    const stream = Readable.from(buffer.toString());

    return new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
          try {
            const outcome = await this.executeBulkOperation(results, operation);
            resolve(outcome);
          } catch (error) {
            reject(new BadRequestException(error.message));
          }
        })
        .on('error', (error) => {
          reject(new BadRequestException(`Failed to parse CSV: ${error.message}`));
        });
    });
  }

  private async executeBulkOperation(rows: any[], operation: 'NEW' | 'UPDATE' | 'DELETE') {
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (const [index, row] of rows.entries()) {
      try {
        const rowNum = index + 2; // Assuming row 1 is header
        const sku = row['SKU']?.trim();
        
        if (!sku) {
          throw new Error('SKU is missing');
        }

        if (operation === 'DELETE') {
          const action = row['Action']?.trim() || row['action']?.trim();
          if (action?.toLowerCase() === 'delete') {
            await this.prisma.masterProduct.delete({
              where: { sku },
            });
            successCount++;
          }
          continue;
        }

        // For NEW and UPDATE, we need to normalize relations
        const productName = row['Product name']?.trim();
        const companyName = row['Company']?.trim();
        const mainCategoryName = row['Main Category']?.trim();
        const subCategoryName = row['Sub Category']?.trim();
        const chemCompName = row['Chemical Composition']?.trim();
        const description = row['Description']?.trim();
        const image = row['Image']?.trim();

        if (!productName || !mainCategoryName || !subCategoryName) {
          throw new Error('Product name, Main Category, and Sub Category are required');
        }

        // 1. Ensure Company exists
        let companyId: string | null = null;
        if (companyName) {
          const company = await this.prisma.company.upsert({
            where: { name: companyName },
            update: {},
            create: { name: companyName },
          });
          companyId = company.id;
        }

        // 2. Ensure Chemical Composition exists
        let chemCompId: string | null = null;
        if (chemCompName) {
          const chemComp = await this.prisma.chemicalComposition.upsert({
            where: { name: chemCompName },
            update: {},
            create: { name: chemCompName },
          });
          chemCompId = chemComp.id;
        }

        // 3. Ensure Category exists
        const category = await this.prisma.category.upsert({
          where: { name: mainCategoryName },
          update: {},
          create: { 
            name: mainCategoryName, 
            slug: this.slugify(mainCategoryName) 
          },
        });

        // 4. Ensure SubCategory exists
        const subCategorySlug = this.slugify(subCategoryName);
        let subCategory = await this.prisma.subCategory.findFirst({
          where: { name: subCategoryName, categoryId: category.id },
        });

        if (!subCategory) {
          // It's possible slug is not unique globally, but unique per category.
          // Prisma schema: @@unique([slug, categoryId])
          subCategory = await this.prisma.subCategory.create({
            data: {
              name: subCategoryName,
              slug: subCategorySlug,
              categoryId: category.id,
            },
          });
        }

        // 5. Create or Update MasterProduct
        const productData = {
          name: productName,
          description: description || null,
          categoryId: category.id,
          subCategoryId: subCategory.id,
          companyId: companyId,
          chemicalCompositionId: chemCompId,
        };

        let masterProduct;
        if (operation === 'NEW') {
          masterProduct = await this.prisma.masterProduct.create({
            data: {
              ...productData,
              sku: sku,
            },
          });
        } else if (operation === 'UPDATE') {
          masterProduct = await this.prisma.masterProduct.upsert({
            where: { sku: sku },
            update: productData,
            create: {
              ...productData,
              sku: sku,
            },
          });
        }

        // 6. Handle Image
        if (image) {
          // Check if image already exists for this master product
          const existingImage = await this.prisma.masterProductImage.findFirst({
            where: {
              masterProductId: masterProduct.id,
              url: image,
            },
          });

          if (!existingImage) {
            await this.prisma.masterProductImage.create({
              data: {
                masterProductId: masterProduct.id,
                url: image,
              },
            });
          }
        }

        successCount++;
      } catch (err) {
        failCount++;
        errors.push(`Row ${index + 2}: ${err.message}`);
      }
    }

    return {
      successCount,
      failCount,
      errors,
    };
  }

  async exportToCsv(): Promise<string> {
    const products = await this.prisma.masterProduct.findMany({
      where: { deletedAt: null },
      include: {
        company: true,
        category: true,
        subCategory: true,
        chemicalCompositionRef: true,
        images: {
          take: 1
        }
      }
    });

    const header = ['SKU', 'Product name', 'Company', 'Main Category', 'Sub Category', 'Chemical Composition', 'Description', 'Image'];
    const rows = products.map(p => {
      const companyName = p.company?.name || p.manufacturer || '';
      const chemName = p.chemicalCompositionRef?.name || p.chemicalComposition || '';
      const catName = p.category?.name || '';
      const subCatName = p.subCategory?.name || '';
      const image = p.images?.[0]?.url || '';

      return [
        p.sku || '',
        p.name || '',
        companyName,
        catName,
        subCatName,
        chemName,
        p.description || '',
        image
      ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
    });

    return [header.join(','), ...rows].join('\n');
  }

  private slugify(text: string): string {
    return text.toString().toLowerCase()
      .replace(/\s+/g, '-')           // Replace spaces with -
      .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
      .replace(/\-\-+/g, '-')         // Replace multiple - with single -
      .replace(/^-+/, '')             // Trim - from start of text
      .replace(/-+$/, '');            // Trim - from end of text
  }
}

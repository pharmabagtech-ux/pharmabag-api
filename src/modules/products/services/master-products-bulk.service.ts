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

    const skusToDelete: string[] = [];
    const newOrUpdateRows: any[] = [];

    for (const [index, row] of rows.entries()) {
      const sku = row['SKU']?.trim();
      if (!sku) {
        failCount++;
        errors.push(`Row ${index + 2}: SKU is missing`);
        continue;
      }

      if (operation === 'DELETE') {
        skusToDelete.push(sku);
      } else {
        newOrUpdateRows.push({ ...row, originalIndex: index });
      }
    }

    if (operation === 'DELETE' && skusToDelete.length > 0) {
      const result = await this.prisma.masterProduct.deleteMany({
        where: { sku: { in: skusToDelete } }
      });
      successCount += result.count;
      failCount += (skusToDelete.length - result.count);
      return { successCount, failCount, errors };
    }

    if (newOrUpdateRows.length === 0) return { successCount, failCount, errors };

    // 1. Collect unique names
    const companyNames = new Set<string>();
    const chemCompNames = new Set<string>();
    const categoryNames = new Set<string>();
    const subCategoryData = new Map<string, {name: string, categoryName: string}>();

    for (const row of newOrUpdateRows) {
      if (row['Company']) companyNames.add(row['Company'].trim());
      if (row['Chemical Composition']) chemCompNames.add(row['Chemical Composition'].trim());
      if (row['Main Category']) categoryNames.add(row['Main Category'].trim());
      if (row['Sub Category'] && row['Main Category']) {
        subCategoryData.set(row['Sub Category'].trim(), {
           name: row['Sub Category'].trim(), 
           categoryName: row['Main Category'].trim()
        });
      }
    }

    // 2. Bulk Insert Companies
    if (companyNames.size > 0) {
      await this.prisma.company.createMany({
        data: Array.from(companyNames).map(name => ({ name })),
        skipDuplicates: true,
      });
    }
    const allCompanies = await this.prisma.company.findMany({ where: { name: { in: Array.from(companyNames) } } });
    const companyMap = new Map(allCompanies.map(c => [c.name, c.id]));

    // 3. Bulk Insert ChemComps
    if (chemCompNames.size > 0) {
      await this.prisma.chemicalComposition.createMany({
        data: Array.from(chemCompNames).map(name => ({ name })),
        skipDuplicates: true,
      });
    }
    const allChems = await this.prisma.chemicalComposition.findMany({ where: { name: { in: Array.from(chemCompNames) } } });
    const chemMap = new Map(allChems.map(c => [c.name, c.id]));

    // 4. Bulk Insert Categories
    if (categoryNames.size > 0) {
      await this.prisma.category.createMany({
        data: Array.from(categoryNames).map(name => ({ name, slug: this.slugify(name) })),
        skipDuplicates: true,
      });
    }
    const allCats = await this.prisma.category.findMany({ where: { name: { in: Array.from(categoryNames) } } });
    const catMap = new Map(allCats.map(c => [c.name, c.id]));

    // 5. Bulk Insert SubCategories
    const subCatCreates = Array.from(subCategoryData.values()).map(sub => {
       const catId = catMap.get(sub.categoryName);
       return catId ? { name: sub.name, slug: this.slugify(sub.name), categoryId: catId } : null;
    }).filter(Boolean);

    if (subCatCreates.length > 0) {
      await this.prisma.subCategory.createMany({
        data: subCatCreates as any,
        skipDuplicates: true,
      });
    }
    const allSubCats = await this.prisma.subCategory.findMany({
      where: { name: { in: Array.from(subCategoryData.values()).map(s => s.name) } }
    });
    const subCatMap = new Map(allSubCats.map(c => [`${c.categoryId}-${c.name}`, c.id]));

    // 6. Bulk Prepare Master Products
    const existingProducts = await this.prisma.masterProduct.findMany({
      where: { sku: { in: newOrUpdateRows.map(r => r['SKU'].trim()) } },
      select: { sku: true, id: true }
    });
    const existingSkus = new Set(existingProducts.map(p => p.sku));

    const toInsert: any[] = [];
    const toUpdate: any[] = [];
    const rowImages = new Map<string, string>(); // sku -> imageUrl

    for (const row of newOrUpdateRows) {
      const sku = row['SKU'].trim();
      const productName = row['Product name']?.trim();
      if (!productName) {
        errors.push(`Row ${row.originalIndex + 2}: missing Product name`);
        failCount++;
        continue;
      }
      const catName = row['Main Category']?.trim();
      const subCatName = row['Sub Category']?.trim();
      
      const categoryId = catMap.get(catName);
      const subCategoryId = subCatMap.get(`${categoryId}-${subCatName}`);

      if (!categoryId || !subCategoryId) {
        errors.push(`Row ${row.originalIndex + 2}: missing or invalid category mapping`);
        failCount++;
        continue;
      }

      const companyName = row['Company']?.trim();
      const chemCompName = row['Chemical Composition']?.trim();
      
      const productData = {
        sku: sku,
        name: productName,
        slug: this.slugify(productName),
        description: row['Description']?.trim() || null,
        categoryId: categoryId,
        subCategoryId: subCategoryId,
        companyId: companyName ? companyMap.get(companyName) || null : null,
        chemicalCompositionId: chemCompName ? chemMap.get(chemCompName) || null : null,
        manufacturer: companyName || null,
        chemicalComposition: chemCompName || null,
      };

      if (row['Image']?.trim()) {
        rowImages.set(sku, row['Image'].trim());
      }

      if (existingSkus.has(sku)) {
        if (operation === 'NEW') {
           errors.push(`Row ${row.originalIndex + 2}: SKU ${sku} already exists`);
           failCount++;
        } else {
           toUpdate.push(productData);
        }
      } else {
         toInsert.push(productData);
      }
    }

    if (toInsert.length > 0) {
      const result = await this.prisma.masterProduct.createMany({
        data: toInsert,
        skipDuplicates: true
      });
      successCount += result.count;
    }

    if (toUpdate.length > 0) {
      // Chunk updates to avoid freezing Node.js event loop
      const chunkArray = (array, size) => Array.from({ length: Math.ceil(array.length / size) }, (v, i) => array.slice(i * size, i * size + size));
      const chunks = chunkArray(toUpdate, 50);
      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(async (data) => {
            try {
              await this.prisma.masterProduct.update({
                where: { sku: data.sku },
                data: data
              });
              successCount++;
            } catch(e) {
              failCount++;
              errors.push(`Failed to update SKU ${data.sku}: ${e.message}`);
            }
          })
        );
      }
    }

    // 7. Bulk Images
    if (rowImages.size > 0) {
      const insertedProducts = await this.prisma.masterProduct.findMany({
        where: { sku: { in: Array.from(rowImages.keys()) } },
        select: { id: true, sku: true }
      });
      
      const imagesToInsert: any[] = [];
      for (const product of insertedProducts) {
        imagesToInsert.push({
          masterProductId: product.id,
          url: rowImages.get(product.sku as string)!
        });
      }

      if (imagesToInsert.length > 0) {
        if (operation === 'NEW') {
          await this.prisma.masterProductImage.createMany({
            data: imagesToInsert
          });
        }
      }
    }

    return { successCount, failCount, errors };
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
    if (!text) return '';
    return text.toString().toLowerCase()
      .replace(/\s+/g, '-')           // Replace spaces with -
      .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
      .replace(/\-\-+/g, '-')         // Replace multiple - with single -
      .replace(/^-+/, '')             // Trim - from start of text
      .replace(/-+$/, '');            // Trim - from end of text
  }

  async activateAll(): Promise<{ count: number }> {
    const result = await this.prisma.masterProduct.updateMany({
      where: { isActive: false, deletedAt: null },
      data: { isActive: true },
    });
    return { count: result.count };
  }
}

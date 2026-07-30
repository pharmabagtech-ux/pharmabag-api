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
          } catch (error: any) {
            this.logger.error(`Bulk operation failed: ${error.message}`, error.stack);
            reject(new BadRequestException(error.message));
          }
        })
        .on('error', (error) => {
          reject(new BadRequestException(`Failed to parse CSV: ${error.message}`));
        });
    });
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    if (!array || array.length === 0) return [];
    return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
      array.slice(i * size, i * size + size),
    );
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
      const skuChunks = this.chunkArray(skusToDelete, 1000);
      for (const chunk of skuChunks) {
        const result = await this.prisma.masterProduct.deleteMany({
          where: { sku: { in: chunk } }
        });
        successCount += result.count;
      }
      failCount += (skusToDelete.length - successCount);
      return { successCount, failCount, errors };
    }

    if (newOrUpdateRows.length === 0) return { successCount, failCount, errors };

    // 1. Collect unique names
    const companyNames = new Set<string>();
    const chemCompNames = new Set<string>();
    const categoryNames = new Set<string>();
    const subCategoryData = new Map<string, { name: string; categoryName: string }>();

    for (const row of newOrUpdateRows) {
      if (row['Company']) companyNames.add(row['Company'].trim());
      if (row['Chemical Composition']) chemCompNames.add(row['Chemical Composition'].trim());
      if (row['Main Category']) categoryNames.add(row['Main Category'].trim());
      if (row['Sub Category'] && row['Main Category']) {
        const mainCat = row['Main Category'].trim();
        const subCat = row['Sub Category'].trim();
        subCategoryData.set(`${mainCat}-${subCat}`, {
          name: subCat,
          categoryName: mainCat
        });
      }
    }

    // 2. Bulk Insert Companies in Chunks
    let companyMap = new Map<string, string>();
    if (companyNames.size > 0) {
      const compArray = Array.from(companyNames);
      for (const chunk of this.chunkArray(compArray, 1000)) {
        await this.prisma.company.createMany({
          data: chunk.map(name => ({ name })),
          skipDuplicates: true,
        });
      }
      const allCompanies: { id: string; name: string }[] = [];
      for (const chunk of this.chunkArray(compArray, 1000)) {
        const batch = await this.prisma.company.findMany({ where: { name: { in: chunk } } });
        allCompanies.push(...batch);
      }
      companyMap = new Map(allCompanies.map(c => [c.name, c.id]));
    }

    // 3. Bulk Insert ChemComps in Chunks
    let chemMap = new Map<string, string>();
    if (chemCompNames.size > 0) {
      const chemArray = Array.from(chemCompNames);
      for (const chunk of this.chunkArray(chemArray, 1000)) {
        await this.prisma.chemicalComposition.createMany({
          data: chunk.map(name => ({ name })),
          skipDuplicates: true,
        });
      }
      const allChems: { id: string; name: string }[] = [];
      for (const chunk of this.chunkArray(chemArray, 1000)) {
        const batch = await this.prisma.chemicalComposition.findMany({ where: { name: { in: chunk } } });
        allChems.push(...batch);
      }
      chemMap = new Map(allChems.map(c => [c.name, c.id]));
    }

    // 4. Bulk Insert Categories
    let catMap = new Map<string, string>();
    if (categoryNames.size > 0) {
      const catArray = Array.from(categoryNames);
      for (const chunk of this.chunkArray(catArray, 1000)) {
        await this.prisma.category.createMany({
          data: chunk.map(name => ({ name, slug: this.slugify(name) })),
          skipDuplicates: true,
        });
      }
      const allCats = await this.prisma.category.findMany({ where: { name: { in: catArray } } });
      catMap = new Map(allCats.map(c => [c.name, c.id]));
    }

    // 5. Bulk Insert SubCategories
    const subCatCreates = Array.from(subCategoryData.values()).map(sub => {
      const catId = catMap.get(sub.categoryName);
      return catId ? { name: sub.name, slug: this.slugify(sub.name), categoryId: catId } : null;
    }).filter(Boolean);

    if (subCatCreates.length > 0) {
      for (const chunk of this.chunkArray(subCatCreates, 1000)) {
        await this.prisma.subCategory.createMany({
          data: chunk as any,
          skipDuplicates: true,
        });
      }
    }
    const subCatNames = Array.from(new Set(Array.from(subCategoryData.values()).map(s => s.name)));
    const allSubCats = await this.prisma.subCategory.findMany({
      where: { name: { in: subCatNames } }
    });
    const subCatMap = new Map(allSubCats.map(c => [`${c.categoryId}-${c.name}`, c.id]));

    // 6. Bulk Prepare Master Products
    const skuList = newOrUpdateRows.map(r => r['SKU'].trim());
    const existingProducts: { sku: string | null; id: string }[] = [];
    for (const chunk of this.chunkArray(skuList, 1000)) {
      const batch = await this.prisma.masterProduct.findMany({
        where: { sku: { in: chunk } },
        select: { sku: true, id: true }
      });
      existingProducts.push(...batch);
    }
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

      if (!catName || !subCatName) {
        errors.push(`Row ${row.originalIndex + 2}: missing Main Category or Sub Category in CSV`);
        failCount++;
        continue;
      }

      const categoryId = catMap.get(catName);
      const subCategoryId = subCatMap.get(`${categoryId}-${subCatName}`);

      if (!categoryId || !subCategoryId) {
        errors.push(`Row ${row.originalIndex + 2}: invalid category mapping (Main: '${catName}', Sub: '${subCatName}')`);
        failCount++;
        continue;
      }

      const companyName = row['Company']?.trim();
      const chemCompName = row['Chemical Composition']?.trim();

      const productData = {
        sku: sku,
        name: productName,
        slug: this.generateUniqueSlug(productName, sku),
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
      for (const chunk of this.chunkArray(toInsert, 500)) {
        const result = await this.prisma.masterProduct.createMany({
          data: chunk,
          skipDuplicates: true
        });
        successCount += result.count;
      }
    }

    if (toUpdate.length > 0) {
      const updateResult = await this.bulkUpdateMasterProducts(toUpdate);
      successCount += updateResult.updatedCount;
      if (updateResult.errors.length > 0) {
        errors.push(...updateResult.errors);
        failCount += updateResult.errors.length;
      }

      // The SKU is the anchor: a correction made against a SKU in the sheet has
      // to reach every seller listing on that SKU, otherwise the catalogue and
      // the sellers disagree about what the product is called.
      const propagated = await this.propagateToSellerListings(
        toUpdate.map((p) => p.sku),
      );
      if (propagated.renamed > 0) {
        this.logger.log(
          `Propagated catalogue names to ${propagated.renamed} seller listing(s)`,
        );
      }
      // Surface drastic renames. A spelling fix and "this SKU is now a
      // different drug" are indistinguishable to the mechanism, and the second
      // silently relabels a seller's physical stock.
      for (const w of propagated.suspicious) {
        errors.push(
          `WARNING: SKU ${w.sku} renamed a seller listing from "${w.before}" to "${w.after}" — verify this is the same product`,
        );
      }
    }

    // 7. Bulk Images
    if (rowImages.size > 0) {
      const imageSkus = Array.from(rowImages.keys());
      const insertedProducts: { id: string; sku: string | null }[] = [];
      for (const chunk of this.chunkArray(imageSkus, 1000)) {
        const batch = await this.prisma.masterProduct.findMany({
          where: { sku: { in: chunk } },
          select: { id: true, sku: true }
        });
        insertedProducts.push(...batch);
      }

      const imagesToInsert: any[] = [];
      for (const product of insertedProducts) {
        if (product.sku && rowImages.has(product.sku)) {
          imagesToInsert.push({
            masterProductId: product.id,
            url: rowImages.get(product.sku)!
          });
        }
      }

      if (imagesToInsert.length > 0) {
        for (const chunk of this.chunkArray(imagesToInsert, 500)) {
          await this.prisma.masterProductImage.createMany({
            data: chunk,
            skipDuplicates: true
          });
        }
      }
    }

    return { successCount, failCount, errors };
  }

  /**
   * Push catalogue names down onto the seller listings that sit on those SKUs.
   *
   * The SKU is the anchor for a product's identity, so correcting a name in the
   * sheet has to reach the sellers too — otherwise the catalogue says one thing
   * and every seller listing keeps the old spelling.
   *
   * Listings are matched through masterProductId (the real relation) rather than
   * products.sku, so a listing whose own SKU has drifted is still updated.
   */
  private async propagateToSellerListings(
    skus: string[],
  ): Promise<{ renamed: number; suspicious: { sku: string; before: string; after: string }[] }> {
    let renamed = 0;
    const suspicious: { sku: string; before: string; after: string }[] = [];

    for (const chunk of this.chunkArray(skus, 500)) {
      // Look first so we can report what changed, and judge whether each rename
      // is a spelling correction or a different product altogether.
      const pending = await this.prisma.$queryRaw<
        { sku: string; before: string; after: string }[]
      >`
        SELECT m.sku, p.name AS before, m.name AS after
        FROM products p
        JOIN master_products m ON m.id = p."masterProductId"
        WHERE m.sku = ANY(${chunk})
          AND p."deletedAt" IS NULL
          AND p.name IS DISTINCT FROM m.name
      `;

      for (const row of pending) {
        if (!this.looksLikeSameProduct(row.before, row.after)) {
          suspicious.push(row);
        }
      }

      // slug mirrors generateSlug() in ProductsService. Deliberately written
      // without backslash escapes: inside a JS template literal '\s' collapses
      // to 's', which would make the regex replace the letter s.
      const affected = await this.prisma.$executeRaw`
        UPDATE products p
           SET name = m.name,
               slug = regexp_replace(
                        regexp_replace(lower(btrim(m.name)), '[^a-z0-9]+', '-', 'g'),
                      '(^-|-$)', '', 'g'),
               manufacturer = coalesce(m.manufacturer, p.manufacturer),
               "chemicalComposition" = coalesce(m."chemicalComposition", p."chemicalComposition"),
               "companyId" = coalesce(m."companyId", p."companyId"),
               "chemicalCompositionId" = coalesce(m."chemicalCompositionId", p."chemicalCompositionId"),
               "updatedAt" = now()
        FROM master_products m
        WHERE p."masterProductId" = m.id
          AND m.sku = ANY(${chunk})
          AND p."deletedAt" IS NULL
          AND p.name IS DISTINCT FROM m.name
      `;
      renamed += Number(affected);
    }

    return { renamed, suspicious };
  }

  /**
   * Is `after` plausibly a corrected spelling of `before`, rather than a
   * different product? Used only to warn — the rename still goes through.
   */
  private looksLikeSameProduct(before: string, after: string): boolean {
    // Dosage forms, pack words and units appear in almost every product name,
    // so they carry no identity: "AB Flo SR Tablet" and "Irex Tablet" share
    // "tablet" and are entirely different drugs. Only brand words are compared.
    const NOISE = new Set([
      'tablet', 'tablets', 'tab', 'tabs', 'capsule', 'capsules', 'cap', 'caps',
      'transcaps', 'syrup', 'suspension', 'solution', 'injection', 'inj',
      'cream', 'ointment', 'gel', 'lotion', 'drops', 'drop', 'respule',
      'respules', 'sachet', 'powder', 'soap', 'shampoo', 'inhaler', 'rotacap',
      'lozenges', 'paste', 'vial', 'vials', 'pfs', 'kit', 'oral',
      'mg', 'ml', 'gm', 'gms', 'mcg', 'iu', 'sr', 'xr', 'cr', 'ds',
    ]);

    const brandTokens = (s: string) =>
      new Set(
        (s || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          // drop single characters, pure numbers, dose strings like "200mg"
          .filter(
            (t) =>
              t.length > 1 && !NOISE.has(t) && !/^\d+[a-z]*$/.test(t),
          ),
      );

    const a = brandTokens(before);
    const b = brandTokens(after);
    // Nothing identifying left on either side — report it rather than assume.
    if (a.size === 0 || b.size === 0) return false;

    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    return shared / Math.min(a.size, b.size) >= 0.5;
  }

  private async bulkUpdateMasterProducts(toUpdate: any[]): Promise<{ updatedCount: number; errors: string[] }> {
    let updatedCount = 0;
    const errors: string[] = [];
    const chunks = this.chunkArray(toUpdate, 500);

    for (const chunk of chunks) {
      try {
        const valuePlaceholders: string[] = [];
        const params: any[] = [];
        let paramIdx = 1;

        for (const p of chunk) {
          valuePlaceholders.push(
            `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9})`
          );
          params.push(
            p.sku,
            p.name,
            p.slug,
            p.description || null,
            p.categoryId,
            p.subCategoryId,
            p.companyId || null,
            p.chemicalCompositionId || null,
            p.manufacturer || null,
            p.chemicalComposition || null
          );
          paramIdx += 10;
        }

        const sql = `
          UPDATE "master_products" AS m
          SET
            "name" = v.name,
            "slug" = v.slug,
            "description" = v.description,
            "categoryId" = v.categoryId,
            "subCategoryId" = v.subCategoryId,
            "companyId" = v.companyId,
            "chemicalCompositionId" = v.chemicalCompositionId,
            "manufacturer" = v.manufacturer,
            "chemicalComposition" = v.chemicalComposition,
            "updatedAt" = NOW()
          FROM (VALUES ${valuePlaceholders.join(', ')}) AS v(
            sku, name, slug, description, categoryId, subCategoryId, companyId, chemicalCompositionId, manufacturer, chemicalComposition
          )
          WHERE m.sku = v.sku;
        `;

        const affected = await this.prisma.$executeRawUnsafe(sql, ...params);
        updatedCount += Number(affected);
      } catch (err: any) {
        this.logger.warn(`Bulk raw SQL update chunk failed, falling back to individual updates: ${err.message}`);
        for (const item of chunk) {
          try {
            await this.prisma.masterProduct.update({
              where: { sku: item.sku },
              data: item,
            });
            updatedCount++;
          } catch (e: any) {
            errors.push(`Failed to update SKU ${item.sku}: ${e.message}`);
          }
        }
      }
    }

    return { updatedCount, errors };
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

  private generateUniqueSlug(productName: string, sku: string): string {
    const baseSlug = this.slugify(productName);
    const skuSlug = this.slugify(sku);
    return baseSlug ? `${baseSlug}-${skuSlug}` : skuSlug;
  }

  async activateAll(): Promise<{ count: number }> {
    const result = await this.prisma.masterProduct.updateMany({
      where: { isActive: false, deletedAt: null },
      data: { isActive: true },
    });
    return { count: result.count };
  }
}

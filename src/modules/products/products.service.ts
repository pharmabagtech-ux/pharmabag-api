import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma, ProductApprovalStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { InventoryService } from './services/inventory.service';
import { SearchIndexService } from './services/search-index.service';
import { AnalyticsService } from './services/analytics.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { BulkCreateProductDto } from './dto/bulk-create-product.dto';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly searchIndexService: SearchIndexService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  // ──────────────────────────────────────────────
  // SELLER ENDPOINTS
  // ──────────────────────────────────────────────

  // ──────────────────────────────────────────────
  // NORMALIZATION HELPERS
  // ──────────────────────────────────────────────

  private normalizeString(value: string | undefined | null): string {
    return (value ?? '').trim();
  }

  private generateSlug(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private normalizeDto(dto: CreateProductDto): CreateProductDto {
    return {
      ...dto,
      name: this.normalizeString(dto.name),
      manufacturer: this.normalizeString(dto.manufacturer),
      chemicalComposition: this.normalizeString(dto.chemicalComposition),
      description: dto.description ? this.normalizeString(dto.description) : undefined,
      slug: dto.slug
        ? dto.slug.trim().toLowerCase()
        : this.generateSlug(dto.name),
      externalId: dto.externalId ? dto.externalId.trim() : undefined,
      masterProductId: dto.masterProductId ? dto.masterProductId.trim() : undefined,
    };
  }

  /**
   * Create a product with default batch, search index, and analytics.
   * Supports images, discount fields, externalId (idempotent upsert), and migration mode.
   */
  async create(userId: string, dto: CreateProductDto) {
    const normalized = this.normalizeDto(dto);

    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('Seller profile not found');
    }

    const [category, subCategory] = await Promise.all([
      this.prisma.category.findUnique({ where: { id: normalized.categoryId } }),
      this.prisma.subCategory.findUnique({ where: { id: normalized.subCategoryId } }),
    ]);
    if (!category) throw new NotFoundException('Category not found');
    if (!subCategory) throw new NotFoundException('Sub-category not found');

    // Idempotent upsert: if externalId is provided and exists, update instead
    if (normalized.externalId) {
      const existing = await this.prisma.product.findUnique({
        where: { externalId: normalized.externalId },
      });
      if (existing) {
        this.logger.log(`Upsert: product with externalId ${normalized.externalId} exists, updating`);
        return this.upsertExistingProduct(existing.id, seller.id, normalized, category, subCategory);
      }
    }

    // Also check slug uniqueness for upsert
    if (normalized.slug) {
      const existingBySlug = await this.prisma.product.findFirst({
        where: { slug: normalized.slug },
      });
      if (existingBySlug) {
        if (normalized.externalId || normalized.isMigration) {
          this.logger.log(`Upsert: product with slug ${normalized.slug} exists, updating`);
          return this.upsertExistingProduct(existingBySlug.id, seller.id, normalized, category, subCategory);
        }
        // Allow duplicate slugs for seller-specific listings
      }
    }

    let masterProductId = normalized.masterProductId;
    if (!masterProductId) {
      const master = await this.prisma.masterProduct.findFirst({
        where: {
          name: { equals: normalized.name, mode: 'insensitive' },
          manufacturer: { equals: normalized.manufacturer, mode: 'insensitive' },
          deletedAt: null,
        },
      });
      if (master) masterProductId = master.id;
    }

    const isFromMaster = !!masterProductId;
    
    const productData: Prisma.ProductCreateInput = {
      seller: { connect: { id: seller.id } },
      category: { connect: { id: normalized.categoryId } },
      subCategory: { connect: { id: normalized.subCategoryId } },
      masterProduct: isFromMaster ? { connect: { id: masterProductId } } : undefined,
      name: normalized.name,
      slug: normalized.slug,
      externalId: normalized.externalId,
      manufacturer: normalized.manufacturer,
      chemicalComposition: normalized.chemicalComposition,
      description: normalized.description,
      mrp: normalized.mrp,
      gstPercent: normalized.gstPercent,
      minimumOrderQuantity: normalized.minimumOrderQuantity ?? 1,
      maximumOrderQuantity: normalized.maximumOrderQuantity,
      discountType: normalized.discountType,
      discountMeta: normalized.discountMeta ?? undefined,
      approvalStatus: isFromMaster ? ProductApprovalStatus.APPROVED : ProductApprovalStatus.PENDING,
      isActive: isFromMaster ? true : false, // Auto-approve if from master catalog
    };

    const product = await this.prisma.product.create({
      data: productData,
      include: {
        category: true,
        subCategory: true,
        images: true,
      },
    });

    // Create images if provided
    if (normalized.images && normalized.images.length > 0) {
      await this.prisma.productImage.createMany({
        data: normalized.images.map((url) => ({
          productId: product.id,
          url: url.trim(),
        })),
      });
    }

    await this.inventoryService.createDefaultBatch(
      product.id,
      normalized.stock,
      normalized.expiryDate,
    );

    this.searchIndexService.upsert(product.id, {
      name: product.name,
      manufacturer: product.manufacturer,
      chemicalComposition: product.chemicalComposition,
      categoryName: category.name,
      subCategoryName: subCategory.name,
    });

    this.analyticsService.initialise(product.id);

    this.logger.log(
      `Product created: ${product.id} by seller ${seller.id}`,
    );

    const batch = await this.prisma.productBatch.findFirst({
      where: { productId: product.id, batchNumber: 'DEFAULT' },
    });

    const images = normalized.images?.length
      ? await this.prisma.productImage.findMany({ where: { productId: product.id } })
      : [];

    return {
      ...product,
      images,
      stock: batch?.stock ?? 0,
      expiryDate: batch?.expiryDate ?? null,
    };
  }

  /**
   * Upsert an existing product during migration/idempotent creation.
   */
  private async upsertExistingProduct(
    productId: string,
    sellerId: string,
    dto: CreateProductDto,
    category: { name: string },
    subCategory: { name: string },
  ) {
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        sellerId,
        categoryId: dto.categoryId,
        subCategoryId: dto.subCategoryId,
        name: dto.name,
        slug: dto.slug,
        manufacturer: dto.manufacturer,
        chemicalComposition: dto.chemicalComposition,
        description: dto.description,
        mrp: dto.mrp,
        gstPercent: dto.gstPercent,
        minimumOrderQuantity: dto.minimumOrderQuantity ?? 1,
        maximumOrderQuantity: dto.maximumOrderQuantity,
        discountType: dto.discountType,
        discountMeta: dto.discountMeta ?? undefined,
        isActive: true,
        deletedAt: null,
      },
      include: {
        category: true,
        subCategory: true,
      },
    });

    // Replace images
    if (dto.images && dto.images.length > 0) {
      await this.prisma.productImage.deleteMany({ where: { productId } });
      await this.prisma.productImage.createMany({
        data: dto.images.map((url) => ({ productId, url: url.trim() })),
      });
    }

    await this.inventoryService.updateDefaultBatch(productId, dto.stock, dto.expiryDate);

    this.searchIndexService.upsert(productId, {
      name: updated.name,
      manufacturer: updated.manufacturer,
      chemicalComposition: updated.chemicalComposition,
      categoryName: category.name,
      subCategoryName: subCategory.name,
    });

    const batch = await this.prisma.productBatch.findFirst({
      where: { productId, batchNumber: 'DEFAULT' },
    });

    const images = await this.prisma.productImage.findMany({ where: { productId } });

    this.logger.log(`Product upserted: ${productId}`);

    return {
      ...updated,
      images,
      stock: batch?.stock ?? 0,
      expiryDate: batch?.expiryDate ?? null,
    };
  }

  /**
   * Bulk create products for migration. Processes each product individually
   * within a single flow, returning success/failure counts.
   */
  async bulkCreate(userId: string, dto: BulkCreateProductDto) {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as { index: number; name: string; reason: string }[],
      created: [] as string[],
    };

    for (let i = 0; i < dto.products.length; i++) {
      try {
        const product = await this.create(userId, dto.products[i]);
        results.success++;
        results.created.push(product.id);
      } catch (error) {
        results.failed++;
        results.errors.push({
          index: i,
          name: dto.products[i]?.name ?? 'unknown',
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
        this.logger.warn(`Bulk create failed at index ${i}: ${error instanceof Error ? error.message : error}`);
      }
    }

    this.logger.log(
      `Bulk product creation: ${results.success} success, ${results.failed} failed out of ${dto.products.length}`,
    );
    return results;
  }

  /**
   * List products owned by the current seller.
   */
  async findOwn(userId: string, query: QueryProductDto) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });
    
    if (!seller) {
      this.logger.warn(`Seller profile not found for user ${userId} during findOwn`);
      return {
        products: [],
        meta: {
          total: 0,
          page: query.page || 1,
          limit: query.limit || 20,
          totalPages: 0,
        },
      };
    }

    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      sellerId: seller.id,
      deletedAt: null,
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { manufacturer: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if ((query as any).status) {
      where.approvalStatus = (query as any).status.toUpperCase();
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: true,
          subCategory: true,
          batches: true,
          images: true,
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      products: products.map((p) => this.flattenProduct(p)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update a product. Only the owning seller may update.
   * Supports images array (replaces existing) and discount fields.
   */
  async update(userId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.findOwnProduct(userId, productId);

    const { stock, expiryDate, images, ...productData } = dto;

    // Trim strings
    if (productData.name) productData.name = productData.name.trim();
    if (productData.manufacturer) productData.manufacturer = productData.manufacturer.trim();
    if (productData.chemicalComposition) productData.chemicalComposition = productData.chemicalComposition.trim();
    if (productData.description) productData.description = productData.description.trim();

    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: productData,
      include: {
        category: true,
        subCategory: true,
      },
    });

    // Replace images if provided
    if (images !== undefined) {
      await this.prisma.productImage.deleteMany({ where: { productId: product.id } });
      if (images.length > 0) {
        await this.prisma.productImage.createMany({
          data: images.map((url) => ({ productId: product.id, url: url.trim() })),
        });
      }
    }

    if (stock !== undefined || expiryDate !== undefined) {
      await this.inventoryService.updateDefaultBatch(
        product.id,
        stock,
        expiryDate,
      );
    }

    if (
      dto.name ||
      dto.manufacturer ||
      dto.chemicalComposition ||
      dto.categoryId ||
      dto.subCategoryId
    ) {
      this.searchIndexService.upsert(updated.id, {
        name: updated.name,
        manufacturer: updated.manufacturer,
        chemicalComposition: updated.chemicalComposition,
        categoryName: updated.category.name,
        subCategoryName: updated.subCategory.name,
      });
    }

    this.logger.log(`Product updated: ${updated.id}`);

    const [batch, productImages] = await Promise.all([
      this.prisma.productBatch.findFirst({
        where: { productId: updated.id, batchNumber: 'DEFAULT' },
      }),
      this.prisma.productImage.findMany({ where: { productId: updated.id } }),
    ]);

    return {
      ...updated,
      images: productImages,
      stock: batch?.stock ?? 0,
      expiryDate: batch?.expiryDate ?? null,
    };
  }

  /**
   * Soft-delete a product. Only the owning seller may delete.
   */
  async softDelete(userId: string, productId: string) {
    const product = await this.findOwnProduct(userId, productId);

    await this.prisma.product.update({
      where: { id: product.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    this.logger.log(`Product soft-deleted: ${product.id}`);
    return { message: 'Product deleted successfully' };
  }

  // ──────────────────────────────────────────────
  // PUBLIC ENDPOINTS (Browsing)
  // ──────────────────────────────────────────────

  /**
   * Browse all master products with filtering & pagination.
   * This is the "Marketplace" view where unique items are shown once.
   */
  async findAll(query: QueryProductDto) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MasterProductWhereInput = {
      isActive: true,
      deletedAt: null,
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { manufacturer: { contains: query.search, mode: 'insensitive' } },
        { chemicalComposition: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.subCategoryId) where.subCategoryId = query.subCategoryId;
    if (query.manufacturer) {
      where.manufacturer = { contains: query.manufacturer, mode: 'insensitive' };
    }

    const [masters, total] = await Promise.all([
      this.prisma.masterProduct.findMany({
        where,
        include: {
          category: true,
          subCategory: true,
          images: { take: 1 },
          products: {
            where: { isActive: true, deletedAt: null },
            select: { mrp: true, discountType: true, discountMeta: true },
            orderBy: { mrp: 'asc' },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.masterProduct.count({ where }),
    ]);

    return {
      products: masters.map((m) => this.mapMasterToGrid(m)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single Master Product with all its seller listings.
   * This provides the data for the "Compare Sellers" view.
   */
  async findOne(id: string) {
    // Try to find by Master ID or Slug first
    let master = await this.prisma.masterProduct.findFirst({
      where: { 
        OR: [{ id }, { slug: id }],
        deletedAt: null 
      },
      include: {
        category: true,
        subCategory: true,
        images: true,
        products: {
            where: { isActive: true, deletedAt: null },
            include: {
                seller: { select: { id: true, companyName: true, rating: true, city: true, state: true } },
                batches: { where: { stock: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
                images: true,
            },
            orderBy: [{ mrp: 'asc' }],
        }
      },
    });

    // Fallback: If 'id' is a specific Seller Product ID, find its Master
    if (!master) {
        const listing = await this.prisma.product.findUnique({
            where: { id },
            select: { masterProductId: true }
        });
        if (listing?.masterProductId) {
            return this.findOne(listing.masterProductId);
        }
        throw new NotFoundException('Product not found');
    }

    // Fire-and-forget: record analytics view for the master item
    this.analyticsService.recordView(master.id);

    return this.formatMasterDetail(master);
  }

  private mapMasterToGrid(m: any) {
    const listings = m.products || [];
    const minPrice = listings.length > 0 ? listings[0].mrp : m.mrp;
    const hasSellers = listings.length > 0;

    return {
      id: m.id,
      name: m.name,
      slug: m.slug,
      manufacturer: m.manufacturer,
      chemicalComposition: m.chemicalComposition,
      mrp: m.mrp,
      price: minPrice,
      hasSellers,
      sellerCount: listings.length,
      image: m.images?.[0]?.url || null,
      category: m.category,
      subCategory: m.subCategory,
      createdAt: m.createdAt,
    };
  }

  private formatMasterDetail(m: any) {
    return {
      id: m.id,
      name: m.name,
      slug: m.slug,
      manufacturer: m.manufacturer,
      chemicalComposition: m.chemicalComposition,
      description: m.description,
      mrp: m.mrp,
      gstPercent: m.gstPercent,
      images: m.images,
      category: m.category,
      subCategory: m.subCategory,
      therapeuticClass: m.therapeuticClass,
      sideEffects: m.sideEffects,
      directionsForUse: m.directionsForUse,
      safetyAdvice: m.safetyAdvice,
      packSize: m.packSize,
      storageAndHandling: m.storageAndHandling,
      // Group seller listings
      listings: (m.products || []).map((p: any) => {
          const batches = p.batches || [];
          const stock = batches.reduce((sum: number, b: any) => sum + b.stock, 0);
          return {
              id: p.id,
              price: p.mrp,
              discountType: p.discountType,
              discountMeta: p.discountMeta,
              stock,
              expiryDate: batches.length > 0 ? batches[0].expiryDate : null,
              seller: p.seller,
              images: p.images?.length > 0 ? p.images : m.images // Fallback to master images
          };
      })
    };
  }

  /**
   * Get product name suggestions for autocomplete.
   * Supports 'product' (default) for available listings and 'master' for catalog items.
   */
  async getSuggestions(query: string, type: 'product' | 'master' = 'product') {
    if (!query || query.trim().length < 2) {
      return [];
    }

    const q = query.trim();
    const words = q.split(/\s+/).filter((w) => w.length > 0);

    const buildFilter = (words: string[]) => {
      return {
        AND: words.map((w) => ({
          OR: [
            { name: { contains: w, mode: 'insensitive' as Prisma.QueryMode } },
            { manufacturer: { contains: w, mode: 'insensitive' as Prisma.QueryMode } },
            { chemicalComposition: { contains: w, mode: 'insensitive' as Prisma.QueryMode } },
          ],
        })),
      };
    };

    if (type === 'master') {
      const suggestions = await this.prisma.masterProduct.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          ...buildFilter(words),
        },
        select: {
          id: true,
          name: true,
          manufacturer: true,
          slug: true,
          chemicalComposition: true,
          mrp: true,
          gstPercent: true,
          categoryId: true,
          subCategoryId: true,
          images: { select: { url: true }, take: 1 },
        },
        take: 10,
        orderBy: { name: 'asc' },
      });

      return suggestions.map((s) => ({
        id: s.id,
        productName: s.name,
        companyName: s.manufacturer,
        chemicalCombination: s.chemicalComposition,
        slug: s.slug,
        mrp: s.mrp,
        gstPercent: s.gstPercent,
        categoryId: s.categoryId,
        subCategoryId: s.subCategoryId,
        imageUrl: s.images?.[0]?.url || null,
      }));
    }

    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        approvalStatus: ProductApprovalStatus.APPROVED,
        deletedAt: null,
        ...buildFilter(words),
      },
      select: {
        id: true,
        name: true,
        manufacturer: true,
        slug: true,
        mrp: true,
      },
      take: 10,
      orderBy: { name: 'asc' },
    });

    return products.map((p) => ({
      id: p.id,
      productName: p.name,
      companyName: p.manufacturer,
      slug: p.slug,
      mrp: p.mrp,
    }));
  }

  /**
   * List all categories (public).
   */
  async getCategories() {
    return this.prisma.category.findMany({
      include: { subCategories: true },
      orderBy: { name: 'asc' },
    });
  }

  async getFeatured(slot: any) {
    const featured = await this.prisma.marketingProduct.findMany({
      where: { slot, active: true },
      include: {
        product: {
          include: {
            category: true,
            subCategory: true,
            batches: { where: { stock: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
            seller: { select: { companyName: true, city: true, state: true, rating: true } },
            images: true,
          },
        },
      },
      orderBy: { priority: 'desc' },
      take: 12, // limit to 12 featured products per slot
    });

    return featured.map((f) => this.flattenProduct(f.product));
  }

  // ──────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────

  /**
   * Find a product owned by the current seller, or throw.
   */
  private async findOwnProduct(userId: string, productId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('Seller profile not found');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, sellerId: seller.id, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException(
        'Product not found or you do not have permission',
      );
    }

    return product;
  }

  /**
   * Flatten batches into top-level stock/expiryDate for Phase-1 compatibility.
   */
  private flattenProduct(product: Record<string, unknown>) {
    const batches = (product.batches ?? []) as Array<{
      stock: number;
      expiryDate: Date;
    }>;

    const totalStock = batches.reduce((sum, b) => sum + b.stock, 0);
    const nearestExpiry = batches.length > 0 ? batches[0].expiryDate : null;

    const { batches: _batches, ...rest } = product;
    return {
      ...rest,
      stock: totalStock,
      expiryDate: nearestExpiry,
    };
  }
}

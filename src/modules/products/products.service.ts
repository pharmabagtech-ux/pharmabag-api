import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { InventoryService } from './services/inventory.service';
import { SearchIndexService } from './services/search-index.service';
import { AnalyticsService } from './services/analytics.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';

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

  /**
   * Create a product with default batch, search index, and analytics.
   * sellerId is the SellerProfile.id (NOT User.id).
   */
  async create(userId: string, dto: CreateProductDto) {
    // Resolve sellerId from userId
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('Seller profile not found');
    }

    // Validate category & sub-category exist
    const [category, subCategory] = await Promise.all([
      this.prisma.category.findUnique({ where: { id: dto.categoryId } }),
      this.prisma.subCategory.findUnique({ where: { id: dto.subCategoryId } }),
    ]);
    if (!category) throw new NotFoundException('Category not found');
    if (!subCategory) throw new NotFoundException('Sub-category not found');

    // Create product in a transaction
    const product = await this.prisma.product.create({
      data: {
        sellerId: seller.id,
        categoryId: dto.categoryId,
        subCategoryId: dto.subCategoryId,
        name: dto.name,
        manufacturer: dto.manufacturer,
        chemicalComposition: dto.chemicalComposition,
        description: dto.description,
        mrp: dto.mrp,
        gstPercent: dto.gstPercent,
        minimumOrderQuantity: dto.minimumOrderQuantity ?? 1,
        maximumOrderQuantity: dto.maximumOrderQuantity,
      },
      include: {
        category: true,
        subCategory: true,
      },
    });

    // Phase-2+ hidden infrastructure — fire-and-forget
    await this.inventoryService.createDefaultBatch(
      product.id,
      dto.stock,
      dto.expiryDate,
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

    // Return product with batch info for Phase-1 compatibility
    const batch = await this.prisma.productBatch.findFirst({
      where: { productId: product.id, batchNumber: 'DEFAULT' },
    });

    return {
      ...product,
      stock: batch?.stock ?? 0,
      expiryDate: batch?.expiryDate ?? null,
    };
  }

  /**
   * List products owned by the current seller.
   */
  async findOwn(userId: string, query: QueryProductDto) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('Seller profile not found');
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

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: true,
          subCategory: true,
          batches: true,
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
   */
  async update(userId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.findOwnProduct(userId, productId);

    // Separate batch fields from product fields
    const { stock, expiryDate, ...productData } = dto;

    // Update product
    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: productData,
      include: {
        category: true,
        subCategory: true,
      },
    });

    // Update default batch if stock/expiryDate changed
    if (stock !== undefined || expiryDate !== undefined) {
      await this.inventoryService.updateDefaultBatch(
        product.id,
        stock,
        expiryDate,
      );
    }

    // Rebuild search index if relevant fields changed
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

    const batch = await this.prisma.productBatch.findFirst({
      where: { productId: updated.id, batchNumber: 'DEFAULT' },
    });

    return {
      ...updated,
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
   * Browse all active products with filtering & pagination.
   */
  async findAll(query: QueryProductDto) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
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

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: true,
          subCategory: true,
          batches: { where: { stock: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
          seller: { select: { companyName: true, city: true, state: true, rating: true } },
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
   * Get a single product by ID. Records analytics view.
   */
  async findOne(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: {
        category: true,
        subCategory: true,
        batches: { where: { stock: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
        seller: { select: { companyName: true, city: true, state: true, rating: true } },
        images: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Fire-and-forget: record analytics view
    this.analyticsService.recordView(product.id);

    return this.flattenProduct(product);
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

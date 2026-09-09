import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateSubCategoryDto } from './dto/create-subcategory.dto';
import { UpdateSubCategoryDto } from './dto/update-subcategory.dto';
import { BulkCreateCategoryDto } from './dto/bulk-category.dto';
import { BulkCreateSubCategoryDto } from './dto/bulk-category.dto';
import { QuerySubCategoryDto } from './dto/query-subcategory.dto';
import { RedirectsService } from '../redirects/redirects.service';
import { PageSeoService } from '../page-seo/page-seo.service';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redirects: RedirectsService,
    private readonly pageSeo: PageSeoService,
  ) {}

  /**
   * Keeps a renamed page's old URL alive.
   *
   * Renaming rewrites the slug, so /categories/<old-slug> — a URL that ranks
   * and that Google has indexed — starts 404ing. Tolerant BY CONTRACT, in the
   * same spirit as the bulk uploader's rename hook: SEO housekeeping must
   * never cost the operator the rename they asked for.
   */
  private async redirectRenamedPaths(
    pairs: { from: string; to: string }[],
  ): Promise<void> {
    for (const { from, to } of pairs) {
      if (from === to) continue;
      /*
        The page's admin-written content has to follow it. `page_seo` rows are
        keyed by path, so a rename would otherwise strand the copy at a path
        nothing renders and the page would quietly revert to generated
        wording. Tolerant like the redirect below it — housekeeping must never
        cost the operator the rename they asked for.
      */
      try {
        await this.pageSeo.movePath(from, to);
      } catch (error) {
        this.logger.warn(
          `Could not move page content ${from} → ${to}: ${String(error)}`,
        );
      }
      try {
        // MANUAL rather than a new RedirectSource value: adding one means an
        // enum migration, and Postgres cannot ALTER TYPE ... ADD VALUE inside
        // the transaction Prisma wraps migrations in.
        await this.redirects.create({ from, to, source: 'MANUAL' });
      } catch (error) {
        this.logger.warn(
          `Could not create rename redirect ${from} → ${to}: ${String(error)}`,
        );
      }
    }
  }

  // ──────────────────────────────────────────────
  // CATEGORIES
  // ──────────────────────────────────────────────

  private generateSlug(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  async createCategory(dto: CreateCategoryDto) {
    const name = dto.name.trim();
    const slug = this.generateSlug(name);

    try {
      const category = await this.prisma.category.create({
        data: { name, slug },
      });
      this.logger.log(`Category created: ${category.id} - ${name}`);
      return category;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`Category "${name}" already exists`);
      }
      throw error;
    }
  }

  async findAllCategories() {
    return this.prisma.category.findMany({
      include: { subCategories: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name) {
      data.name = dto.name.trim();
      data.slug = this.generateSlug(dto.name);
    }

    try {
      const updated = await this.prisma.category.update({
        where: { id },
        data,
      });

      // A category slug is also the first segment of every sub-category URL
      // beneath it, so one rename orphans the whole family unless each child
      // gets its own redirect too.
      if (updated.slug !== existing.slug) {
        const children = await this.prisma.subCategory.findMany({
          where: { categoryId: id },
          select: { slug: true },
        });
        await this.redirectRenamedPaths([
          {
            from: `/categories/${existing.slug}`,
            to: `/categories/${updated.slug}`,
          },
          ...children.map((child) => ({
            from: `/categories/${existing.slug}/${child.slug}`,
            to: `/categories/${updated.slug}/${child.slug}`,
          })),
        ]);
      }

      this.logger.log(`Category updated: ${id}`);
      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`Category "${dto.name}" already exists`);
      }
      throw error;
    }
  }

  async deleteCategory(id: string) {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { masterProducts: true, products: true, subCategories: true },
        },
      },
    });
    if (!existing) throw new NotFoundException('Category not found');

    // These counts were already being fetched and then ignored. Deleting
    // anyway is unsafe in two different ways: `MasterProduct.category` has no
    // cascade, so Postgres restricts and the operator gets a raw foreign-key
    // error; `SubCategory.category` IS onDelete: Cascade, so an otherwise
    // empty category silently takes its sub-categories with it.
    // Counted separately, not summed: a seller listing points AT a catalogue
    // product, so adding the two would double-count the same shelf item and
    // hand the operator a number that matches nothing they can see.
    const { masterProducts, products, subCategories } = existing._count;
    const blockers: string[] = [];
    if (masterProducts > 0) {
      blockers.push(`${masterProducts} catalogue product${masterProducts === 1 ? '' : 's'}`);
    }
    if (products > 0) {
      blockers.push(`${products} seller listing${products === 1 ? '' : 's'}`);
    }
    if (subCategories > 0) {
      blockers.push(`${subCategories} sub-categor${subCategories === 1 ? 'y' : 'ies'}`);
    }
    if (blockers.length > 0) {
      throw new ConflictException(
        `Cannot delete "${existing.name}" — ${blockers.join(' and ')} still use it. Move or remove them first.`,
      );
    }

    await this.prisma.category.delete({ where: { id } });
    this.logger.log(`Category deleted: ${id}`);
    return { message: 'Category deleted successfully' };
  }

  async getCategoryMap() {
    const categories = await this.prisma.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const map: Record<string, string> = {};
    for (const cat of categories) {
      map[cat.name] = cat.id;
    }
    return map;
  }

  async bulkCreateCategories(dto: BulkCreateCategoryDto) {
    const results = { success: 0, failed: 0, errors: [] as { name: string; reason: string }[] };

    for (const item of dto.categories) {
      try {
        await this.createCategory(item);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          name: item.name,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(`Bulk category creation: ${results.success} success, ${results.failed} failed`);
    return results;
  }

  // ──────────────────────────────────────────────
  // SUBCATEGORIES
  // ──────────────────────────────────────────────

  async createSubCategory(dto: CreateSubCategoryDto) {
    const name = dto.name.trim();
    const slug = this.generateSlug(name);

    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new NotFoundException('Category not found');

    try {
      const subCategory = await this.prisma.subCategory.create({
        data: {
          name,
          slug,
          categoryId: dto.categoryId,
        },
        include: { category: true },
      });
      this.logger.log(`SubCategory created: ${subCategory.id} - ${name}`);
      return subCategory;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `SubCategory "${name}" already exists under this category`,
        );
      }
      throw error;
    }
  }

  async findAllSubCategories(query: QuerySubCategoryDto) {
    const where: Prisma.SubCategoryWhereInput = {};
    if (query.categoryId) where.categoryId = query.categoryId;

    return this.prisma.subCategory.findMany({
      where,
      include: { category: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateSubCategory(id: string, dto: UpdateSubCategoryDto) {
    const existing = await this.prisma.subCategory.findUnique({
      where: { id },
      include: { category: { select: { slug: true } } },
    });
    if (!existing) throw new NotFoundException('SubCategory not found');

    const data: Prisma.SubCategoryUpdateInput = {};
    if (dto.name) {
      data.name = dto.name.trim();
      data.slug = this.generateSlug(dto.name);
    }

    try {
      const updated = await this.prisma.subCategory.update({
        where: { id },
        data,
        include: { category: true },
      });

      // Sub-category pages live under their parent's slug, which the rename
      // does not touch — only the last segment moves.
      if (updated.slug !== existing.slug) {
        const parentSlug = updated.category?.slug ?? existing.category?.slug;
        if (parentSlug) {
          await this.redirectRenamedPaths([
            {
              from: `/categories/${parentSlug}/${existing.slug}`,
              to: `/categories/${parentSlug}/${updated.slug}`,
            },
          ]);
        }
      }

      this.logger.log(`SubCategory updated: ${id}`);
      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `SubCategory "${dto.name}" already exists under this category`,
        );
      }
      throw error;
    }
  }

  async deleteSubCategory(id: string) {
    const existing = await this.prisma.subCategory.findUnique({
      where: { id },
      include: { _count: { select: { masterProducts: true, products: true } } },
    });
    if (!existing) throw new NotFoundException('SubCategory not found');

    // Same ignored-count bug as deleteCategory. `masterProducts` matters most
    // — the seller-listing count alone misses the 26,000-row catalogue.
    const { masterProducts, products } = existing._count;
    const blockers: string[] = [];
    if (masterProducts > 0) {
      blockers.push(`${masterProducts} catalogue product${masterProducts === 1 ? '' : 's'}`);
    }
    if (products > 0) {
      blockers.push(`${products} seller listing${products === 1 ? '' : 's'}`);
    }
    if (blockers.length > 0) {
      throw new ConflictException(
        `Cannot delete "${existing.name}" — ${blockers.join(' and ')} still use it. Move or remove them first.`,
      );
    }

    await this.prisma.subCategory.delete({ where: { id } });
    this.logger.log(`SubCategory deleted: ${id}`);
    return { message: 'SubCategory deleted successfully' };
  }

  async getSubCategoryMap() {
    const subCategories = await this.prisma.subCategory.findMany({
      select: { id: true, name: true, categoryId: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const map: Record<string, string> = {};
    for (const sub of subCategories) {
      // Key format: "CategoryName::SubCategoryName" for disambiguation
      map[`${sub.category.name}::${sub.name}`] = sub.id;
    }
    return map;
  }

  async bulkCreateSubCategories(dto: BulkCreateSubCategoryDto) {
    const results = { success: 0, failed: 0, errors: [] as { name: string; categoryId: string; reason: string }[] };

    for (const item of dto.subcategories) {
      try {
        await this.createSubCategory(item);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          name: item.name,
          categoryId: item.categoryId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(`Bulk subcategory creation: ${results.success} success, ${results.failed} failed`);
    return results;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpsertPageSeoDto } from './dto/page-seo.dto';

/**
 * Per-page SEO overrides.
 *
 * The storefront reads the WHOLE set in one request and caches it, rather than
 * querying per page render. There will realistically be tens to hundreds of
 * rows — only pages someone has deliberately tuned — so shipping the map is
 * far cheaper than one round trip per page, and it keeps the render path from
 * depending on a database call that could be slow or throttled.
 */
@Injectable()
export class PageSeoService {
  private readonly logger = new Logger(PageSeoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalises a path the way the storefront canonicalises one: leading slash,
   * no trailing slash, lowercase, no query or hash. Without this, `/Categories/
   * Ayurvedic/` and `/categories/ayurvedic` would be two different rows for the
   * same page and the override would appear not to work.
   */
  static normalizePath(input: string): string {
    let p = (input || '').trim();
    if (!p) return '/';
    p = p.split('#')[0].split('?')[0];
    if (!p.startsWith('/')) p = `/${p}`;
    p = p.toLowerCase();
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
  }

  /** Everything, as a path -> override map. Consumed by the storefront. */
  async getMap() {
    const rows = await this.prisma.pageSeo.findMany({
      orderBy: { path: 'asc' },
      take: 5000,
    });
    const map: Record<string, unknown> = {};
    for (const r of rows) {
      const { id, createdAt, updatedAt, updatedBy, ...rest } = r;
      map[r.path] = rest;
    }
    return map;
  }

  /** Admin listing, with optional type filter and a "missing X" filter. */
  async list(params: {
    entityType?: string;
    search?: string;
    missing?: 'title' | 'description' | 'aiSummary';
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 50));

    const where: Prisma.PageSeoWhereInput = {
      ...(params.entityType ? { entityType: params.entityType } : {}),
      ...(params.search
        ? {
            OR: [
              { path: { contains: params.search, mode: 'insensitive' } },
              { title: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      // "Missing" means null OR empty — a row saved with a blank field has no
      // override, and listing it as covered would be a lie.
      ...(params.missing
        ? { OR: [{ [params.missing]: null }, { [params.missing]: '' }] }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.pageSeo.count({ where }),
      this.prisma.pageSeo.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getOne(path: string) {
    return this.prisma.pageSeo.findUnique({
      where: { path: PageSeoService.normalizePath(path) },
    });
  }

  /**
   * Create or update the override for a path.
   *
   * Empty string clears a field back to null so the storefront resumes using
   * its generated value; `undefined` leaves the stored value alone.
   */
  async upsert(path: string, dto: UpsertPageSeoDto, updatedBy?: string) {
    const normalized = PageSeoService.normalizePath(path);

    const text = (v: string | undefined) =>
      v === undefined ? undefined : v.trim() || null;

    const json = (v: unknown) =>
      v === undefined
        ? undefined
        : v === null ||
            (Array.isArray(v) && v.length === 0) ||
            (typeof v === 'object' && v !== null && Object.keys(v).length === 0)
          ? Prisma.DbNull
          : (v as Prisma.InputJsonValue);

    const data = {
      entityType: text(dto.entityType),
      entityId: text(dto.entityId),
      title: text(dto.title),
      description: text(dto.description),
      canonicalUrl: text(dto.canonicalUrl),
      robots: text(dto.robots),
      ogTitle: text(dto.ogTitle),
      ogDescription: text(dto.ogDescription),
      ogImage: text(dto.ogImage),
      twitterCard: text(dto.twitterCard),
      focusKeyword: text(dto.focusKeyword),
      entityDescription: text(dto.entityDescription),
      aiSummary: text(dto.aiSummary),
      ...(dto.secondaryKeywords !== undefined
        ? { secondaryKeywords: dto.secondaryKeywords.filter((k) => k.trim()) }
        : {}),
      ...(dto.faq !== undefined ? { faq: json(dto.faq) } : {}),
      ...(dto.structuredData !== undefined
        ? { structuredData: json(dto.structuredData) }
        : {}),
      ...(dto.imageAlts !== undefined ? { imageAlts: json(dto.imageAlts) } : {}),
      updatedBy: updatedBy ?? null,
    };

    return this.prisma.pageSeo.upsert({
      where: { path: normalized },
      create: { path: normalized, ...data },
      update: data,
    });
  }

  /** Removing the row restores the storefront's generated head entirely. */
  async remove(path: string) {
    const normalized = PageSeoService.normalizePath(path);
    await this.prisma.pageSeo.deleteMany({ where: { path: normalized } });
    return { path: normalized, deleted: true };
  }
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { normalizePath, isNoisePath } from './redirect-path.util';

/** Response cap; the map is fetched whole by the storefront middleware. */
const MAP_LIMIT = 5000;
const MAP_WARN_AT = 4000;
const REFERRER_MAX = 300;

export interface RedirectMapEntry {
  from: string;
  to: string;
  status: number;
}

@Injectable()
export class RedirectsService {
  private readonly logger = new Logger(RedirectsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The whole redirect table in the shape the storefront middleware consumes. */
  async getMap(): Promise<RedirectMapEntry[]> {
    const [rows, total] = await Promise.all([
      this.prisma.urlRedirect.findMany({
        select: { fromPath: true, toPath: true, statusCode: true },
        orderBy: { createdAt: 'desc' },
        take: MAP_LIMIT,
      }),
      this.prisma.urlRedirect.count(),
    ]);
    if (total >= MAP_WARN_AT) {
      this.logger.warn(
        `Redirect table holds ${total} rows — the ${MAP_LIMIT}-row map cap is approaching; prune stale redirects.`,
      );
    }
    return rows.map((r) => ({ from: r.fromPath, to: r.toPath, status: r.statusCode }));
  }

  /** Record a storefront 404. Silent about everything it chooses to ignore. */
  async track404(input: { path: string; referrer?: string }): Promise<void> {
    const path = normalizePath(input.path);
    if (!path || isNoisePath(path)) return;

    // A path a redirect already covers can only 404 through a stale map —
    // logging it would just re-open work an admin already did.
    const covered = await this.prisma.urlRedirect.findUnique({
      where: { fromPath: path },
      select: { id: true },
    });
    if (covered) return;

    const lastReferrer = input.referrer?.slice(0, REFERRER_MAX) || null;
    await this.prisma.notFoundHit.upsert({
      where: { path },
      create: { path, hits: 1, lastReferrer },
      update: { hits: { increment: 1 }, lastSeenAt: new Date(), lastReferrer },
    });
  }

  /** Fire-and-forget hit counter ping from the middleware. */
  async recordHit(from: string): Promise<void> {
    const path = normalizePath(from);
    if (!path) return;
    await this.prisma.urlRedirect.updateMany({
      where: { fromPath: path },
      data: { hits: { increment: 1 }, lastHitAt: new Date() },
    });
  }

  /**
   * Create/replace a redirect. Both directions of chaining are flattened at
   * write time because the middleware map is exact-match — a chain would cost
   * an extra round-trip per hop (or strand the visitor if a hop is deleted):
   *  - forward: new A→B where B→C is stored as A→C
   *  - backward: existing X→A rows are repointed to the new target
   */
  async create(input: {
    from: string;
    to: string;
    source?: 'MANUAL' | 'PRODUCT_RENAME';
  }) {
    const fromPath = normalizePath(input.from);
    if (!fromPath) {
      throw new BadRequestException('from must be a site-relative path (not the homepage)');
    }

    const external = /^https?:\/\//i.test(input.to.trim());
    let toPath = external ? input.to.trim() : normalizePath(input.to) ?? '';
    if (!toPath) {
      throw new BadRequestException('to must be a path or an absolute http(s) URL');
    }
    if (!external && toPath === fromPath) {
      throw new BadRequestException('a redirect cannot point at itself');
    }

    // Forward collapse.
    if (!external) {
      const next = await this.prisma.urlRedirect.findUnique({
        where: { fromPath: toPath },
        select: { toPath: true },
      });
      if (next) toPath = next.toPath;
      if (toPath === fromPath) {
        throw new BadRequestException('this redirect would create a loop');
      }
    }

    const row = await this.prisma.urlRedirect.upsert({
      where: { fromPath },
      create: { fromPath, toPath, source: input.source ?? 'MANUAL' },
      update: { toPath, source: input.source ?? 'MANUAL' },
    });

    // Backward repoint: anything that used to land on `fromPath` now goes
    // straight to the final target.
    await this.prisma.urlRedirect.updateMany({
      where: { toPath: fromPath },
      data: { toPath },
    });

    // The dead link is dead no more.
    await this.prisma.notFoundHit.updateMany({
      where: { path: fromPath },
      data: { resolved: true },
    });

    return row;
  }

  /**
   * Batch redirects for bulk product renames. Tolerant BY CONTRACT: a bulk
   * upload must never fail because a redirect could not be written — the
   * upload is the client's data pipeline, redirects are an SEO enhancement.
   */
  async createFromRename(
    pairs: { oldSlug: string; newSlug: string }[],
  ): Promise<number> {
    let created = 0;
    for (const { oldSlug, newSlug } of pairs) {
      if (!oldSlug || !newSlug || oldSlug === newSlug) continue;
      try {
        await this.create({
          from: `/products/${oldSlug}`,
          to: `/products/${newSlug}`,
          source: 'PRODUCT_RENAME',
        });
        created++;
      } catch (error) {
        this.logger.warn(
          `Could not create rename redirect /products/${oldSlug} → /products/${newSlug}: ${String(error)}`,
        );
      }
    }
    return created;
  }

  async list() {
    return this.prisma.urlRedirect.findMany({ orderBy: [{ hits: 'desc' }, { createdAt: 'desc' }] });
  }

  async update(id: string, input: { to: string }) {
    const external = /^https?:\/\//i.test(input.to.trim());
    const toPath = external ? input.to.trim() : normalizePath(input.to);
    if (!toPath) throw new BadRequestException('to must be a path or an absolute http(s) URL');
    return this.prisma.urlRedirect.update({ where: { id }, data: { toPath } });
  }

  async remove(id: string) {
    return this.prisma.urlRedirect.delete({ where: { id } });
  }

  async list404s(unresolvedOnly: boolean) {
    return this.prisma.notFoundHit.findMany({
      where: unresolvedOnly ? { resolved: false } : undefined,
      orderBy: [{ hits: 'desc' }, { lastSeenAt: 'desc' }],
      take: 500,
    });
  }

  async dismiss404(id: string) {
    return this.prisma.notFoundHit.delete({ where: { id } });
  }
}

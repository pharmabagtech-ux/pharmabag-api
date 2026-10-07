import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { normalisePlacements, NormalisedPlacement } from './placements.util';
import {
  BANNER_SETTINGS_ROW_ID,
  clampRotationSeconds,
  DEFAULT_ROTATION_SECONDS,
} from './rotation.util';

export interface PublicBannerQuery {
  scope: 'homepage' | 'category';
  categorySlug?: string;
}

/**
 * What the storefront renders. Deliberately narrower than the admin shape:
 * `title` is an internal label and `position` is bookkeeping, and neither has
 * any business being served to a logged-out visitor.
 */
const PUBLIC_SELECT = {
  id: true,
  imageUrl: true,
  mobileImageUrl: true,
  altText: true,
  linkUrl: true,
} satisfies Prisma.PromoBannerSelect;

@Injectable()
export class BannersService {
  constructor(private readonly prisma: PrismaService) {}

  async findPublic(query: PublicBannerQuery) {
    const some =
      query.scope === 'homepage'
        ? { scope: 'HOMEPAGE' as const }
        : this.categoryFilter(query.categorySlug);

    const [banners, rotationSeconds] = await Promise.all([
      this.prisma.promoBanner.findMany({
        where: { active: true, placements: { some } },
        select: PUBLIC_SELECT,
        // createdAt breaks ties so two banners sharing a position do not swap
        // order between requests, which would look like a flickering bug.
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.getRotationSeconds(),
    ]);

    return { banners, rotationSeconds };
  }

  /**
   * A category page shows the banners aimed at every category PLUS the ones
   * aimed at this one. Prisma's `some` with an OR returns each banner once, so
   * a banner holding both placements does not appear twice in the slideshow.
   */
  private categoryFilter(categorySlug?: string) {
    const slug = categorySlug?.trim().toLowerCase();
    if (!slug) {
      throw new BadRequestException(
        'categorySlug is required when scope is "category"',
      );
    }
    return {
      OR: [
        { scope: 'ALL_CATEGORIES' as const },
        { scope: 'CATEGORY' as const, category: { slug } },
      ],
    };
  }

  async getRotationSeconds(): Promise<number> {
    const row = await this.prisma.siteSetting.findUnique({
      where: { id: BANNER_SETTINGS_ROW_ID },
    });
    const data = (row?.data as Record<string, unknown> | undefined) ?? {};
    return clampRotationSeconds(data.rotationSeconds ?? DEFAULT_ROTATION_SECONDS);
  }

  async setRotationSeconds(seconds: number): Promise<number> {
    const value = clampRotationSeconds(seconds);
    await this.prisma.siteSetting.upsert({
      where: { id: BANNER_SETTINGS_ROW_ID },
      create: { id: BANNER_SETTINGS_ROW_ID, data: { rotationSeconds: value } },
      update: { data: { rotationSeconds: value } },
    });
    return value;
  }

  /** Admin list: everything, inactive included, placements expanded. */
  async findAllForAdmin() {
    return this.prisma.promoBanner.findMany({
      include: {
        placements: {
          include: { category: { select: { id: true, name: true, slug: true } } },
        },
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(dto: CreateBannerDto) {
    const placements = normalisePlacements(dto.placements ?? []);
    await this.assertCategoriesExist(placements);

    // New banners go to the END of the list. Prepending would silently demote
    // whatever the admin had deliberately put first every time they added one.
    const last = await this.prisma.promoBanner.findFirst({
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.promoBanner.create({
      data: {
        title: dto.title,
        imageUrl: dto.imageUrl,
        mobileImageUrl: dto.mobileImageUrl ?? null,
        altText: dto.altText,
        linkUrl: dto.linkUrl ?? null,
        active: dto.active ?? true,
        position: (last?.position ?? -1) + 1,
        placements: { create: placements },
      },
      include: { placements: true },
    });
  }

  async update(id: string, dto: UpdateBannerDto) {
    await this.assertExists(id);

    const placements =
      dto.placements === undefined ? null : normalisePlacements(dto.placements);
    if (placements) await this.assertCategoriesExist(placements);

    return this.prisma.$transaction(async (tx) => {
      // `position` is absent from the DTO on purpose: order is owned by the
      // reorder endpoint. Accepting it here would let two concurrent saves
      // fight over the same slot.
      await tx.promoBanner.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
          ...(dto.mobileImageUrl !== undefined && {
            mobileImageUrl: dto.mobileImageUrl || null,
          }),
          ...(dto.altText !== undefined && { altText: dto.altText }),
          ...(dto.linkUrl !== undefined && { linkUrl: dto.linkUrl || null }),
          ...(dto.active !== undefined && { active: dto.active }),
        },
      });

      // Replace rather than merge: the admin form always sends the complete
      // placement set, so an absent one means "untick", not "leave alone".
      if (placements) {
        await tx.promoBannerPlacement.deleteMany({ where: { bannerId: id } });
        if (placements.length) {
          await tx.promoBannerPlacement.createMany({
            data: placements.map((p) => ({ ...p, bannerId: id })),
          });
        }
      }

      return tx.promoBanner.findUnique({
        where: { id },
        include: { placements: true },
      });
    });
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.promoBanner.delete({ where: { id } });
    return { id };
  }

  /**
   * Rewrites every position from the supplied order.
   *
   * The COMPLETE list is required rather than a delta or a single moved id.
   * Two admins dragging at the same time with deltas produce interleaved
   * positions matching neither intent; rewriting wholesale means the last
   * writer simply wins, which is at least coherent.
   */
  async reorder(ids: string[]) {
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('The id list contains duplicates');
    }

    const found = await this.prisma.promoBanner.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new BadRequestException('The id list contains an unknown banner');
    }

    const total = await this.prisma.promoBanner.count();
    if (total !== ids.length) {
      throw new BadRequestException(
        `Reorder expects every banner: received ${ids.length} of ${total}`,
      );
    }

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.promoBanner.update({ where: { id }, data: { position: index } }),
      ),
    );

    return { reordered: ids.length };
  }

  private async assertExists(id: string) {
    const found = await this.prisma.promoBanner.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Banner not found');
  }

  /**
   * A placement pointing at a category that does not exist stores cleanly and
   * then shows the banner nowhere — which reads to an admin as "the panel
   * saved it but the site is ignoring it".
   */
  private async assertCategoriesExist(placements: NormalisedPlacement[]) {
    const ids = placements
      .filter((p) => p.scope === 'CATEGORY' && p.categoryId)
      .map((p) => p.categoryId as string);
    if (!ids.length) return;

    const found = await this.prisma.category.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) {
      throw new BadRequestException('A placement names a category that does not exist');
    }
  }
}

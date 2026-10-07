import { BadRequestException } from '@nestjs/common';
import { BannersService } from './banners.service';

/**
 * The read path decides what a visitor sees, and three things about it matter
 * enough to pin:
 *
 *  - an inactive banner must never ship;
 *  - a category page shows the ALL_CATEGORIES set merged with its own;
 *  - an unknown slug degrades rather than throwing. The strip is decoration,
 *    and a slug typo must not be able to take a category page down.
 *
 * The write path is pinned on the two ways reorder can corrupt the list:
 * an id that is not a banner, and a partial list.
 */
function makePrisma() {
  return {
    promoBanner: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ id: 'b-1' }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    promoBannerPlacement: { deleteMany: jest.fn(), createMany: jest.fn() },
    // assertCategoriesExist reaches for this on every write path. Without it
    // the write tests would fail with "Cannot read properties of undefined"
    // rather than with whatever they were actually asserting.
    category: { count: jest.fn().mockResolvedValue(0) },
    siteSetting: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    $transaction: jest.fn(),
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

const service = (prisma: MockPrisma) => new BannersService(prisma as never);

describe('BannersService.findPublic', () => {
  it('asks only for active banners, ordered by position', async () => {
    const prisma = makePrisma();
    await service(prisma).findPublic({ scope: 'homepage' });

    const args = prisma.promoBanner.findMany.mock.calls[0][0];
    expect(args.where.active).toBe(true);
    // createdAt breaks ties so two banners sharing a position do not swap
    // order between requests, which would look like a flickering bug.
    expect(args.orderBy).toEqual([{ position: 'asc' }, { createdAt: 'asc' }]);
  });

  it('matches HOMEPAGE placements for the homepage', async () => {
    const prisma = makePrisma();
    await service(prisma).findPublic({ scope: 'homepage' });

    const args = prisma.promoBanner.findMany.mock.calls[0][0];
    expect(args.where.placements.some).toEqual({ scope: 'HOMEPAGE' });
  });

  it('merges ALL_CATEGORIES with the named category', async () => {
    const prisma = makePrisma();
    await service(prisma).findPublic({ scope: 'category', categorySlug: 'ethical' });

    const args = prisma.promoBanner.findMany.mock.calls[0][0];
    expect(args.where.placements.some.OR).toEqual([
      { scope: 'ALL_CATEGORIES' },
      { scope: 'CATEGORY', category: { slug: 'ethical' } },
    ]);
  });

  it('lowercases the slug, because a category URL is not case sensitive', async () => {
    const prisma = makePrisma();
    await service(prisma).findPublic({ scope: 'category', categorySlug: 'Ethical' });

    const args = prisma.promoBanner.findMany.mock.calls[0][0];
    expect(args.where.placements.some.OR[1]).toEqual({
      scope: 'CATEGORY',
      category: { slug: 'ethical' },
    });
  });

  it('rejects scope=category with no slug — a caller bug, not a visitor path', async () => {
    await expect(
      service(makePrisma()).findPublic({ scope: 'category' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never leaks the admin-only columns to the storefront', async () => {
    const prisma = makePrisma();
    await service(prisma).findPublic({ scope: 'homepage' });

    const args = prisma.promoBanner.findMany.mock.calls[0][0];
    expect(Object.keys(args.select).sort()).toEqual(
      ['altText', 'id', 'imageUrl', 'linkUrl', 'mobileImageUrl'].sort(),
    );
  });

  it('returns the rotation interval alongside the banners, so the page makes one call', async () => {
    const result = await service(makePrisma()).findPublic({ scope: 'homepage' });
    expect(result).toEqual({ banners: [], rotationSeconds: 5 });
  });

  it('clamps a hand-edited rotation value out of the settings row', async () => {
    const prisma = makePrisma();
    prisma.siteSetting.findUnique.mockResolvedValue({ data: { rotationSeconds: 900 } });

    const result = await service(prisma).findPublic({ scope: 'homepage' });
    expect(result.rotationSeconds).toBe(30);
  });
});

describe('BannersService.reorder', () => {
  it('rejects a list containing duplicates', async () => {
    const prisma = makePrisma();
    await expect(service(prisma).reorder(['id-a', 'id-a'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a banner, before writing anything', async () => {
    const prisma = makePrisma();
    prisma.promoBanner.count.mockResolvedValue(1); // only 1 of the 2 ids exists

    await expect(service(prisma).reorder(['id-a', 'id-b'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a partial list — positions are rewritten wholesale or not at all', async () => {
    const prisma = makePrisma();
    prisma.promoBanner.count
      .mockResolvedValueOnce(1) // the ids sent all exist
      .mockResolvedValueOnce(5); // but there are 5 banners in total

    await expect(service(prisma).reorder(['id-a'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('assigns positions by array index in a single transaction', async () => {
    const prisma = makePrisma();
    prisma.promoBanner.count.mockResolvedValue(3);
    prisma.$transaction.mockResolvedValue([]);

    const result = await service(prisma).reorder(['id-a', 'id-b', 'id-c']);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.promoBanner.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'id-a' },
      data: { position: 0 },
    });
    expect(prisma.promoBanner.update).toHaveBeenNthCalledWith(3, {
      where: { id: 'id-c' },
      data: { position: 2 },
    });
    expect(result).toEqual({ reordered: 3 });
  });
});

describe('BannersService.create', () => {
  it('appends to the end rather than the front, so adding one never demotes the first', async () => {
    const prisma = makePrisma();
    prisma.promoBanner.findFirst.mockResolvedValue({ position: 4 });
    prisma.promoBanner.create.mockResolvedValue({ id: 'new' });

    await service(prisma).create({
      title: 'x',
      imageUrl: 'https://example.test/a.jpg',
      altText: 'x',
    });

    expect(prisma.promoBanner.create.mock.calls[0][0].data.position).toBe(5);
  });

  it('starts at position 0 when there are no banners yet', async () => {
    const prisma = makePrisma();
    prisma.promoBanner.create.mockResolvedValue({ id: 'new' });

    await service(prisma).create({
      title: 'x',
      imageUrl: 'https://example.test/a.jpg',
      altText: 'x',
    });

    expect(prisma.promoBanner.create.mock.calls[0][0].data.position).toBe(0);
  });

  it('rejects a placement naming a category that does not exist', async () => {
    const prisma = makePrisma();
    prisma.category.count.mockResolvedValue(0);

    await expect(
      service(prisma).create({
        title: 'x',
        imageUrl: 'https://example.test/a.jpg',
        altText: 'x',
        placements: [{ scope: 'CATEGORY', categoryId: 'missing' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.promoBanner.create).not.toHaveBeenCalled();
  });
});

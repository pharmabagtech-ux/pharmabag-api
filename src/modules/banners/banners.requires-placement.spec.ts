import { BadRequestException } from '@nestjs/common';
import { BannersService } from './banners.service';

/**
 * A promo banner saved with no placement is invisible everywhere, forever, and
 * complains nowhere.
 *
 * Reported 2026-11-19: "I made a slim banner for the home page long back but
 * it's not showing." The storefront was fine and the API was deployed and
 * healthy — `GET /banners?scope=homepage` answered 200 with
 * `{"banners":[],"rotationSeconds":5}`, and so did all four category scopes.
 * The banner simply matched nothing: `findPublic` filters on
 * `placements: { some }`, so a banner with zero placement rows is excluded
 * from every query there is.
 *
 * Nothing on the path reports it. `placements` was `@IsOptional()` with no
 * minimum, so the API accepted the save; the admin form's `canSave` checked
 * title, image and altText but never a placement; `fetchBanners` in the buyer
 * app returns an empty list on ANY failure rather than throwing; and
 * `PromoBannerStrip` renders `null` on empty. The admin got a success toast
 * and a banner listed as Active. The one real signal was a "Shown nowhere"
 * badge in the admin list.
 *
 * `ArrayMinSize(1)` on the DTO closes the obvious door and is covered in
 * `dto/banner-dtos.spec.ts`. These cover the one it does NOT close:
 * `normalisePlacements` drops a CATEGORY entry carrying no categoryId, so a
 * one-element array can still reach the database as zero rows. The guard has
 * to run on the NORMALISED set, which only the service sees.
 */

const HOMEPAGE = { scope: 'HOMEPAGE' as const };

const makeService = () => {
  const created: any[] = [];

  const prisma = {
    promoBanner: {
      findFirst: jest.fn(() => Promise.resolve({ position: 0 })),
      findUnique: jest.fn(() => Promise.resolve({ id: 'banner-1', placements: [] })),
      create: jest.fn((args: any) => {
        created.push(args);
        return Promise.resolve({ id: 'banner-1', ...args.data });
      }),
      update: jest.fn(() => Promise.resolve({ id: 'banner-1' })),
    },
    promoBannerPlacement: {
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      createMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    category: {
      count: jest.fn(() => Promise.resolve(0)),
    },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };

  return { service: new BannersService(prisma as any), prisma, created };
};

describe('BannersService — a banner must be shown somewhere', () => {
  it('rejects a CREATE whose only placement normalises away', async () => {
    const { service, prisma } = makeService();

    // Passes ArrayMinSize(1): it is one element. normalisePlacements then
    // drops it, because a CATEGORY placement with no categoryId targets
    // nothing — which is how a "placed" banner reaches the database unplaced.
    await expect(
      service.create({ placements: [{ scope: 'CATEGORY' }] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.promoBanner.create).not.toHaveBeenCalled();
  });

  it('rejects an UPDATE whose only placement normalises away', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.update('banner-1', { placements: [{ scope: 'CATEGORY' }] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.promoBannerPlacement.deleteMany).not.toHaveBeenCalled();
  });

  it('says what to do about it, in the admin’s language', async () => {
    const { service } = makeService();

    await expect(
      service.create({ placements: [{ scope: 'CATEGORY' }] } as any),
    ).rejects.toThrow(/homepage, all categories, or at least one category/);
  });

  it('accepts a real homepage placement', async () => {
    const { service, created } = makeService();

    await service.create({
      title: 'Slim strip',
      imageUrl: 'https://example.invalid/a.jpg',
      altText: 'Wholesale offers',
      placements: [HOMEPAGE],
    } as any);

    expect(created).toHaveLength(1);
    expect(created[0].data.placements.create).toEqual([
      { scope: 'HOMEPAGE', categoryId: null },
    ]);
  });

  /**
   * The guard must not reach the Active toggle. The admin list changes `active`
   * with a partial payload, and an absent `placements` has always meant "leave
   * them alone". If this starts throwing, every toggle 400s — including on the
   * already-broken unplaced banners an admin is most likely to be poking at.
   */
  it('leaves placements alone when an update omits them', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.update('banner-1', { active: false } as any),
    ).resolves.toBeDefined();

    expect(prisma.promoBannerPlacement.deleteMany).not.toHaveBeenCalled();
    expect(prisma.promoBanner.update).toHaveBeenCalled();
  });
});

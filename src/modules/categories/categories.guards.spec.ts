import { ConflictException } from '@nestjs/common';
import { CategoriesService } from './categories.service';

/**
 * The admin Categories screen exists and is now reachable from the sidebar,
 * which exposes its Rename and Delete buttons to a real operator. Both needed
 * guarding first.
 *
 * DELETE: the service already counted what used the category and then deleted
 * anyway. `MasterProduct.category` has no cascade, so Postgres restricts and
 * the operator saw a raw foreign-key error; `SubCategory.category` IS
 * `onDelete: Cascade`, so an otherwise-empty category quietly took its
 * sub-categories with it.
 *
 * RENAME: the slug is rewritten from the new name, so /categories/<old-slug>
 * — a URL that ranks — starts 404ing with nothing pointing at its replacement.
 * A category slug also forms the first segment of every sub-category URL
 * beneath it, so one rename can orphan a whole family of pages.
 */
const makePrisma = (overrides: any = {}) => ({
  category: {
    findUnique: jest.fn(async () => null),
    update: jest.fn(async ({ data }: any) => ({ id: 'cat-1', ...data })),
    delete: jest.fn(async () => ({ id: 'cat-1' })),
    ...overrides.category,
  },
  subCategory: {
    findUnique: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    update: jest.fn(async ({ data }: any) => ({ id: 'sub-1', ...data })),
    delete: jest.fn(async () => ({ id: 'sub-1' })),
    ...overrides.subCategory,
  },
});

const makeService = (
  prisma: any,
  redirectFails = false,
  moveFails = false,
) => {
  const redirects = {
    create: jest.fn(async (input: any) => {
      if (redirectFails) throw new Error('redirects table on fire');
      return input;
    }),
  };
  const pageSeo = {
    movePath: jest.fn(async (from: string, to: string) => {
      if (moveFails) throw new Error('page_seo table on fire');
      return { from, to, moved: true };
    }),
  };
  const service = new CategoriesService(
    prisma as any,
    redirects as any,
    pageSeo as any,
  );
  return { service, redirects, pageSeo };
};

describe('CategoriesService — delete guards', () => {
  it('refuses to delete a category that master products still use', async () => {
    const prisma = makePrisma({
      category: {
        findUnique: jest.fn(async () => ({
          id: 'cat-1',
          name: 'Ayurvedic',
          slug: 'ayurvedic',
          _count: { masterProducts: 4312, products: 0, subCategories: 0 },
        })),
      },
    });
    const { service } = makeService(prisma);

    await expect(service.deleteCategory('cat-1')).rejects.toThrow(ConflictException);
    expect(prisma.category.delete).not.toHaveBeenCalled();
  });

  it('names the counts so the operator knows what is in the way', async () => {
    const prisma = makePrisma({
      category: {
        findUnique: jest.fn(async () => ({
          id: 'cat-1',
          name: 'Ayurvedic',
          slug: 'ayurvedic',
          _count: { masterProducts: 4312, products: 7, subCategories: 8 },
        })),
      },
    });
    const { service } = makeService(prisma);

    await expect(service.deleteCategory('cat-1')).rejects.toThrow(/4312/);
    await expect(service.deleteCategory('cat-1')).rejects.toThrow(/8/);
    await expect(service.deleteCategory('cat-1')).rejects.toThrow(/Ayurvedic/);
  });

  /** Cascade means an "empty" category silently takes these with it. */
  it('refuses when only sub-categories are attached', async () => {
    const prisma = makePrisma({
      category: {
        findUnique: jest.fn(async () => ({
          id: 'cat-1',
          name: 'Ayurvedic',
          slug: 'ayurvedic',
          _count: { masterProducts: 0, products: 0, subCategories: 3 },
        })),
      },
    });
    const { service } = makeService(prisma);

    await expect(service.deleteCategory('cat-1')).rejects.toThrow(ConflictException);
  });

  it('deletes a genuinely empty category', async () => {
    const prisma = makePrisma({
      category: {
        findUnique: jest.fn(async () => ({
          id: 'cat-1',
          name: 'Spare',
          slug: 'spare',
          _count: { masterProducts: 0, products: 0, subCategories: 0 },
        })),
      },
    });
    const { service } = makeService(prisma);

    await expect(service.deleteCategory('cat-1')).resolves.toBeDefined();
    expect(prisma.category.delete).toHaveBeenCalled();
  });

  it('refuses to delete a sub-category still holding products', async () => {
    const prisma = makePrisma({
      subCategory: {
        findUnique: jest.fn(async () => ({
          id: 'sub-1',
          name: 'Tablet',
          slug: 'tablet',
          _count: { masterProducts: 900, products: 0 },
        })),
      },
    });
    const { service } = makeService(prisma);

    await expect(service.deleteSubCategory('sub-1')).rejects.toThrow(ConflictException);
    expect(prisma.subCategory.delete).not.toHaveBeenCalled();
  });
});

describe('CategoriesService — rename keeps the old URL alive', () => {
  const renaming = () =>
    makePrisma({
      category: {
        findUnique: jest.fn(async () => ({
          id: 'cat-1',
          name: 'Ayurvedic',
          slug: 'ayurvedic',
        })),
        update: jest.fn(async () => ({
          id: 'cat-1',
          name: 'Ayurveda',
          slug: 'ayurveda',
        })),
      },
      subCategory: {
        findMany: jest.fn(async () => [
          { id: 'sub-1', slug: 'tablet' },
          { id: 'sub-2', slug: 'syrup' },
        ]),
      },
    });

  it('redirects the old category URL to the new one', async () => {
    const prisma = renaming();
    const { service, redirects } = makeService(prisma);

    await service.updateCategory('cat-1', { name: 'Ayurveda' } as any);

    expect(redirects.create).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '/categories/ayurvedic',
        to: '/categories/ayurveda',
      }),
    );
  });

  /** The category slug is the first segment of every sub-category URL. */
  it('redirects every sub-category URL underneath it', async () => {
    const prisma = renaming();
    const { service, redirects } = makeService(prisma);

    await service.updateCategory('cat-1', { name: 'Ayurveda' } as any);

    const pairs = redirects.create.mock.calls.map((c: any[]) => [c[0].from, c[0].to]);
    expect(pairs).toContainEqual([
      '/categories/ayurvedic/tablet',
      '/categories/ayurveda/tablet',
    ]);
    expect(pairs).toContainEqual([
      '/categories/ayurvedic/syrup',
      '/categories/ayurveda/syrup',
    ]);
  });

  it('writes no redirect when the slug did not change', async () => {
    const prisma = makePrisma({
      category: {
        findUnique: jest.fn(async () => ({
          id: 'cat-1',
          name: 'Ayurvedic',
          slug: 'ayurvedic',
        })),
        update: jest.fn(async () => ({
          id: 'cat-1',
          name: 'Ayurvedic',
          slug: 'ayurvedic',
        })),
      },
    });
    const { service, redirects } = makeService(prisma);

    await service.updateCategory('cat-1', { name: 'Ayurvedic' } as any);

    expect(redirects.create).not.toHaveBeenCalled();
  });

  /** SEO housekeeping must never cost the operator their rename. */
  it('still renames when the redirect cannot be written', async () => {
    const prisma = renaming();
    const { service } = makeService(prisma, true);

    await expect(
      service.updateCategory('cat-1', { name: 'Ayurveda' } as any),
    ).resolves.toMatchObject({ slug: 'ayurveda' });
  });

  /**
   * `page_seo` rows are keyed by PATH, and a rename rewrites the slug. Without
   * this, admin-written copy stays behind at the old path and the renamed page
   * silently drops back to generated wording — data loss with no error, and it
   * became far likelier once the content editor moved next to the rename
   * button in the admin Categories tab.
   */
  it('takes the page content with it when a category is renamed', async () => {
    const prisma = renaming();
    const { service, pageSeo } = makeService(prisma);

    await service.updateCategory('cat-1', { name: 'Ayurveda' } as any);

    expect(pageSeo.movePath).toHaveBeenCalledWith(
      '/categories/ayurvedic',
      '/categories/ayurveda',
    );
  });

  it('takes every sub-category page content with it too', async () => {
    const prisma = renaming();
    const { service, pageSeo } = makeService(prisma);

    await service.updateCategory('cat-1', { name: 'Ayurveda' } as any);

    const moves = pageSeo.movePath.mock.calls.map((c: any[]) => [c[0], c[1]]);
    expect(moves).toContainEqual([
      '/categories/ayurvedic/tablet',
      '/categories/ayurveda/tablet',
    ]);
    expect(moves).toContainEqual([
      '/categories/ayurvedic/syrup',
      '/categories/ayurveda/syrup',
    ]);
  });

  it('moves nothing when the slug did not change', async () => {
    const prisma = makePrisma({
      category: {
        findUnique: jest.fn(async () => ({
          id: 'cat-1',
          name: 'Ayurvedic',
          slug: 'ayurvedic',
        })),
        update: jest.fn(async () => ({
          id: 'cat-1',
          name: 'Ayurvedic',
          slug: 'ayurvedic',
        })),
      },
    });
    const { service, pageSeo } = makeService(prisma);

    await service.updateCategory('cat-1', { name: 'Ayurvedic' } as any);

    expect(pageSeo.movePath).not.toHaveBeenCalled();
  });

  it('still renames when the content move fails', async () => {
    const prisma = renaming();
    const { service } = makeService(prisma, false, true);

    await expect(
      service.updateCategory('cat-1', { name: 'Ayurveda' } as any),
    ).resolves.toMatchObject({ slug: 'ayurveda' });
  });

  it('redirects a renamed sub-category under its parent slug', async () => {
    const prisma = makePrisma({
      subCategory: {
        findUnique: jest.fn(async () => ({
          id: 'sub-1',
          name: 'Tablet',
          slug: 'tablet',
          categoryId: 'cat-1',
          category: { slug: 'ayurvedic' },
        })),
        update: jest.fn(async () => ({
          id: 'sub-1',
          name: 'Tablets',
          slug: 'tablets',
          category: { slug: 'ayurvedic' },
        })),
      },
    });
    const { service, redirects } = makeService(prisma);

    await service.updateSubCategory('sub-1', { name: 'Tablets' } as any);

    expect(redirects.create).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '/categories/ayurvedic/tablet',
        to: '/categories/ayurvedic/tablets',
      }),
    );
  });

  it('takes a renamed sub-category page content with it', async () => {
    const prisma = makePrisma({
      subCategory: {
        findUnique: jest.fn(async () => ({
          id: 'sub-1',
          name: 'Tablet',
          slug: 'tablet',
          categoryId: 'cat-1',
          category: { slug: 'ayurvedic' },
        })),
        update: jest.fn(async () => ({
          id: 'sub-1',
          name: 'Tablets',
          slug: 'tablets',
          category: { slug: 'ayurvedic' },
        })),
      },
    });
    const { service, pageSeo } = makeService(prisma);

    await service.updateSubCategory('sub-1', { name: 'Tablets' } as any);

    expect(pageSeo.movePath).toHaveBeenCalledWith(
      '/categories/ayurvedic/tablet',
      '/categories/ayurvedic/tablets',
    );
  });
});

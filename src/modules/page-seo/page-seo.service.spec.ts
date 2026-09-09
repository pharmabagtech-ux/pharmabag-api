import { PageSeoService } from './page-seo.service';

/**
 * Path normalisation is the whole contract of this module: the storefront
 * looks an override up by the page's own path, so if the stored key and the
 * looked-up key disagree by a trailing slash or a capital letter, the override
 * silently does nothing and looks like a bug in the admin panel.
 */
describe('PageSeoService.normalizePath', () => {
  const n = PageSeoService.normalizePath;

  it('keeps an already-canonical path unchanged', () => {
    expect(n('/categories/ayurvedic')).toBe('/categories/ayurvedic');
  });

  it('adds a leading slash', () => {
    expect(n('categories/ayurvedic')).toBe('/categories/ayurvedic');
  });

  it('strips trailing slashes', () => {
    expect(n('/categories/ayurvedic/')).toBe('/categories/ayurvedic');
    expect(n('/categories/ayurvedic///')).toBe('/categories/ayurvedic');
  });

  it('lowercases, so /Categories/Ayurvedic is the same page', () => {
    expect(n('/Categories/Ayurvedic')).toBe('/categories/ayurvedic');
  });

  it('drops query strings and hashes', () => {
    expect(n('/categories/ayurvedic?page=2')).toBe('/categories/ayurvedic');
    expect(n('/categories/ayurvedic#faq')).toBe('/categories/ayurvedic');
    expect(n('/products?search=dolo&sort=price')).toBe('/products');
  });

  it('preserves the root as a single slash rather than emptying it', () => {
    expect(n('/')).toBe('/');
    expect(n('')).toBe('/');
    expect(n('   ')).toBe('/');
  });

  it('handles the deepest real routes', () => {
    expect(n('/categories/ayurvedic/syrup/')).toBe('/categories/ayurvedic/syrup');
    expect(n('/wholesale-medicine-suppliers/west-bengal/kolkata')).toBe(
      '/wholesale-medicine-suppliers/west-bengal/kolkata',
    );
  });
});

/**
 * The on-page content fields (h1, intro, bodyHtml) are what make this a page
 * CONTENT store rather than only a `<head>` store. They follow the same
 * three-state contract as every other field, and that contract is the part
 * worth pinning: `undefined` leaves the stored value alone, `''` clears it so
 * the storefront resumes generating the text, and a value stores it.
 *
 * Getting this wrong is silent. A truthiness spread would swallow the clear,
 * the admin would see the field empty after saving, and the live page would
 * keep serving the old override.
 */
describe('PageSeoService.upsert — on-page content fields', () => {
  const makeService = () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = { pageSeo: { upsert } } as unknown as never;
    return { service: new PageSeoService(prisma), upsert };
  };

  /** The `update` half of the upsert is what a save on an existing row writes. */
  const written = (upsert: jest.Mock) => upsert.mock.calls[0][0].update;

  it('stores h1, intro and bodyHtml', async () => {
    const { service, upsert } = makeService();

    await service.upsert('/categories/ayurvedic', {
      h1: 'Ayurvedic medicines — wholesale suppliers in India',
      intro: 'PharmaBag lists {{product_count}} ayurvedic medicines.',
      bodyHtml: '<p>Buying guidance for ayurvedic stock.</p>',
    });

    expect(written(upsert)).toMatchObject({
      h1: 'Ayurvedic medicines — wholesale suppliers in India',
      intro: 'PharmaBag lists {{product_count}} ayurvedic medicines.',
      bodyHtml: '<p>Buying guidance for ayurvedic stock.</p>',
    });
  });

  it('clears each of them to null when given an empty string', async () => {
    const { service, upsert } = makeService();

    await service.upsert('/categories/ayurvedic', {
      h1: '',
      intro: '   ',
      bodyHtml: '',
    });

    expect(written(upsert)).toMatchObject({
      h1: null,
      intro: null,
      bodyHtml: null,
    });
  });

  it('leaves them untouched when the field is absent from the payload', async () => {
    const { service, upsert } = makeService();

    await service.upsert('/categories/ayurvedic', { title: 'Only the title' });

    const data = written(upsert);
    expect(data.h1).toBeUndefined();
    expect(data.intro).toBeUndefined();
    expect(data.bodyHtml).toBeUndefined();
  });

  it('normalises the path before writing, so the storefront can find the row', async () => {
    const { service, upsert } = makeService();

    await service.upsert('/Categories/Ayurvedic/', { h1: 'Heading' });

    expect(upsert.mock.calls[0][0].where).toEqual({ path: '/categories/ayurvedic' });
  });
});

/**
 * Rows are keyed by path, and a category rename rewrites the slug — so without
 * a move, admin-written copy stays behind at a path nothing renders any more
 * and the renamed page silently reverts to generated wording.
 */
describe('PageSeoService.movePath', () => {
  const makeService = (rows: Record<string, any>) => {
    const prisma = {
      pageSeo: {
        findUnique: jest.fn(async ({ where }: any) => rows[where.path] ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rows[where.path];
          delete rows[where.path];
          rows[data.path] = { ...row, path: data.path };
          return rows[data.path];
        }),
      },
    };
    return { service: new PageSeoService(prisma as any), prisma, rows };
  };

  it('moves the row to the new path', async () => {
    const { service, rows } = makeService({
      '/categories/ayurvedic': { id: 'r1', path: '/categories/ayurvedic', h1: 'Mine' },
    });

    const moved = await service.movePath('/categories/ayurvedic', '/categories/ayurveda');

    expect(moved).toBe(true);
    expect(rows['/categories/ayurveda'].h1).toBe('Mine');
    expect(rows['/categories/ayurvedic']).toBeUndefined();
  });

  it('does nothing when there is no row to move', async () => {
    const { service, prisma } = makeService({});

    const moved = await service.movePath('/categories/ayurvedic', '/categories/ayurveda');

    expect(moved).toBe(false);
    expect(prisma.pageSeo.update).not.toHaveBeenCalled();
  });

  /** Someone already wrote copy for the new path; theirs wins. */
  it('leaves both rows alone when the destination is taken', async () => {
    const { service, prisma, rows } = makeService({
      '/categories/ayurvedic': { id: 'r1', path: '/categories/ayurvedic', h1: 'Old' },
      '/categories/ayurveda': { id: 'r2', path: '/categories/ayurveda', h1: 'Already here' },
    });

    const moved = await service.movePath('/categories/ayurvedic', '/categories/ayurveda');

    expect(moved).toBe(false);
    expect(prisma.pageSeo.update).not.toHaveBeenCalled();
    expect(rows['/categories/ayurveda'].h1).toBe('Already here');
  });

  it('normalises both paths, so a trailing slash still finds the row', async () => {
    const { service, rows } = makeService({
      '/categories/ayurvedic': { id: 'r1', path: '/categories/ayurvedic', h1: 'Mine' },
    });

    await service.movePath('/Categories/Ayurvedic/', '/categories/ayurveda/');

    expect(rows['/categories/ayurveda']).toBeDefined();
  });

  it('does nothing when the path has not actually changed', async () => {
    const { service, prisma } = makeService({
      '/categories/ayurvedic': { id: 'r1', path: '/categories/ayurvedic' },
    });

    const moved = await service.movePath('/categories/ayurvedic', '/categories/ayurvedic');

    expect(moved).toBe(false);
    expect(prisma.pageSeo.update).not.toHaveBeenCalled();
  });
});

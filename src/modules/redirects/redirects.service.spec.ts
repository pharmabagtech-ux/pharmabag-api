import { RedirectsService } from './redirects.service';

type Row = {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  source: string;
  hits: number;
};

/**
 * In-memory prisma double that actually enforces the fromPath unique key, so
 * upsert/chain-collapse behaviour is exercised for real rather than assumed.
 */
const makeService = (seed: Partial<Row>[] = []) => {
  let idSeq = 1;
  const redirects: Row[] = seed.map((r) => ({
    id: r.id ?? `seed-${idSeq++}`,
    fromPath: r.fromPath!,
    toPath: r.toPath!,
    statusCode: r.statusCode ?? 301,
    source: r.source ?? 'MANUAL',
    hits: r.hits ?? 0,
  }));
  const notFound: { id: string; path: string; hits: number; resolved: boolean; lastReferrer?: string | null }[] = [];

  const prisma = {
    urlRedirect: {
      findMany: jest.fn(async ({ take }: any = {}) => redirects.slice(0, take ?? redirects.length)),
      count: jest.fn(async () => redirects.length),
      findUnique: jest.fn(async ({ where }: any) => redirects.find((r) => r.fromPath === where.fromPath) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = redirects.find((r) => r.fromPath === where.fromPath);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `r-${idSeq++}`, hits: 0, statusCode: 301, source: 'MANUAL', ...create };
        redirects.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of redirects) {
          if (where.toPath && r.toPath !== where.toPath) continue;
          if (where.fromPath && r.fromPath !== where.fromPath) continue;
          if (data.toPath) r.toPath = data.toPath;
          if (data.hits?.increment) r.hits += data.hits.increment;
          count++;
        }
        return { count };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = redirects.findIndex((r) => r.id === where.id);
        if (i >= 0) return redirects.splice(i, 1)[0];
        throw new Error('not found');
      }),
    },
    notFoundHit: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = notFound.find((n) => n.path === where.path);
        if (existing) {
          existing.hits += update.hits?.increment ?? 0;
          if (update.lastReferrer !== undefined) existing.lastReferrer = update.lastReferrer;
          return existing;
        }
        const row = { id: `n-${idSeq++}`, resolved: false, ...create };
        notFound.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const n of notFound) {
          if (where.path && n.path !== where.path) continue;
          Object.assign(n, data);
          count++;
        }
        return { count };
      }),
      findMany: jest.fn(async () => notFound),
      delete: jest.fn(async ({ where }: any) => {
        const i = notFound.findIndex((n) => n.id === where.id);
        if (i >= 0) return notFound.splice(i, 1)[0];
        throw new Error('not found');
      }),
    },
  };

  return { service: new RedirectsService(prisma as any), redirects, notFound, prisma };
};

describe('RedirectsService.create', () => {
  it('normalizes both sides and stores the redirect', async () => {
    const { service, redirects } = makeService();
    await service.create({ from: '/Old-Page/', to: '/products/new-slug' });
    expect(redirects[0]).toMatchObject({ fromPath: '/old-page', toPath: '/products/new-slug' });
  });

  it('rejects a redirect that points at itself', async () => {
    const { service } = makeService();
    await expect(service.create({ from: '/same', to: '/same/' })).rejects.toThrow();
  });

  it('collapses forward chains at write time (new A→B where B→C stores A→C)', async () => {
    const { service, redirects } = makeService([{ fromPath: '/b', toPath: '/c' }]);
    await service.create({ from: '/a', to: '/b' });
    expect(redirects.find((r) => r.fromPath === '/a')?.toPath).toBe('/c');
  });

  it('repoints backward chains (existing A→B; new B→C flattens A→C)', async () => {
    const { service, redirects } = makeService([{ fromPath: '/a', toPath: '/b' }]);
    await service.create({ from: '/b', to: '/c' });
    expect(redirects.find((r) => r.fromPath === '/a')?.toPath).toBe('/c');
    expect(redirects.find((r) => r.fromPath === '/b')?.toPath).toBe('/c');
  });

  it('accepts absolute external URLs as targets, kept verbatim', async () => {
    const { service, redirects } = makeService();
    await service.create({ from: '/old', to: 'https://example.com/Page' });
    expect(redirects[0].toPath).toBe('https://example.com/Page');
  });

  it('marks a matching 404 entry resolved', async () => {
    const { service, notFound, prisma } = makeService();
    await prisma.notFoundHit.upsert({
      where: { path: '/dead-page' },
      create: { path: '/dead-page', hits: 5, lastReferrer: null },
      update: {},
    });
    await service.create({ from: '/dead-page', to: '/products' });
    expect(notFound[0].resolved).toBe(true);
  });
});

describe('RedirectsService.track404', () => {
  it('upserts and increments by normalized path', async () => {
    const { service, notFound } = makeService();
    await service.track404({ path: '/Missing-Page/' });
    await service.track404({ path: '/missing-page?ref=1' });
    expect(notFound).toHaveLength(1);
    expect(notFound[0]).toMatchObject({ path: '/missing-page', hits: 2 });
  });

  it('drops scanner noise', async () => {
    const { service, notFound } = makeService();
    await service.track404({ path: '/wp-admin/setup.php' });
    expect(notFound).toHaveLength(0);
  });

  it('drops paths already covered by a redirect', async () => {
    const { service, notFound } = makeService([{ fromPath: '/covered', toPath: '/products' }]);
    await service.track404({ path: '/covered' });
    expect(notFound).toHaveLength(0);
  });
});

describe('RedirectsService.recordHit', () => {
  it('increments a known redirect and ignores unknown paths', async () => {
    const { service, redirects } = makeService([{ fromPath: '/old', toPath: '/new' }]);
    await service.recordHit('/old');
    await service.recordHit('/unknown');
    expect(redirects[0].hits).toBe(1);
  });
});

describe('RedirectsService.createFromRename', () => {
  it('creates product redirects for changed slugs only and reports the count', async () => {
    const { service, redirects } = makeService();
    const count = await service.createFromRename([
      { oldSlug: 'acenac-p-tablet-pb1810', newSlug: 'acenac-p-tab-pb1810' },
      { oldSlug: 'same-slug-pb1', newSlug: 'same-slug-pb1' },
    ]);
    expect(count).toBe(1);
    expect(redirects[0]).toMatchObject({
      fromPath: '/products/acenac-p-tablet-pb1810',
      toPath: '/products/acenac-p-tab-pb1810',
      source: 'PRODUCT_RENAME',
    });
  });

  it('is tolerant — one bad pair never fails the batch', async () => {
    const { service } = makeService();
    const count = await service.createFromRename([
      { oldSlug: '', newSlug: 'x' },
      { oldSlug: 'ok-old', newSlug: 'ok-new' },
    ]);
    expect(count).toBe(1);
  });
});

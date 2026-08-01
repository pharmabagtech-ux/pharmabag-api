import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

/**
 * Product URLs on the storefront are built from the product NAME alone
 * (generateProductSlug in the web app), e.g. /products/atorva-10mg-tablet.
 *
 * Master product slugs, however, are written by the bulk uploader as
 * `<name>-<sku>` (generateUniqueSlug appends the SKU unconditionally), e.g.
 * "atorva-10mg-tablet-pb11473". findOne matched only the exact slug, so every
 * product detail page returned "Product not found".
 *
 * A name-only slug must therefore resolve to its SKU-suffixed row.
 */
const MASTERS = [
  {
    id: 'm1',
    sku: 'PB11473',
    name: 'Atorva 10mg Tablet',
    slug: 'atorva-10mg-tablet-pb11473',
    deletedAt: null,
  },
  {
    id: 'm2',
    sku: 'PB21119',
    name: '3-Nite Vag Capsule',
    slug: '3-nite-vag-capsule-pb21119',
    deletedAt: null,
  },
  {
    // Guards against a loose prefix match: this shares a prefix with m1 but is
    // a different product and must never be returned for "atorva-10mg-tablet".
    id: 'm3',
    sku: 'PB99999',
    name: 'Atorva 10mg Tablet Plus',
    slug: 'atorva-10mg-tablet-plus-pb99999',
    deletedAt: null,
  },
  {
    // The web's OLD slug generator hyphenated punctuation ("0.5mg" ->
    // "0-5mg"); the bulk uploader has always deleted it ("05mg"). A link
    // built before fix(buyer) 0975cc7 requests "budecort-0-5mg-respule",
    // which starts-with-matches nothing — it must resolve via exact
    // reconstruction of the legacy slug instead.
    id: 'm4',
    sku: 'PB24820',
    name: 'Budecort 0.5mg Respule',
    slug: 'budecort-05mg-respule-pb24820',
    deletedAt: null,
  },
  {
    // Ambiguity guard: two different products whose names differ only in
    // WHICH punctuation mark they use (apostrophe vs slash) legacy-slugify to
    // the identical string, even though their current, correctly-generated
    // slugs also happen to coincide ("crocins-syrup"). Neither the exact nor
    // the SKU-suffix match can resolve "crocin-s-syrup", and the legacy
    // fallback must refuse to guess between them rather than show one drug
    // for a link that could have meant either.
    id: 'm5',
    sku: 'PB1',
    name: "Crocin's Syrup",
    slug: 'crocins-syrup-pb1',
    deletedAt: null,
  },
  {
    id: 'm6',
    sku: 'PB2',
    name: 'Crocin/s Syrup',
    slug: 'crocins-syrup-pb2',
    deletedAt: null,
  },
];

const makeService = () => {
  const prisma = {
    product: { findFirst: jest.fn().mockResolvedValue(null) },
    masterProduct: {
      findFirst: jest.fn(({ where }: any) => {
        const conditions = where.OR ?? [
          ...(where.slug ? [{ slug: where.slug }] : []),
          ...(where.id ? [{ id: where.id }] : []),
        ];
        const found = MASTERS.find((m) =>
          conditions.some(
            (cond: any) =>
              (cond.id && cond.id === m.id) ||
              (cond.slug && cond.slug === m.slug),
          ),
        );
        return Promise.resolve(found ?? null);
      }),
      findMany: jest.fn(({ where }: any) => {
        const prefix = where?.slug?.startsWith ?? '';
        return Promise.resolve(
          MASTERS.filter((m) => m.slug.startsWith(prefix)),
        );
      }),
    },
  };
  const analytics = { recordView: jest.fn() };
  const service = new ProductsService(
    prisma as any,
    {} as any,
    {} as any,
    analytics as any,
  );
  return { service, prisma };
};

describe('ProductsService.findOne — name-only slug resolution', () => {
  it('resolves a name-only slug to the SKU-suffixed product', async () => {
    const { service } = makeService();

    const product: any = await service.findOne('atorva-10mg-tablet');

    expect(product).toBeTruthy();
    expect(product.id).toBe('m1');
  });

  it('resolves a slug that starts with a digit', async () => {
    const { service } = makeService();

    const product: any = await service.findOne('3-nite-vag-capsule');

    expect(product.id).toBe('m2');
  });

  it('still resolves the exact stored slug', async () => {
    const { service } = makeService();

    const product: any = await service.findOne('atorva-10mg-tablet-pb11473');

    expect(product.id).toBe('m1');
  });

  it('does not return a different product that merely shares the prefix', async () => {
    const { service } = makeService();

    const product: any = await service.findOne('atorva-10mg-tablet');

    expect(product.id).not.toBe('m3');
  });

  it('still 404s for a slug that matches nothing', async () => {
    const { service } = makeService();

    await expect(service.findOne('no-such-product')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('resolves a legacy hyphenated-punctuation slug to its stored row', async () => {
    const { service } = makeService();

    const product: any = await service.findOne('budecort-0-5mg-respule');

    expect(product.id).toBe('m4');
  });

  it('does not guess when two products collapse to the same legacy slug', async () => {
    const { service } = makeService();

    await expect(service.findOne('crocin-s-syrup')).rejects.toThrow(
      NotFoundException,
    );
  });
});

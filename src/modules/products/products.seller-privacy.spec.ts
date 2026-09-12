import { ProductsService } from './products.service';

/**
 * Buyers never learn who the seller is.
 *
 * `GET /products/:id` and `GET /products/featured` are unauthenticated, and
 * both were returning `seller.companyName`, `.city` and `.state` — the API
 * handing out "JAISWAL PHARMA · Kolkata" to anyone with the URL, long after the
 * storefront had stopped printing it. A supplier's name plus their city is
 * enough for a buyer to go around the marketplace entirely.
 *
 * These tests pin BOTH layers of the fix, because either one alone rots:
 *  - the Prisma `select` never asks the database for the three fields, so a
 *    future call site cannot reintroduce them by forgetting to strip;
 *  - the response projection rebuilds the seller field by field, so a spread
 *    (flattenProduct) or a later `include` cannot carry one out.
 *
 * `id` and `rating` are deliberate survivors: an opaque UUID and a number.
 */
const IDENTITY_FIELDS = ['companyName', 'city', 'state'] as const;

const SELLER_ROW = {
  id: 'seller-1',
  rating: 4.5,
  // What a careless `include: { seller: true }` would hand back. The service
  // must never surface these even when the row it is given carries them.
  companyName: 'JAISWAL PHARMA',
  city: 'Kolkata',
  state: 'West Bengal',
};

const makeService = () => {
  const selects: any[] = [];

  const prisma = {
    product: {
      findFirst: jest.fn(({ where, include }: any) => {
        selects.push(include?.seller?.select);
        // findOne tries the listing table first; only a listing id matches, so
        // a master slug falls through to the masterProduct branch below.
        if (where?.id !== 'listing-1') return Promise.resolve(null);
        return Promise.resolve({
          id: 'listing-1',
          mrp: 100,
          batches: [],
          images: [],
          category: null,
          seller: SELLER_ROW,
        });
      }),
    },
    masterProduct: {
      findFirst: jest.fn(({ include }: any) => {
        selects.push(include?.products?.include?.seller?.select);
        return Promise.resolve({
          id: 'master-1',
          name: 'Atorva 10mg Tablet',
          slug: 'atorva-10mg-tablet',
          images: [],
          products: [
            {
              id: 'listing-1',
              mrp: 100,
              gstPercent: 5,
              discountType: null,
              discountMeta: null,
              batches: [],
              images: [],
              seller: SELLER_ROW,
            },
          ],
        });
      }),
    },
    marketingProduct: {
      findMany: jest.fn(({ include }: any) => {
        selects.push(include?.product?.include?.seller?.select);
        return Promise.resolve([
          {
            product: {
              id: 'listing-1',
              mrp: 100,
              batches: [],
              images: [],
              category: null,
              seller: SELLER_ROW,
            },
          },
        ]);
      }),
    },
  };

  const service = new ProductsService(
    prisma as any,
    {} as any,
    {} as any,
    { recordView: jest.fn() } as any,
  );
  return { service, selects };
};

describe('seller identity never reaches a buyer', () => {
  it('GET /products/:id (master + listings) returns only id and rating', async () => {
    const { service } = makeService();

    const product: any = await service.findOne('atorva-10mg-tablet');

    expect(product.listings[0].seller).toEqual({ id: 'seller-1', rating: 4.5 });
    for (const field of IDENTITY_FIELDS) {
      expect(JSON.stringify(product)).not.toContain(field);
    }
    expect(JSON.stringify(product)).not.toContain('JAISWAL PHARMA');
  });

  it('GET /products/:id resolved to a single listing returns only id and rating', async () => {
    const { service } = makeService();

    const listing: any = await service.findOne('listing-1');

    expect(listing.seller).toEqual({ id: 'seller-1', rating: 4.5 });
    expect(JSON.stringify(listing)).not.toContain('Kolkata');
  });

  it('GET /products/featured returns only id and rating', async () => {
    const { service } = makeService();

    const featured: any[] = await service.getFeatured('HOMEPAGE_CAROUSEL');

    expect(featured[0].seller).toEqual({ id: 'seller-1', rating: 4.5 });
    expect(JSON.stringify(featured)).not.toContain('JAISWAL PHARMA');
  });

  it('never asks the database for companyName, city or state', async () => {
    const { service, selects } = makeService();

    await service.findOne('atorva-10mg-tablet');
    await service.getFeatured('HOMEPAGE_CAROUSEL');

    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).toBeDefined();
      expect(Object.keys(select).sort()).toEqual(['id', 'rating']);
    }
  });
});

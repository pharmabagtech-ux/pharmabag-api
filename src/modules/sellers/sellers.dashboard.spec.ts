import { SellersService } from './sellers.service';

/**
 * The seller dashboard used to be three separate lies:
 *
 *   1. Every row in "Recent Orders" showed Rs 0.00, because the response sent
 *      each row's money as `totalPrice` while the page read `totalAmount`.
 *   2. The date-range picker did nothing — getDashboard took only a userId, so
 *      the query string the page built was dropped on the floor.
 *   3. The revenue chart was permanently empty: `revenueTrend: []` with the
 *      comment "Empty for now, would aggregate by day in production".
 *
 * These tests pin all three, plus the two quieter bugs in the same block: five
 * order ITEMS were being presented as five ORDERS, and "pending orders" named
 * four statuses explicitly and so missed the four in the middle of the flow.
 */

const SELLER = { id: 'seller-1', rating: 4.5 };

const order = (id: string, createdAt: string, status = 'DELIVERED') => ({
  id,
  orderStatus: status,
  paymentStatus: 'PAID',
  createdAt: new Date(createdAt),
});

type Row = { totalPrice: number; order: ReturnType<typeof order> };

const makeService = (opts: { items?: Row[]; orders?: any[] } = {}) => {
  const captured: { orderItemWheres: any[]; orderWheres: any[] } = {
    orderItemWheres: [],
    orderWheres: [],
  };

  const prisma = {
    sellerProfile: { findUnique: jest.fn().mockResolvedValue(SELLER) },
    product: { count: jest.fn().mockResolvedValue(0) },
    productBatch: { count: jest.fn().mockResolvedValue(0) },
    sellerSettlement: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    order: {
      count: jest.fn((args: any) => {
        captured.orderWheres.push(args.where);
        return Promise.resolve(0);
      }),
      findMany: jest.fn((args: any) => {
        captured.orderWheres.push(args.where);
        return Promise.resolve(opts.orders ?? []);
      }),
    },
    orderItem: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn((args: any) => {
        captured.orderItemWheres.push(args.where);
        return Promise.resolve({ _sum: { totalPrice: 0 } });
      }),
      findMany: jest.fn((args: any) => {
        captured.orderItemWheres.push(args.where);
        return Promise.resolve(opts.items ?? []);
      }),
    },
  };

  const service = new SellersService(prisma as any, {} as any);
  return { service, prisma, captured };
};

describe('SellersService.getDashboard — recent order amounts', () => {
  it('sends a spendable amount for each recent order', async () => {
    const { service } = makeService({
      orders: [
        {
          ...order('order-1', '2026-09-05T06:00:00.000Z'),
          items: [
            { quantity: 2, totalPrice: 480, product: { name: 'Paracetamol 500mg' } },
          ],
        },
      ],
    });

    const result = await service.getDashboard('user-1');
    const [row] = result.overview.orders;

    expect(row.amount).toBe(480);
    // Legacy key kept: the seller app deploys separately from the API.
    expect(row.totalPrice).toBe(480);
    expect(row.quantity).toBe(2);
  });

  it('sums every line the seller owns on a multi-item order', async () => {
    const { service } = makeService({
      orders: [
        {
          ...order('order-1', '2026-09-05T06:00:00.000Z'),
          items: [
            { quantity: 1, totalPrice: 200, product: { name: 'Paracetamol 500mg' } },
            { quantity: 3, totalPrice: 750, product: { name: 'Azithromycin 250mg' } },
          ],
        },
      ],
    });

    const [row] = (await service.getDashboard('user-1')).overview.orders;

    expect(row.amount).toBe(950);
    expect(row.quantity).toBe(4);
    expect(row.productName).toBe('Paracetamol 500mg +1 more');
  });

  it('lists five distinct orders, not five order items', async () => {
    const { service, prisma } = makeService();

    await service.getDashboard('user-1');

    // The old code called orderItem.findMany({ take: 5 }), so one order with
    // five of this seller's products filled the entire table with itself.
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, orderBy: { createdAt: 'desc' } }),
    );
  });
});

describe('SellersService.getDashboard — date range', () => {
  it('applies the requested window to revenue and order counts', async () => {
    const { service, captured } = makeService();

    await service.getDashboard('user-1', {
      dateFrom: '2026-08-01T00:00:00.000Z',
      dateTo: '2026-08-31T00:00:00.000Z',
    });

    const revenueWhere = captured.orderItemWheres.find((w) => w?.order?.orderStatus === 'DELIVERED');
    expect(revenueWhere.order.createdAt.gte).toBeInstanceOf(Date);
    expect(revenueWhere.order.createdAt.lte).toBeInstanceOf(Date);

    // The end of the window is inclusive: picking 31 Aug covers all of 31 Aug.
    const end = revenueWhere.order.createdAt.lte as Date;
    expect(end.toISOString()).toBe('2026-08-31T18:29:59.999Z'); // 23:59:59.999 IST
  });

  it('reports the resolved window back to the caller', async () => {
    const { service } = makeService();

    const result = await service.getDashboard('user-1', {
      dateFrom: '2026-08-01T00:00:00.000Z',
      dateTo: '2026-08-31T00:00:00.000Z',
    });

    expect(result.range.dateFrom).not.toBeNull();
    expect(result.range.dateTo).not.toBeNull();
  });

  it('falls back to all-time rather than throwing on an unusable range', async () => {
    const { service, captured } = makeService();

    await service.getDashboard('user-1', { dateFrom: 'not-a-date', dateTo: 'also-bad' });

    const revenueWhere = captured.orderItemWheres.find((w) => w?.order?.orderStatus === 'DELIVERED');
    expect(revenueWhere.order.createdAt).toBeUndefined();
  });

  it('ignores an inverted range instead of returning nothing', async () => {
    const { service, captured } = makeService();

    await service.getDashboard('user-1', {
      dateFrom: '2026-09-30T00:00:00.000Z',
      dateTo: '2026-09-01T00:00:00.000Z',
    });

    const revenueWhere = captured.orderItemWheres.find((w) => w?.order?.orderStatus === 'DELIVERED');
    expect(revenueWhere.order.createdAt).toBeUndefined();
  });

  it('leaves pending orders unscoped so an old unfulfilled order stays visible', async () => {
    const { service, captured } = makeService();

    await service.getDashboard('user-1', {
      dateFrom: '2026-09-01T00:00:00.000Z',
      dateTo: '2026-09-30T00:00:00.000Z',
    });

    const pendingWhere = captured.orderWheres.find((w) => w?.orderStatus?.notIn);
    expect(pendingWhere.createdAt).toBeUndefined();
    // ...and it counts every in-flight status, not just the four once named.
    expect(pendingWhere.orderStatus.notIn).toEqual(['DELIVERED', 'CANCELLED', 'RETURNED']);
  });
});

describe('SellersService.getDashboard — revenue trend', () => {
  it('returns real buckets instead of an empty array', async () => {
    const { service } = makeService({
      items: [
        { totalPrice: 500, order: order('order-1', '2026-09-03T06:00:00.000Z') },
        { totalPrice: 250, order: order('order-2', '2026-09-03T09:00:00.000Z') },
        { totalPrice: 700, order: order('order-3', '2026-09-05T06:00:00.000Z') },
      ],
    });

    const trend = (
      await service.getDashboard('user-1', {
        dateFrom: '2026-09-01T00:00:00.000Z',
        dateTo: '2026-09-07T00:00:00.000Z',
      })
    ).overview.revenueTrend;

    expect(trend.length).toBeGreaterThan(0);
    const third = trend.find((b) => b.label === '3 Sep');
    expect(third).toMatchObject({ revenue: 750, orders: 2 });
    expect(trend.find((b) => b.label === '5 Sep')).toMatchObject({ revenue: 700, orders: 1 });
  });

  it('emits quiet days as zero so the x-axis keeps its shape', async () => {
    const { service } = makeService({
      items: [{ totalPrice: 500, order: order('order-1', '2026-09-03T06:00:00.000Z') }],
    });

    const trend = (
      await service.getDashboard('user-1', {
        dateFrom: '2026-09-01T00:00:00.000Z',
        dateTo: '2026-09-05T00:00:00.000Z',
      })
    ).overview.revenueTrend;

    expect(trend.map((b) => b.label)).toEqual(['1 Sep', '2 Sep', '3 Sep', '4 Sep', '5 Sep']);
    expect(trend[0].revenue).toBe(0);
  });

  it('buckets by month once the window is longer than two months', async () => {
    const { service } = makeService({
      items: [
        { totalPrice: 500, order: order('order-1', '2026-07-03T06:00:00.000Z') },
        { totalPrice: 300, order: order('order-2', '2026-09-03T06:00:00.000Z') },
      ],
    });

    const trend = (
      await service.getDashboard('user-1', {
        dateFrom: '2026-06-01T00:00:00.000Z',
        dateTo: '2026-09-30T00:00:00.000Z',
      })
    ).overview.revenueTrend;

    expect(trend.map((b) => b.label)).toEqual(['Jun 26', 'Jul 26', 'Aug 26', 'Sep 26']);
    expect(trend.find((b) => b.label === 'Jul 26')!.revenue).toBe(500);
  });

  it('buckets an order placed after midnight IST on the seller-facing day', async () => {
    // 2026-09-03T20:30:00Z is 2026-09-04 02:00 IST. A seller in Kolkata expects
    // to see it on the 4th, not the 3rd.
    const { service } = makeService({
      items: [{ totalPrice: 900, order: order('order-1', '2026-09-03T20:30:00.000Z') }],
    });

    const trend = (
      await service.getDashboard('user-1', {
        dateFrom: '2026-09-01T00:00:00.000Z',
        dateTo: '2026-09-07T00:00:00.000Z',
      })
    ).overview.revenueTrend;

    expect(trend.find((b) => b.label === '4 Sep')!.revenue).toBe(900);
    expect(trend.find((b) => b.label === '3 Sep')!.revenue).toBe(0);
  });

  it('counts orders in flight but keeps revenue to delivered only', async () => {
    const { service } = makeService({
      items: [
        { totalPrice: 500, order: order('order-1', '2026-09-03T06:00:00.000Z', 'DELIVERED') },
        { totalPrice: 400, order: order('order-2', '2026-09-03T07:00:00.000Z', 'SHIPPED') },
      ],
    });

    const trend = (
      await service.getDashboard('user-1', {
        dateFrom: '2026-09-01T00:00:00.000Z',
        dateTo: '2026-09-07T00:00:00.000Z',
      })
    ).overview.revenueTrend;

    expect(trend.find((b) => b.label === '3 Sep')).toMatchObject({ revenue: 500, orders: 2 });
  });

  it('never queries unbounded history when no range is given', async () => {
    const { service, captured } = makeService();

    await service.getDashboard('user-1');

    const trendWhere = captured.orderItemWheres.find((w) => w?.order?.orderStatus?.not === 'CANCELLED');
    expect(trendWhere.order.createdAt.gte).toBeInstanceOf(Date);
    expect(trendWhere.order.createdAt.lte).toBeInstanceOf(Date);
  });
});

import { AdminService } from './admin.service';

/**
 * The admin dashboard's headline "Platform Revenue" aggregated every order in
 * the window with no filter whatsoever:
 *
 *   this.prisma.order.aggregate({ where: dateWhere, _sum: { totalAmount: true } })
 *
 * So a cancelled order inflated it permanently, and an order nobody had paid
 * for counted exactly like a settled one. The number an admin runs the
 * business on was the sum of everything that had ever been attempted.
 */

const makeService = () => {
  const captured: any[] = [];

  const aggregate = jest.fn((args: any) => {
    captured.push(args);
    // Distinguish the two order aggregates by the filter they carry.
    return Promise.resolve({ _sum: { totalAmount: 1000, commission: 50 } });
  });

  const prisma = {
    user: { count: jest.fn().mockResolvedValue(0) },
    order: {
      count: jest.fn().mockResolvedValue(0),
      aggregate,
      findMany: jest.fn().mockResolvedValue([]),
    },
    payment: { count: jest.fn().mockResolvedValue(0) },
    sellerSettlement: { count: jest.fn().mockResolvedValue(0), aggregate },
    product: { count: jest.fn().mockResolvedValue(0) },
    ticket: { count: jest.fn().mockResolvedValue(0) },
    referralCode: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    productRequest: { count: jest.fn().mockResolvedValue(0) },
  };

  const service = new AdminService(prisma as any, {} as any, {} as any);
  return { service, captured };
};

describe('AdminService.getDashboard — revenue', () => {
  it('excludes cancelled and returned orders from revenue', async () => {
    const { service, captured } = makeService();

    await service.getDashboard({});

    const revenueQuery = captured.find(
      (a) => a?.where?.paymentStatus === 'SUCCESS' && a?._sum?.totalAmount,
    );

    expect(revenueQuery).toBeDefined();
    expect(revenueQuery.where.orderStatus.notIn).toEqual(['CANCELLED', 'RETURNED']);
  });

  it('only counts orders whose payment actually succeeded', async () => {
    const { service, captured } = makeService();

    await service.getDashboard({});

    const revenueQuery = captured.find(
      (a) => a?.where?.paymentStatus === 'SUCCESS' && a?._sum?.totalAmount,
    );

    expect(revenueQuery.where.paymentStatus).toBe('SUCCESS');
  });

  it('still reports what is owed, so nothing disappears from the page', async () => {
    const { service, captured } = makeService();

    const result: any = await service.getDashboard({});

    const pendingQuery = captured.find(
      (a) => a?.where?.paymentStatus?.not === 'SUCCESS',
    );
    expect(pendingQuery).toBeDefined();
    expect(pendingQuery.where.orderStatus.notIn).toEqual(['CANCELLED', 'RETURNED']);
    expect(result.pendingRevenue).toBe(1000);
  });

  it("reports the platform's own commission separately from turnover", async () => {
    const { service, captured } = makeService();

    const result: any = await service.getDashboard({});

    // Turnover is what buyers paid sellers; it is not the platform's income.
    const commissionQuery = captured.find((a) => a?._sum?.commission);
    expect(commissionQuery).toBeDefined();
    expect(result.platformCommission).toBe(50);
  });
});

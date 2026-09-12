import { AdminService } from './admin.service';

/**
 * The admin settlements screen summed the twenty rows it happened to be
 * showing. "Pending Payouts" therefore reported a fraction of what sellers
 * were actually owed, and the figure changed as the admin paged through.
 *
 * Money owed cannot be a per-page number, and the API was not giving the
 * screen anything else to use — it returned only { data, total, page, limit,
 * totalPages }.
 */

const makeService = () => {
  const captured: any[] = [];
  const prisma = {
    sellerSettlement: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(57),
      aggregate: jest.fn((args: any) => {
        captured.push(args);
        const paid = args.where?.payoutStatus === 'PAID';
        return Promise.resolve({ _sum: { amount: paid ? 40000 : 125000 } });
      }),
    },
  };

  const service = new AdminService(prisma as any, {} as any, {} as any);
  return { service, prisma, captured };
};

describe('AdminService.getAllSettlements — totals', () => {
  it('returns totals for the whole filtered set, not the current page', async () => {
    const { service } = makeService();

    const result: any = await service.getAllSettlements({ page: 1, limit: 20 } as any);

    // 57 settlements exist; the page holds 20. The totals must describe all 57.
    expect(result.total).toBe(57);
    expect(result.summary.pendingAmount).toBe(125000);
    expect(result.summary.paidAmount).toBe(40000);
  });

  it('counts everything not yet paid as pending, not just rows marked PENDING', async () => {
    const { service, captured } = makeService();

    await service.getAllSettlements({ page: 1, limit: 20 } as any);

    const pendingQuery = captured.find((a) => a.where?.payoutStatus?.not === 'PAID');
    expect(pendingQuery).toBeDefined();
  });

  it('applies the caller filters to the totals as well as the rows', async () => {
    const { service, captured } = makeService();

    await service.getAllSettlements({
      page: 1,
      limit: 20,
      sellerId: 'seller-1',
      dateFrom: '2026-09-01T00:00:00.000Z',
    } as any);

    // Otherwise the cards would describe a different set from the table.
    for (const call of captured) {
      expect(call.where.sellerId).toBe('seller-1');
      expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    }
  });

  it('reports zero rather than null when nothing matches', async () => {
    const prisma = {
      sellerSettlement: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
    };
    const service = new AdminService(prisma as any, {} as any, {} as any);

    const result: any = await service.getAllSettlements({ page: 1, limit: 20 } as any);

    expect(result.summary.pendingAmount).toBe(0);
    expect(result.summary.paidAmount).toBe(0);
  });
});

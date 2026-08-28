import { WebAnalyticsReportsService } from './web-analytics-reports.service';

function buildService() {
  const prisma: any = { $queryRaw: jest.fn() };
  const service = new WebAnalyticsReportsService(prisma);
  return { service, prisma };
}

const range = { from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-08-08T00:00:00.000Z') };

describe('WebAnalyticsReportsService.traffic', () => {
  it('returns current/previous KPIs, converting bigint counts to numbers', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ visitors: BigInt(10), newVisitors: BigInt(4), sessions: BigInt(12), pageviews: BigInt(50) }])
      .mockResolvedValueOnce([{ visitors: BigInt(8), newVisitors: BigInt(3), sessions: BigInt(9), pageviews: BigInt(40) }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.traffic(range);

    expect(result.current).toEqual({ visitors: 10, newVisitors: 4, sessions: 12, pageviews: 50 });
    expect(result.previous).toEqual({ visitors: 8, newVisitors: 3, sessions: 9, pageviews: 40 });
    expect(typeof result.current.visitors).toBe('number');
  });

  it('computes the previous period as the immediately preceding period of equal length', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw.mockResolvedValue([]);

    await service.traffic(range);

    const previousCallSql: any = prisma.$queryRaw.mock.calls[1][0];
    expect(previousCallSql.values).toContainEqual(new Date('2026-07-25T00:00:00.000Z'));
    expect(previousCallSql.values).toContainEqual(new Date('2026-08-01T00:00:00.000Z'));
  });

  it('returns the daily series with ISO date strings and numeric counts', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ date: new Date('2026-08-02T00:00:00.000Z'), visitors: BigInt(3), sessions: BigInt(4) }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.traffic(range);

    expect(result.daily).toEqual([{ date: '2026-08-02', visitors: 3, sessions: 4 }]);

    const dailySql: any = prisma.$queryRaw.mock.calls[2][0];
    const dailySqlText = Array.isArray(dailySql?.strings) ? dailySql.strings.join('') : String(dailySql);
    expect(dailySqlText).toContain("AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'");
  });

  it('degrades gracefully when the daily-series query fails, without losing the KPIs', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ visitors: BigInt(1), newVisitors: BigInt(1), sessions: BigInt(1), pageviews: BigInt(1) }])
      .mockResolvedValueOnce([{ visitors: BigInt(0), newVisitors: BigInt(0), sessions: BigInt(0), pageviews: BigInt(0) }])
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.traffic(range);

    expect(result.daily).toEqual([]);
    expect(result.current.visitors).toBe(1);
  });

  it('defaults an unclassified session to UNKNOWN in the channels breakdown', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ category: null, visitors: BigInt(2), sessions: BigInt(3) }])
      .mockResolvedValueOnce([]);

    const result = await service.traffic(range);

    expect(result.channels).toEqual([{ category: 'UNKNOWN', visitors: 2, sessions: 3 }]);
  });

  it('returns top referrer domains, bot-filtered and capped at 20', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ domain: 'google.com', visitors: BigInt(5), sessions: BigInt(6) }]);

    const result = await service.traffic(range);

    expect(result.referrers).toEqual([{ domain: 'google.com', visitors: 5, sessions: 6 }]);
    const referrersSql: any = prisma.$queryRaw.mock.calls[4][0];
    const sqlText = Array.isArray(referrersSql?.strings) ? referrersSql.strings.join('') : String(referrersSql);
    expect(sqlText).toContain('"isBot" = false');
    expect(sqlText).toContain('LIMIT 20');
  });

  it('degrades to null previous-period KPIs without losing current KPIs or other panels', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ visitors: BigInt(5), newVisitors: BigInt(2), sessions: BigInt(6), pageviews: BigInt(20) }])
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.traffic(range);

    expect(result.previous).toBeNull();
    expect(result.current.visitors).toBe(5);
  });
});

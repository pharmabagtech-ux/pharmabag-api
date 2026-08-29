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

describe('WebAnalyticsReportsService.audience', () => {
  it('returns device/os/browser breakdowns, converting bigint counts to numbers, defaulting nulls to Unknown', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ deviceType: 'desktop', visitors: BigInt(10), sessions: BigInt(12) }])
      .mockResolvedValueOnce([{ os: null, visitors: BigInt(2), sessions: BigInt(3) }])
      .mockResolvedValueOnce([{ browser: 'Chrome', visitors: BigInt(8), sessions: BigInt(9) }])
      .mockResolvedValueOnce([
        { totalSessions: BigInt(20), botSessions: BigInt(2), humanSessions: BigInt(18), lowEngagementSessions: BigInt(3) },
      ]);

    const result = await service.audience(range);

    expect(result.devices).toEqual([{ deviceType: 'desktop', visitors: 10, sessions: 12 }]);
    expect(result.os).toEqual([{ os: 'Unknown', visitors: 2, sessions: 3 }]);
    expect(result.browsers).toEqual([{ browser: 'Chrome', visitors: 8, sessions: 9 }]);
  });

  it('computes lowEngagementPct rounded to 1 decimal, based on human sessions only', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { totalSessions: BigInt(23), botSessions: BigInt(3), humanSessions: BigInt(20), lowEngagementSessions: BigInt(7) },
      ]);

    const result = await service.audience(range);

    expect(result.quality).toEqual({
      totalSessions: 23,
      botSessions: 3,
      humanSessions: 20,
      lowEngagementSessions: 7,
      lowEngagementPct: 35,
    });
  });

  it('returns lowEngagementPct 0 when there are no human sessions, avoiding a divide-by-zero', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { totalSessions: BigInt(5), botSessions: BigInt(5), humanSessions: BigInt(0), lowEngagementSessions: BigInt(0) },
      ]);

    const result = await service.audience(range);

    expect(result.quality.lowEngagementPct).toBe(0);
  });

  it('degrades the devices/os/browsers breakdowns gracefully on failure, without losing quality', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([
        { totalSessions: BigInt(1), botSessions: BigInt(0), humanSessions: BigInt(1), lowEngagementSessions: BigInt(0) },
      ]);

    const result = await service.audience(range);

    expect(result.devices).toEqual([]);
    expect(result.os).toEqual([]);
    expect(result.browsers).toEqual([]);
    expect(result.quality.totalSessions).toBe(1);
  });

  it('does not bot-filter the base session set in the quality query (it needs both to compute totals)', async () => {
    const { service, prisma } = buildService();
    prisma.$queryRaw.mockResolvedValue([]);

    await service.audience(range);

    const qualitySql: any = prisma.$queryRaw.mock.calls[3][0];
    const sqlText = Array.isArray(qualitySql?.strings) ? qualitySql.strings.join('') : String(qualitySql);
    expect(sqlText).not.toContain('"isBot" = false');
    expect(sqlText).toContain('FILTER (WHERE s."isBot")');
  });
});

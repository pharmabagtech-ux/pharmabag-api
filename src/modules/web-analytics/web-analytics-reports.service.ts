import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface TrafficRange {
  from: Date;
  to: Date;
}

export interface TrafficKpis {
  visitors: number;
  newVisitors: number;
  sessions: number;
  pageviews: number;
}

function previousPeriod({ from, to }: TrafficRange): TrafficRange {
  const lengthMs = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - lengthMs), to: new Date(from.getTime()) };
}

function toNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

@Injectable()
export class WebAnalyticsReportsService {
  private readonly logger = new Logger(WebAnalyticsReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async traffic(
    range: TrafficRange,
  ): Promise<{
    current: TrafficKpis;
    previous: TrafficKpis | null;
    daily: Array<{ date: string; visitors: number; sessions: number }>;
    channels: Array<{ category: string; visitors: number; sessions: number }>;
    referrers: Array<{ domain: string; visitors: number; sessions: number }>;
  }> {
    const [current, previous, daily, channels, referrers] = await Promise.all([
      this.kpis(range),
      this.kpis(previousPeriod(range)).catch((err) => {
        this.logger.error('traffic: previous-period KPI query failed', err);
        return null;
      }),
      this.dailySeries(range),
      this.channels(range),
      this.referrers(range),
    ]);
    return { current, previous, daily, channels, referrers };
  }

  // KPIs are the primary content of the page — deliberately NOT wrapped in
  // .catch(), same reasoning as the admin realtime endpoint: a genuine
  // failure here should surface as a real 500, not silently render as
  // "zero traffic".
  private async kpis({ from, to }: TrafficRange): Promise<TrafficKpis> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT
        COUNT(DISTINCT s."visitorId") AS visitors,
        COUNT(*) FILTER (WHERE s."isNewVisitor") AS "newVisitors",
        COUNT(*) AS sessions,
        COALESCE(SUM(s."pageviews"), 0) AS pageviews
      FROM "analytics_sessions" s
      WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
    `);
    const row = rows[0] ?? {};
    return {
      visitors: toNumber(row.visitors),
      newVisitors: toNumber(row.newVisitors),
      sessions: toNumber(row.sessions),
      pageviews: toNumber(row.pageviews),
    };
  }

  // Secondary breakdowns below are isolated with .catch(), same pattern as
  // Phase 1's realtime() "top pages" query — one panel failing shouldn't
  // take down the whole report.
  private dailySeries({ from, to }: TrafficRange) {
    return this.prisma
      .$queryRaw<Array<{ date: Date; visitors: bigint; sessions: bigint }>>(Prisma.sql`
        SELECT date_trunc('day', s."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') AS date,
               COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
        GROUP BY date_trunc('day', s."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
        ORDER BY date_trunc('day', s."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') ASC
      `)
      .then((rows) =>
        rows.map((r) => ({
          date: r.date.toISOString().slice(0, 10),
          visitors: toNumber(r.visitors),
          sessions: toNumber(r.sessions),
        })),
      )
      .catch((err) => {
        this.logger.error('traffic: daily-series query failed', err);
        return [] as Array<{ date: string; visitors: number; sessions: number }>;
      });
  }

  private channels({ from, to }: TrafficRange) {
    return this.prisma
      .$queryRaw<Array<{ category: string | null; visitors: bigint; sessions: bigint }>>(Prisma.sql`
        SELECT COALESCE(s."sourceCategory", 'UNKNOWN') AS category,
               COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
        GROUP BY COALESCE(s."sourceCategory", 'UNKNOWN')
        ORDER BY sessions DESC
      `)
      .then((rows) => rows.map((r) => ({ category: r.category ?? 'UNKNOWN', visitors: toNumber(r.visitors), sessions: toNumber(r.sessions) })))
      .catch((err) => {
        this.logger.error('traffic: channels query failed', err);
        return [] as Array<{ category: string; visitors: number; sessions: number }>;
      });
  }

  private referrers({ from, to }: TrafficRange) {
    return this.prisma
      .$queryRaw<Array<{ domain: string; visitors: bigint; sessions: bigint }>>(Prisma.sql`
        SELECT s."referrerDomain" AS domain,
               COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
          AND s."referrerDomain" IS NOT NULL
        GROUP BY s."referrerDomain"
        ORDER BY sessions DESC
        LIMIT 20
      `)
      .then((rows) => rows.map((r) => ({ domain: r.domain, visitors: toNumber(r.visitors), sessions: toNumber(r.sessions) })))
      .catch((err) => {
        this.logger.error('traffic: referrers query failed', err);
        return [] as Array<{ domain: string; visitors: number; sessions: number }>;
      });
  }
}

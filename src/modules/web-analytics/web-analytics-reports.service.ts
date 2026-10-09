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

  async audience(range: TrafficRange): Promise<{
    devices: Array<{ deviceType: string; visitors: number; sessions: number }>;
    os: Array<{ os: string; visitors: number; sessions: number }>;
    browsers: Array<{ browser: string; visitors: number; sessions: number }>;
    quality: {
      totalSessions: number;
      botSessions: number;
      humanSessions: number;
      lowEngagementSessions: number;
      lowEngagementPct: number;
    };
  }> {
    const [devices, os, browsers, quality] = await Promise.all([
      this.devices(range),
      this.osBreakdown(range),
      this.browsers(range),
      this.quality(range),
    ]);
    return { devices, os, browsers, quality };
  }

  private devices({ from, to }: TrafficRange) {
    return this.prisma
      .$queryRaw<Array<{ deviceType: string | null; visitors: bigint; sessions: bigint }>>(Prisma.sql`
        SELECT COALESCE(s."deviceType", 'Unknown') AS "deviceType",
               COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
        GROUP BY COALESCE(s."deviceType", 'Unknown')
        ORDER BY sessions DESC
      `)
      .then((rows) => rows.map((r) => ({ deviceType: r.deviceType ?? 'Unknown', visitors: toNumber(r.visitors), sessions: toNumber(r.sessions) })))
      .catch((err) => {
        this.logger.error('audience: devices query failed', err);
        return [] as Array<{ deviceType: string; visitors: number; sessions: number }>;
      });
  }

  private osBreakdown({ from, to }: TrafficRange) {
    return this.prisma
      .$queryRaw<Array<{ os: string | null; visitors: bigint; sessions: bigint }>>(Prisma.sql`
        SELECT COALESCE(s."os", 'Unknown') AS os,
               COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
        GROUP BY COALESCE(s."os", 'Unknown')
        ORDER BY sessions DESC
      `)
      .then((rows) => rows.map((r) => ({ os: r.os ?? 'Unknown', visitors: toNumber(r.visitors), sessions: toNumber(r.sessions) })))
      .catch((err) => {
        this.logger.error('audience: os query failed', err);
        return [] as Array<{ os: string; visitors: number; sessions: number }>;
      });
  }

  private browsers({ from, to }: TrafficRange) {
    return this.prisma
      .$queryRaw<Array<{ browser: string | null; visitors: bigint; sessions: bigint }>>(Prisma.sql`
        SELECT COALESCE(s."browser", 'Unknown') AS browser,
               COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
        GROUP BY COALESCE(s."browser", 'Unknown')
        ORDER BY sessions DESC
      `)
      .then((rows) => rows.map((r) => ({ browser: r.browser ?? 'Unknown', visitors: toNumber(r.visitors), sessions: toNumber(r.sessions) })))
      .catch((err) => {
        this.logger.error('audience: browsers query failed', err);
        return [] as Array<{ browser: string; visitors: number; sessions: number }>;
      });
  }

  // The headline number on this page — deliberately NOT wrapped in .catch(),
  // same reasoning as traffic()'s current-period KPIs: a genuine failure
  // here should surface as a real 500, not silently render as "all clean".
  //
  // Deliberately does NOT filter isBot in the base WHERE clause — this
  // query needs to see both bot and human sessions to report totals for
  // each, unlike every other query on this page which filters bots out.
  private async quality({ from, to }: TrafficRange) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH engagement AS (
        SELECT e."sessionId",
               SUM(
                 CASE
                   WHEN e."props"->>'engagedMs' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (e."props"->>'engagedMs')::numeric
                   ELSE 0
                 END
               ) AS "engagedMs"
        FROM "analytics_events" e
        WHERE e."name" = 'page_engagement' AND NOT e."isBot" AND e."ts" >= ${from} AND e."ts" < ${to}
        GROUP BY e."sessionId"
      )
      SELECT
        COUNT(*) AS "totalSessions",
        COUNT(*) FILTER (WHERE s."isBot") AS "botSessions",
        COUNT(*) FILTER (WHERE NOT s."isBot") AS "humanSessions",
        COUNT(*) FILTER (WHERE NOT s."isBot" AND COALESCE(en."engagedMs", 0) < 5000) AS "lowEngagementSessions"
      FROM "analytics_sessions" s
      LEFT JOIN engagement en ON en."sessionId" = s."id"
      WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to}
    `);
    const row = rows[0] ?? {};
    const humanSessions = toNumber(row.humanSessions);
    const lowEngagementSessions = toNumber(row.lowEngagementSessions);
    return {
      totalSessions: toNumber(row.totalSessions),
      botSessions: toNumber(row.botSessions),
      humanSessions,
      lowEngagementSessions,
      lowEngagementPct: humanSessions > 0 ? Math.round((lowEngagementSessions / humanSessions) * 1000) / 10 : 0,
    };
  }

  /* ------------------------------------------------------------------ *
   * Geography
   *
   * India-first by design: PharmaBag sells to licensed Indian businesses, so
   * the useful breakdown is by state and city within India, with the rest of
   * the world collapsed into a single comparison row. States and cities are
   * therefore filtered to countryCode = 'IN' — mixing a Gujarat row and a
   * Dubai row into one "regions" list would make neither readable.
   *
   * Sessions with no resolved location surface as 'Unknown' rather than being
   * dropped, so these totals stay reconcilable with the traffic report.
   * ------------------------------------------------------------------ */

  async geography(range: TrafficRange): Promise<{
    countries: Array<{ name: string; code: string | null; visitors: number; sessions: number }>;
    states: Array<{ name: string; code: string | null; visitors: number; sessions: number }>;
    cities: Array<{ name: string; region: string | null; visitors: number; sessions: number }>;
    coverage: { resolvedSessions: number; unresolvedSessions: number; resolvedPct: number };
  }> {
    const [countries, states, cities, coverage] = await Promise.all([
      this.countries(range),
      this.indiaStates(range),
      this.indiaCities(range),
      this.geoCoverage(range),
    ]);
    return { countries, states, cities, coverage };
  }

  private countries({ from, to }: TrafficRange) {
    return this.prisma
      .$queryRaw<Array<{ name: string | null; code: string | null; visitors: bigint; sessions: bigint }>>(Prisma.sql`
        SELECT COALESCE(s."country", 'Unknown') AS name,
               MAX(s."countryCode") AS code,
               COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
        GROUP BY COALESCE(s."country", 'Unknown')
        ORDER BY sessions DESC
        LIMIT 100
      `)
      .then((rows) =>
        rows.map((r) => ({
          name: r.name ?? 'Unknown',
          code: r.code ?? null,
          visitors: toNumber(r.visitors),
          sessions: toNumber(r.sessions),
        })),
      )
      .catch((err) => {
        this.logger.error('geography: countries query failed', err);
        return [] as Array<{ name: string; code: string | null; visitors: number; sessions: number }>;
      });
  }

  private indiaStates({ from, to }: TrafficRange) {
    return this.prisma
      .$queryRaw<Array<{ name: string | null; code: string | null; visitors: bigint; sessions: bigint }>>(Prisma.sql`
        SELECT COALESCE(s."region", 'Unknown') AS name,
               MAX(s."regionCode") AS code,
               COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to}
          AND s."isBot" = false
          AND s."countryCode" = 'IN'
        GROUP BY COALESCE(s."region", 'Unknown')
        ORDER BY sessions DESC
        LIMIT 60
      `)
      .then((rows) =>
        rows.map((r) => ({
          name: r.name ?? 'Unknown',
          code: r.code ?? null,
          visitors: toNumber(r.visitors),
          sessions: toNumber(r.sessions),
        })),
      )
      .catch((err) => {
        this.logger.error('geography: states query failed', err);
        return [] as Array<{ name: string; code: string | null; visitors: number; sessions: number }>;
      });
  }

  private indiaCities({ from, to }: TrafficRange) {
    return this.prisma
      .$queryRaw<Array<{ name: string | null; region: string | null; visitors: bigint; sessions: bigint }>>(Prisma.sql`
        SELECT s."city" AS name,
               MAX(s."region") AS region,
               COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to}
          AND s."isBot" = false
          AND s."countryCode" = 'IN'
          AND s."city" IS NOT NULL
        GROUP BY s."city"
        ORDER BY sessions DESC
        LIMIT 100
      `)
      .then((rows) =>
        rows.map((r) => ({
          name: r.name ?? 'Unknown',
          region: r.region ?? null,
          visitors: toNumber(r.visitors),
          sessions: toNumber(r.sessions),
        })),
      )
      .catch((err) => {
        this.logger.error('geography: cities query failed', err);
        return [] as Array<{ name: string; region: string | null; visitors: number; sessions: number }>;
      });
  }

  /**
   * How much of the traffic actually got a location. Surfaced in the UI so a
   * half-empty report reads as "geo database missing or IPs unresolvable",
   * not as "nobody visited from anywhere".
   */
  private geoCoverage({ from, to }: TrafficRange) {
    return this.prisma
      .$queryRaw<Array<{ resolved: bigint; unresolved: bigint }>>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE s."countryCode" IS NOT NULL) AS resolved,
               COUNT(*) FILTER (WHERE s."countryCode" IS NULL) AS unresolved
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
      `)
      .then((rows) => {
        const resolvedSessions = toNumber(rows[0]?.resolved);
        const unresolvedSessions = toNumber(rows[0]?.unresolved);
        const total = resolvedSessions + unresolvedSessions;
        return {
          resolvedSessions,
          unresolvedSessions,
          resolvedPct: total > 0 ? Math.round((resolvedSessions / total) * 1000) / 10 : 0,
        };
      })
      .catch((err) => {
        this.logger.error('geography: coverage query failed', err);
        return { resolvedSessions: 0, unresolvedSessions: 0, resolvedPct: 0 };
      });
  }

  /**
   * Where the visitors to one product came from.
   *
   * Matched on EITHER the event's `productId` or the product page's path,
   * OR'd together, because the two identify the same traffic by different
   * means and each alone has a gap:
   *
   *  - `productId` is precise but only present on events the tracker tags with
   *    a product, which nothing emitted until now — so on its own it would
   *    report nothing for every historical visit.
   *  - `page` has been recorded for every page view since tracking began, so
   *    matching `/products/<slug>` works retroactively. But it breaks if the
   *    slug is later renamed (bulk uploads do rewrite slugs, which is why the
   *    redirects manager exists), and it cannot see product interest expressed
   *    anywhere other than the detail page.
   *
   * Together they cover both: existing data is readable immediately via the
   * path, and precision improves as product-tagged events accumulate.
   * `DISTINCT e."visitorId"` keeps a visitor counted once even when both
   * predicates match the same event.
   *
   * `views` counts matching events; `visitors` counts distinct people, which is
   * the number to compare cities on, since one buyer refreshing repeatedly
   * would otherwise look like a city full of demand.
   */
  async productGeography(
    match: { productId?: string; path?: string },
    { from, to }: TrafficRange,
  ): Promise<{
    totals: { views: number; visitors: number };
    countries: Array<{ name: string; visitors: number; views: number }>;
    states: Array<{ name: string; visitors: number; views: number }>;
    cities: Array<{ name: string; region: string | null; visitors: number; views: number }>;
  }> {
    const empty = {
      totals: { views: 0, visitors: 0 },
      countries: [] as Array<{ name: string; visitors: number; views: number }>,
      states: [] as Array<{ name: string; visitors: number; views: number }>,
      cities: [] as Array<{ name: string; region: string | null; visitors: number; views: number }>,
    };

    // Guard rather than build `WHERE (false)`: with neither identifier the
    // honest answer is "no data", not every event ever recorded.
    const predicates: Prisma.Sql[] = [];
    if (match.productId) predicates.push(Prisma.sql`e."productId" = ${match.productId}`);
    if (match.path) predicates.push(Prisma.sql`e."page" = ${match.path}`);
    if (predicates.length === 0) return empty;

    const identifies = predicates.reduce((acc, p, i) => (i === 0 ? p : Prisma.sql`${acc} OR ${p}`));

    const base = Prisma.sql`
      FROM "analytics_events" e
      JOIN "analytics_sessions" s ON s."id" = e."sessionId"
      WHERE (${identifies})
        AND e."ts" >= ${from} AND e."ts" < ${to}
        AND e."isBot" = false
        AND s."isBot" = false
    `;

    const [totals, countries, states, cities] = await Promise.all([
      this.prisma
        .$queryRaw<Array<{ views: bigint; visitors: bigint }>>(Prisma.sql`
          SELECT COUNT(*) AS views, COUNT(DISTINCT e."visitorId") AS visitors ${base}
        `)
        .then((rows) => ({ views: toNumber(rows[0]?.views), visitors: toNumber(rows[0]?.visitors) }))
        .catch((err) => {
          this.logger.error('productGeography: totals query failed', err);
          return { views: 0, visitors: 0 };
        }),

      this.prisma
        .$queryRaw<Array<{ name: string | null; visitors: bigint; views: bigint }>>(Prisma.sql`
          SELECT COALESCE(s."country", 'Unknown') AS name,
                 COUNT(DISTINCT e."visitorId") AS visitors,
                 COUNT(*) AS views
          ${base}
          GROUP BY COALESCE(s."country", 'Unknown')
          ORDER BY visitors DESC
          LIMIT 50
        `)
        .then((rows) =>
          rows.map((r) => ({ name: r.name ?? 'Unknown', visitors: toNumber(r.visitors), views: toNumber(r.views) })),
        )
        .catch((err) => {
          this.logger.error('productGeography: countries query failed', err);
          return [] as Array<{ name: string; visitors: number; views: number }>;
        }),

      this.prisma
        .$queryRaw<Array<{ name: string | null; visitors: bigint; views: bigint }>>(Prisma.sql`
          SELECT COALESCE(s."region", 'Unknown') AS name,
                 COUNT(DISTINCT e."visitorId") AS visitors,
                 COUNT(*) AS views
          ${base} AND s."countryCode" = 'IN'
          GROUP BY COALESCE(s."region", 'Unknown')
          ORDER BY visitors DESC
          LIMIT 60
        `)
        .then((rows) =>
          rows.map((r) => ({ name: r.name ?? 'Unknown', visitors: toNumber(r.visitors), views: toNumber(r.views) })),
        )
        .catch((err) => {
          this.logger.error('productGeography: states query failed', err);
          return [] as Array<{ name: string; visitors: number; views: number }>;
        }),

      this.prisma
        .$queryRaw<Array<{ name: string | null; region: string | null; visitors: bigint; views: bigint }>>(Prisma.sql`
          SELECT s."city" AS name,
                 MAX(s."region") AS region,
                 COUNT(DISTINCT e."visitorId") AS visitors,
                 COUNT(*) AS views
          ${base} AND s."countryCode" = 'IN' AND s."city" IS NOT NULL
          GROUP BY s."city"
          ORDER BY visitors DESC
          LIMIT 100
        `)
        .then((rows) =>
          rows.map((r) => ({
            name: r.name ?? 'Unknown',
            region: r.region ?? null,
            visitors: toNumber(r.visitors),
            views: toNumber(r.views),
          })),
        )
        .catch((err) => {
          this.logger.error('productGeography: cities query failed', err);
          return [] as Array<{ name: string; region: string | null; visitors: number; views: number }>;
        }),
    ]);

    return { totals, countries, states, cities };
  }
}

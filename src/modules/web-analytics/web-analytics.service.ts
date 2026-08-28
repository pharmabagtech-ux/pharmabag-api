import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CollectBatchDto } from './dto/collect-batch.dto';
import { isBotUserAgent } from './bot-detector';
import { classifySource } from './source-classifier';

@Injectable()
export class WebAnalyticsService {
  private readonly logger = new Logger(WebAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Known limitation, accepted deliberately: concurrent flushes for the same
  // visitor/session could race a findUnique-then-create and fail a batch with
  // a unique-constraint error. Acceptable for analytics data — the
  // transaction rolls back atomically, so worst case is a dropped batch,
  // never corrupted data.
  async ingest(batch: CollectBatchDto): Promise<void> {
    const isBot = isBotUserAgent(batch.ua);
    const now = new Date();
    const pageViewCount = batch.events.filter((e) => e.name === 'page_view').length;
    const lastEvent = batch.events[batch.events.length - 1];

    await this.prisma.$transaction(async (tx) => {
      const existingVisitor = await tx.webVisitor.findUnique({ where: { id: batch.visitor.id } });
      const existingSession = await tx.webSession.findUnique({ where: { id: batch.session.id } });

      if (!existingVisitor) {
        await tx.webVisitor.create({
          data: {
            id: batch.visitor.id,
            userId: batch.session.userId,
            firstSource: batch.session.source,
            firstMedium: batch.session.medium,
            firstCampaign: batch.session.campaign,
            firstReferrer: batch.session.referrer,
            firstLanding: batch.session.landingPage,
            sessionsCount: 1,
            pageviewsCount: pageViewCount,
            isBot,
          },
        });
      } else {
        await tx.webVisitor.update({
          where: { id: batch.visitor.id },
          data: {
            lastSeenAt: now,
            pageviewsCount: { increment: pageViewCount },
            ...(batch.session.userId ? { userId: batch.session.userId } : {}),
            ...(!existingSession ? { sessionsCount: { increment: 1 } } : {}),
          },
        });
      }

      if (!existingSession) {
        const classified = classifySource({
          referrer: batch.session.referrer,
          utmSource: batch.session.source,
          utmMedium: batch.session.medium,
          clickIds: batch.session.clickIds,
        });
        await tx.webSession.create({
          data: {
            id: batch.session.id,
            visitorId: batch.visitor.id,
            userId: batch.session.userId,
            entryPage: batch.session.landingPage,
            pageviews: pageViewCount,
            events: batch.events.length,
            source: batch.session.source,
            medium: batch.session.medium,
            campaign: batch.session.campaign,
            referrer: batch.session.referrer,
            clickIds: batch.session.clickIds,
            userAgent: batch.ua,
            isNewVisitor: !existingVisitor,
            isBot,
            sourceCategory: classified.category,
            referrerDomain: classified.referrerDomain,
          },
        });
      } else {
        await tx.webSession.update({
          where: { id: batch.session.id },
          data: {
            lastEventAt: now,
            pageviews: { increment: pageViewCount },
            events: { increment: batch.events.length },
            ...(lastEvent?.page ? { exitPage: lastEvent.page } : {}),
            ...(batch.session.userId ? { userId: batch.session.userId } : {}),
          },
        });
      }

      if (batch.events.length > 0) {
        await tx.webEvent.createMany({
          data: batch.events.map((e) => ({
            visitorId: batch.visitor.id,
            sessionId: batch.session.id,
            name: e.name,
            ts: new Date(e.ts),
            page: e.page,
            productId: e.productId,
            props: e.props as Prisma.InputJsonValue | undefined,
            isBot,
          })),
        });
      }
    });
  }

  async realtime() {
    const since = new Date(Date.now() - 5 * 60 * 1000);

    const [active, rawPages, recent] = await Promise.all([
      this.prisma.webSession.groupBy({
        by: ['visitorId'],
        where: { lastEventAt: { gte: since }, isBot: false },
      }),
      this.prisma
        .$queryRaw<Array<{ page: string; visitors: bigint }>>(
          Prisma.sql`
        SELECT e."page", COUNT(DISTINCT e."visitorId") AS visitors
        FROM "analytics_events" e
        WHERE e."ts" >= ${since} AND e."page" IS NOT NULL AND e."isBot" = false
        GROUP BY e."page" ORDER BY visitors DESC LIMIT 10
      `,
        )
        .catch((err) => {
          this.logger.error('realtime: top-pages query failed', err);
          return [] as Array<{ page: string; visitors: bigint }>;
        }),
      this.prisma.webEvent.findMany({
        where: { ts: { gte: since }, isBot: false },
        orderBy: { ts: 'desc' },
        take: 30,
        select: { name: true, ts: true, page: true, productId: true },
      }),
    ]);

    // Postgres COUNT(...) comes back as a bigint via node-postgres/Prisma,
    // which JSON.stringify cannot serialize — convert before returning.
    const topPages = rawPages.map((row) => ({ page: row.page, visitors: Number(row.visitors) }));

    return { activeVisitors: active.length, topPages, recentEvents: recent };
  }
}

import { WebAnalyticsService } from './web-analytics.service';
import type { CollectBatchDto } from './dto/collect-batch.dto';

function buildService() {
  const tx: any = {
    webVisitor: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    webSession: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    webEvent: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma: any = {
    $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
  };
  const service = new WebAnalyticsService(prisma);
  return { service, prisma, tx };
}

const batch = (over: Partial<CollectBatchDto> = {}): CollectBatchDto =>
  ({
    visitor: { id: 'visitor-1' },
    session: {
      id: 'session-1',
      landingPage: '/products/foo',
      source: 'google',
      medium: 'cpc',
      campaign: 'summer-sale',
    },
    events: [{ name: 'page_view', ts: Date.now(), page: '/products/foo' }],
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    ...over,
  }) as CollectBatchDto;

describe('WebAnalyticsService.ingest', () => {
  it('creates a new visitor and session on first sight, with attribution captured', async () => {
    const { service, tx } = buildService();

    await service.ingest(batch());

    expect(tx.webVisitor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'visitor-1',
          firstSource: 'google',
          firstMedium: 'cpc',
          firstCampaign: 'summer-sale',
          firstLanding: '/products/foo',
          sessionsCount: 1,
          pageviewsCount: 1,
          isBot: false,
        }),
      }),
    );
    expect(tx.webSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'session-1',
          visitorId: 'visitor-1',
          entryPage: '/products/foo',
          isNewVisitor: true,
          isBot: false,
        }),
      }),
    );
    expect(tx.webEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            visitorId: 'visitor-1',
            sessionId: 'session-1',
            name: 'page_view',
            page: '/products/foo',
            isBot: false,
          }),
        ],
      }),
    );
  });

  it('updates an existing visitor/session instead of re-creating them', async () => {
    const { service, tx } = buildService();
    tx.webVisitor.findUnique.mockResolvedValue({ id: 'visitor-1' });
    tx.webSession.findUnique.mockResolvedValue({ id: 'session-1' });

    await service.ingest(batch());

    expect(tx.webVisitor.create).not.toHaveBeenCalled();
    expect(tx.webVisitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visitor-1' },
        data: expect.objectContaining({ pageviewsCount: { increment: 1 } }),
      }),
    );
    expect(tx.webSession.create).not.toHaveBeenCalled();
    expect(tx.webSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: expect.objectContaining({
          pageviews: { increment: 1 },
          events: { increment: 1 },
        }),
      }),
    );
  });

  it('increments WebVisitor.sessionsCount only when the session row is newly created', async () => {
    const { service, tx } = buildService();
    // Visitor already exists, but this session id is new (e.g. returned after
    // 30+ minutes away) — sessionsCount must still go up.
    tx.webVisitor.findUnique.mockResolvedValue({ id: 'visitor-1' });
    tx.webSession.findUnique.mockResolvedValue(null);

    await service.ingest(batch());

    expect(tx.webSession.create).toHaveBeenCalled();
    expect(tx.webVisitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visitor-1' },
        data: expect.objectContaining({ sessionsCount: { increment: 1 } }),
      }),
    );
  });

  it('stamps isBot from the User-Agent onto the visitor, session, and every event', async () => {
    const { service, tx } = buildService();

    await service.ingest(batch({ ua: 'Googlebot/2.1' }));

    expect(tx.webVisitor.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isBot: true }) }),
    );
    expect(tx.webSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isBot: true }) }),
    );
    expect(tx.webEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ isBot: true })] }),
    );
  });

  it('propagates session.userId onto both the visitor and the session, once identified', async () => {
    const { service, tx } = buildService();
    tx.webVisitor.findUnique.mockResolvedValue({ id: 'visitor-1' });
    tx.webSession.findUnique.mockResolvedValue({ id: 'session-1' });

    await service.ingest(batch({ session: { id: 'session-1', userId: 'user-42' } as any }));

    expect(tx.webVisitor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-42' }) }),
    );
    expect(tx.webSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-42' }) }),
    );
  });

  it('does nothing if the batch has zero events beyond the visitor/session touch', async () => {
    const { service, tx } = buildService();

    await service.ingest(batch({ events: [] }));

    expect(tx.webEvent.createMany).not.toHaveBeenCalled();
  });

  it('counts only page_view events toward pageviewsCount/pageviews, not the whole batch', async () => {
    const { service, tx } = buildService();

    await service.ingest(
      batch({
        events: [
          { name: 'page_view', ts: Date.now(), page: '/a' },
          { name: 'click', ts: Date.now(), page: '/a' },
          { name: 'click', ts: Date.now(), page: '/a' },
        ] as any,
      }),
    );

    expect(tx.webVisitor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pageviewsCount: 1 }),
      }),
    );
    expect(tx.webSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pageviews: 1, events: 3 }),
      }),
    );
  });

  it('passes productId and props through onto the created event', async () => {
    const { service, tx } = buildService();

    await service.ingest(
      batch({
        events: [
          {
            name: 'product_view',
            ts: Date.now(),
            page: '/products/foo',
            productId: 'prod-123',
            props: { source: 'search' },
          },
        ] as any,
      }),
    );

    expect(tx.webEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            productId: 'prod-123',
            props: { source: 'search' },
          }),
        ],
      }),
    );
  });

  it('stamps exitPage from the last event onto the session update', async () => {
    const { service, tx } = buildService();
    tx.webVisitor.findUnique.mockResolvedValue({ id: 'visitor-1' });
    tx.webSession.findUnique.mockResolvedValue({ id: 'session-1' });

    await service.ingest(
      batch({
        events: [
          { name: 'page_view', ts: Date.now(), page: '/products/foo' },
          { name: 'page_view', ts: Date.now(), page: '/checkout' },
        ] as any,
      }),
    );

    expect(tx.webSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: expect.objectContaining({ exitPage: '/checkout' }),
      }),
    );
  });
});

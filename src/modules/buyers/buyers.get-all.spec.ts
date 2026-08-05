import { BuyersService } from './buyers.service';

/**
 * The admin Buyers list must be narrowed by the database, not by the browser.
 *
 * `getAllBuyers` accepted only page and limit, so the admin panel filtered the
 * rows it had already been given. That reaches one page of buyers at a time
 * while the pager keeps counting every buyer, so a search for a phone number
 * belonging to someone further down the list came back empty and still offered
 * more pages.
 *
 * Two things are pinned here:
 *   - what `search` matches: phone and email live on the related user, the
 *     profile carries legalName (plus GST/PAN, which admins search by)
 *   - that `count` is given the SAME where as `findMany`. Filtering the rows
 *     but counting all of them is the exact defect this replaces — the pager
 *     would keep describing a set the table no longer shows.
 */
function buildService() {
  const prisma: any = {
    buyerProfile: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new BuyersService(prisma, {} as any);
  return { service, prisma };
}

const whereOf = (prisma: any) => prisma.buyerProfile.findMany.mock.calls[0][0].where;
const countWhereOf = (prisma: any) => prisma.buyerProfile.count.mock.calls[0][0].where;

describe('getAllBuyers — filtering happens in the query', () => {
  it('matches a search against the profile name and the related user phone/email', async () => {
    const { service, prisma } = buildService();
    await service.getAllBuyers(1, 20, { search: '6289' });

    const or = whereOf(prisma).OR;
    expect(or).toEqual(
      expect.arrayContaining([
        { legalName: { contains: '6289', mode: 'insensitive' } },
        { user: { phone: { contains: '6289', mode: 'insensitive' } } },
        { user: { email: { contains: '6289', mode: 'insensitive' } } },
      ]),
    );
  });

  it('counts the same set it returns', async () => {
    const { service, prisma } = buildService();
    await service.getAllBuyers(1, 20, { search: '6289' });

    // If these ever diverge the pager starts lying again.
    expect(countWhereOf(prisma)).toEqual(whereOf(prisma));
  });

  it('applies no filter at all when nothing was asked for', async () => {
    const { service, prisma } = buildService();
    await service.getAllBuyers(1, 20);

    expect(whereOf(prisma)).toEqual({});
    expect(countWhereOf(prisma)).toEqual({});
  });

  it('accepts a verification status in any case and ignores an unknown one', async () => {
    const { service, prisma } = buildService();
    await service.getAllBuyers(1, 20, { verificationStatus: 'pending' });
    expect(whereOf(prisma).verificationStatus).toBe('PENDING');

    const junk = buildService();
    await junk.service.getAllBuyers(1, 20, { verificationStatus: 'NOT_A_STATUS' });
    expect(whereOf(junk.prisma).verificationStatus).toBeUndefined();
  });

  it('reads the admin\'s "none" tier as no tier, not as a tier named none', async () => {
    const { service, prisma } = buildService();
    await service.getAllBuyers(1, 20, { creditTier: 'none' });
    expect(whereOf(prisma).creditTier).toBeNull();

    const real = buildService();
    await real.service.getAllBuyers(1, 20, { creditTier: 'emi' });
    expect(whereOf(real.prisma).creditTier).toBe('EMI');
  });

  it('still paginates', async () => {
    const { service, prisma } = buildService();
    await service.getAllBuyers(3, 20, {});

    const args = prisma.buyerProfile.findMany.mock.calls[0][0];
    expect(args.skip).toBe(40);
    expect(args.take).toBe(20);
  });
});

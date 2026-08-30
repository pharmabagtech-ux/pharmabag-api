import { AdminService } from './admin.service';

/**
 * The admin panel calls `GET /admin/users/sellers`, but that route never
 * existed — the path fell through to `users/:id` with id="sellers" and failed
 * UUID validation. The frontend swallowed the error into an empty list, so the
 * User Management page's vacation count read 0 no matter how many sellers were
 * actually on vacation.
 *
 * This pins the service method the new route delegates to:
 *   - rows come from seller_profiles with the related user attached, because
 *     the page keys its merge by USER id and renders phone/email from the user
 *   - `isVacation` filtering happens in the query
 *   - search spans companyName/GST/PAN plus the user's phone/email, matching
 *     the buyers list (`getAllBuyers`) it mirrors
 *   - count gets the SAME where as findMany, so the pager can't lie
 */
function buildService() {
  const prisma: any = {
    sellerProfile: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new AdminService(prisma, {} as any, {} as any);
  return { service, prisma };
}

const findArgs = (prisma: any) => prisma.sellerProfile.findMany.mock.calls[0][0];
const whereOf = (prisma: any) => findArgs(prisma).where;
const countWhereOf = (prisma: any) => prisma.sellerProfile.count.mock.calls[0][0].where;

describe('getAllSellers — the admin sellers list the panel already calls', () => {
  it('includes the related user, because the page merges by user id', async () => {
    const { service, prisma } = buildService();
    await service.getAllSellers({});

    const include = findArgs(prisma).include;
    expect(include.user.select).toEqual(
      expect.objectContaining({ id: true, phone: true, email: true, status: true }),
    );
  });

  it('filters vacation sellers in the query', async () => {
    const { service, prisma } = buildService();
    await service.getAllSellers({ isVacation: 'true' });
    expect(whereOf(prisma).isVacation).toBe(true);

    const off = buildService();
    await off.service.getAllSellers({ isVacation: 'false' });
    expect(whereOf(off.prisma).isVacation).toBe(false);

    const unfiltered = buildService();
    await unfiltered.service.getAllSellers({});
    expect(whereOf(unfiltered.prisma).isVacation).toBeUndefined();
  });

  it('matches a search against company name, GST/PAN and the user phone/email', async () => {
    const { service, prisma } = buildService();
    await service.getAllSellers({ search: 'jaiswal' });

    expect(whereOf(prisma).OR).toEqual(
      expect.arrayContaining([
        { companyName: { contains: 'jaiswal', mode: 'insensitive' } },
        { gstNumber: { contains: 'jaiswal', mode: 'insensitive' } },
        { panNumber: { contains: 'jaiswal', mode: 'insensitive' } },
        { user: { phone: { contains: 'jaiswal', mode: 'insensitive' } } },
        { user: { email: { contains: 'jaiswal', mode: 'insensitive' } } },
      ]),
    );
  });

  it('accepts a verification status and applies it uppercased', async () => {
    const { service, prisma } = buildService();
    await service.getAllSellers({ status: 'verified' });
    expect(whereOf(prisma).verificationStatus).toBe('VERIFIED');
  });

  it('counts the same set it returns', async () => {
    const { service, prisma } = buildService();
    await service.getAllSellers({ search: 'jaiswal', isVacation: 'true' });
    expect(countWhereOf(prisma)).toEqual(whereOf(prisma));
  });

  it('paginates and reports the total', async () => {
    const { service, prisma } = buildService();
    prisma.sellerProfile.count.mockResolvedValue(41);
    const result = await service.getAllSellers({ page: 3, limit: 20 });

    expect(findArgs(prisma).skip).toBe(40);
    expect(findArgs(prisma).take).toBe(20);
    expect(result.total).toBe(41);
    expect(result.totalPages).toBe(3);
  });
});

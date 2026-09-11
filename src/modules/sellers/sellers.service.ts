import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IdfyService } from '../verification/idfy.service';
import { CreateSellerProfileDto } from './dto/create-seller-profile.dto';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idfyService: IdfyService,
  ) {}

  /**
   * Create a new seller profile for an authenticated SELLER user.
   * Verifies GST via IDFY; blocks creation on verification failure (legacy behavior).
   * Sets verificationStatus = PENDING after successful IDFY check.
   */
  async createProfile(userId: string, dto: CreateSellerProfileDto) {
    const existing = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException('Seller profile already exists');
    }

    if (!dto.gstNumber && !dto.panNumber) {
      throw new BadRequestException(
        'Either GST number or PAN number is required',
      );
    }

    // IDFY verification — BLOCK on failure (legacy behavior).
    // GST is preferred when supplied; PAN-only sellers verify against PAN.
    let gstPanResponse: any = null;
    if (this.idfyService.isConfigured()) {
      if (dto.gstNumber) {
        const result = await this.idfyService.verifyGst(dto.gstNumber);
        if (!result.status) {
          throw new BadRequestException(result.message || 'GST verification failed');
        }
        gstPanResponse = result;
      } else if (dto.panNumber) {
        const result = await this.idfyService.verifyPan(dto.panNumber);
        if (!result.status) {
          throw new BadRequestException(result.message || 'PAN verification failed');
        }
        gstPanResponse = result;
      }
    }

    const profile = await this.prisma.sellerProfile.create({
      data: {
        userId,
        companyName: dto.companyName,
        // Columns are NOT NULL; a seller may supply only one of the two.
        gstNumber: dto.gstNumber ?? '',
        panNumber: dto.panNumber ?? '',
        drugLicenseNumber: dto.drugLicenseNumber,
        drugLicenseUrl: dto.drugLicenseUrl,
        drugLicenseExpiry: dto.drugLicenseExpiry ? new Date(dto.drugLicenseExpiry) : null,
        drugLicenseNumber2: dto.drugLicenseNumber2 ?? null,
        drugLicenseUrl2: dto.drugLicenseUrl2 ?? null,
        drugLicenseExpiry2: dto.drugLicenseExpiry2 ? new Date(dto.drugLicenseExpiry2) : null,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        // @ts-ignore
        email: dto.email,
        // @ts-ignore
        fssaiNumber: dto.fssaiNumber,
        // @ts-ignore
        bankAccount: dto.bankAccount,
        // @ts-ignore
        cancelCheck: dto.cancelCheck,
        gstPanResponse,
        verificationStatus: gstPanResponse ? 'PENDING' : 'UNVERIFIED',
        rating: 0,
      },
    });

    this.logger.log(`Seller profile created for user ${userId}`);
    return profile;
  }

  /**
   * Get the seller profile for an authenticated user.
   */
  async getProfile(userId: string) {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            phone: true,
            email: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Seller profile not found');
    }

    return {
      ...profile,
      phone: profile.user?.phone,
      email: profile.email || profile.user?.email,
      status: profile.user?.status,
      userCreatedAt: profile.user?.createdAt,
    };
  }

  /**
   * Partially update the seller profile.
   */
  async updateProfile(userId: string, dto: UpdateSellerProfileDto) {
    const existing = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw new NotFoundException(
        'Seller profile not found. Create a profile first.',
      );
    }

    const isFirstUpdate = existing.verificationStatus === 'UNVERIFIED';

    if (isFirstUpdate) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: 'PENDING' },
      });
    }

    const profile = await this.prisma.sellerProfile.update({
      where: { userId },
      data: {
        ...dto,
        drugLicenseExpiry: dto.drugLicenseExpiry ? new Date(dto.drugLicenseExpiry) : undefined,
        drugLicenseExpiry2: dto.drugLicenseExpiry2 ? new Date(dto.drugLicenseExpiry2) : undefined,
        // @ts-ignore
        email: dto.email,
        // @ts-ignore
        fssaiNumber: dto.fssaiNumber,
        // @ts-ignore
        bankAccount: dto.bankAccount,
        // @ts-ignore
        cancelCheck: dto.cancelCheck,
        ...(isFirstUpdate && { verificationStatus: 'PENDING' }),
      },
    });

    this.logger.log(`Seller profile updated for user ${userId}`);
    return profile;
  }

  /**
   * Get seller dashboard metrics, optionally scoped to a date range.
   *
   * Which numbers the range applies to:
   *   - scoped:   totalOrders, totalRevenue and the revenue trend. These are
   *               "how did I do over this period" figures.
   *   - all-time: activeListings, totalProducts, lowStockItems, pendingPayouts,
   *               avgRating and pendingOrders. Stock levels and an outstanding
   *               balance have no period, and pendingOrders is a to-do queue —
   *               scoping it would hide an old unfulfilled order from the
   *               seller, which is the opposite of useful.
   *
   * Dates are bucketed in IST, not in the server's timezone, so an order placed
   * at 1am IST lands on the day the seller thinks it did.
   */
  async getDashboard(
    userId: string,
    range: { dateFrom?: string; dateTo?: string } = {},
  ) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    const { from, to } = this.resolveRange(range.dateFrom, range.dateTo);

    // Applied to Order.createdAt (which is indexed), not OrderItem.createdAt,
    // so "orders in this window" means the window the buyer placed them in.
    const placedInRange =
      from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {};

    const [
      totalProducts,
      activeListings,
      totalOrders,
      pendingOrders,
      totalRevenue,
      pendingPayouts,
      lowStockItems,
    ] = await Promise.all([
      this.prisma.product.count({ where: { sellerId: seller.id } }),
      this.prisma.product.count({
        where: { sellerId: seller.id, isActive: true, deletedAt: null },
      }),
      this.prisma.order.count({
        where: { items: { some: { sellerId: seller.id } }, ...placedInRange },
      }),
      // Anything not finished is still on the seller's plate. The old list named
      // four statuses explicitly and so silently omitted PAYMENT_RECEIVED,
      // READY_TO_SHIP, DISPATCHED_FROM_SELLER and RECEIVED_AT_WAREHOUSE.
      this.prisma.order.count({
        where: {
          items: { some: { sellerId: seller.id } },
          orderStatus: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] },
        },
      }),
      this.prisma.orderItem.aggregate({
        where: {
          sellerId: seller.id,
          order: { orderStatus: 'DELIVERED', ...placedInRange },
        },
        _sum: { totalPrice: true },
      }),
      this.prisma.sellerSettlement.aggregate({
        where: { sellerId: seller.id, payoutStatus: 'PENDING' },
        _sum: { amount: true },
      }),
      this.prisma.productBatch.count({
        where: { product: { sellerId: seller.id }, stock: { lt: 10 } },
      }),
    ]);

    // Five most recent ORDERS, not five most recent order items. The old query
    // took five items, so a single order containing five of this seller's
    // products filled the whole "Recent Orders" table with itself.
    const recentOrders = await this.prisma.order.findMany({
      where: { items: { some: { sellerId: seller.id } }, ...placedInRange },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderStatus: true,
        paymentStatus: true,
        createdAt: true,
        items: {
          where: { sellerId: seller.id },
          select: { quantity: true, totalPrice: true, product: { select: { name: true } } },
        },
      },
    });

    return {
      stats: {
        totalProducts,
        activeListings,
        totalOrders,
        pendingOrders,
        totalRevenue: totalRevenue._sum.totalPrice || 0,
        pendingPayouts: pendingPayouts._sum.amount || 0,
        avgRating: seller.rating,
        lowStockItems,
      },
      range: {
        dateFrom: from ? from.toISOString() : null,
        dateTo: to ? to.toISOString() : null,
      },
      overview: {
        orders: recentOrders.map((order) => {
          const amount = order.items.reduce((sum, i) => sum + i.totalPrice, 0);
          const quantity = order.items.reduce((sum, i) => sum + i.quantity, 0);
          const firstName = order.items[0]?.product?.name ?? 'Order';
          return {
            id: order.id,
            productName:
              order.items.length > 1
                ? `${firstName} +${order.items.length - 1} more`
                : firstName,
            quantity,
            amount,
            // Kept so a seller app built against the old response shape still
            // renders an amount; the two repos deploy independently.
            totalPrice: amount,
            status: order.orderStatus,
            paymentStatus: order.paymentStatus,
            createdAt: order.createdAt,
          };
        }),
        revenueTrend: await this.buildRevenueTrend(seller.id, from, to),
      },
    };
  }

  private static readonly IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;
  private static readonly MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  /**
   * Parse the incoming range. Anything unusable (unparseable date, from after
   * to) is dropped rather than thrown: a bad query string should show the
   * seller their all-time numbers, not an error page.
   */
  private resolveRange(dateFrom?: string, dateTo?: string) {
    const parse = (value?: string) => {
      if (!value) return undefined;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    };

    const from = parse(dateFrom);
    const to = parse(dateTo);

    if (from && to && from.getTime() > to.getTime()) {
      return { from: undefined, to: undefined };
    }

    return {
      from: from ? this.startOfIstDay(from) : undefined,
      // Inclusive: picking "5 Sep" as the end date includes all of 5 Sep.
      to: to ? this.endOfIstDay(to) : undefined,
    };
  }

  private startOfIstDay(date: Date): Date {
    const ist = new Date(date.getTime() + SellersService.IST_OFFSET_MS);
    ist.setUTCHours(0, 0, 0, 0);
    return new Date(ist.getTime() - SellersService.IST_OFFSET_MS);
  }

  private endOfIstDay(date: Date): Date {
    const ist = new Date(date.getTime() + SellersService.IST_OFFSET_MS);
    ist.setUTCHours(23, 59, 59, 999);
    return new Date(ist.getTime() - SellersService.IST_OFFSET_MS);
  }

  /**
   * Revenue and order counts bucketed over the range: by day for a window of
   * roughly two months or less, by month beyond that. With no range given it
   * covers the last 12 months, so the query is never unbounded.
   *
   * Empty buckets are emitted as zeroes rather than skipped, otherwise a quiet
   * week simply vanishes from the x-axis and the chart overstates the trend.
   *
   * revenue counts DELIVERED orders only (matching the totalRevenue stat beside
   * it); orders counts every order that was not cancelled, so the bar chart
   * still shows work in progress.
   */
  private async buildRevenueTrend(sellerId: string, from?: Date, to?: Date) {
    const end = to ?? this.endOfIstDay(new Date());
    const start =
      from ?? this.startOfIstDay(new Date(end.getTime() - 365 * SellersService.DAY_MS));

    const rows = await this.prisma.orderItem.findMany({
      where: {
        sellerId,
        order: {
          createdAt: { gte: start, lte: end },
          orderStatus: { not: 'CANCELLED' },
        },
      },
      select: {
        totalPrice: true,
        order: { select: { id: true, createdAt: true, orderStatus: true } },
      },
    });

    const daily = end.getTime() - start.getTime() <= 62 * SellersService.DAY_MS;
    const buckets = new Map<
      string,
      { label: string; date: string; revenue: number; orderIds: Set<string> }
    >();

    const keyFor = (instant: Date) => {
      const ist = new Date(instant.getTime() + SellersService.IST_OFFSET_MS);
      const year = ist.getUTCFullYear();
      const month = ist.getUTCMonth();
      const day = ist.getUTCDate();
      const monthName = SellersService.MONTHS[month];
      return daily
        ? {
            key: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            label: `${day} ${monthName}`,
          }
        : {
            key: `${year}-${String(month + 1).padStart(2, '0')}`,
            label: `${monthName} ${String(year).slice(2)}`,
          };
    };

    // Pre-seed every bucket in the window so gaps render as zero.
    const cursor = new Date(this.startOfIstDay(start).getTime());
    let guard = 0;
    while (cursor.getTime() <= end.getTime() && guard++ < 800) {
      const { key, label } = keyFor(cursor);
      if (!buckets.has(key)) {
        buckets.set(key, { label, date: key, revenue: 0, orderIds: new Set() });
      }
      cursor.setTime(
        cursor.getTime() + (daily ? SellersService.DAY_MS : 28 * SellersService.DAY_MS),
      );
    }

    for (const row of rows) {
      const { key, label } = keyFor(row.order.createdAt);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { label, date: key, revenue: 0, orderIds: new Set() };
        buckets.set(key, bucket);
      }
      if (row.order.orderStatus === 'DELIVERED') {
        bucket.revenue += row.totalPrice;
      }
      bucket.orderIds.add(row.order.id);
    }

    return [...buckets.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ label, date, revenue, orderIds }) => ({
        label,
        date,
        revenue: Math.round(revenue * 100) / 100,
        orders: orderIds.size,
      }));
  }
}

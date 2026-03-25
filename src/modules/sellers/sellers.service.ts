import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateSellerProfileDto } from './dto/create-seller-profile.dto';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new seller profile for an authenticated SELLER user.
   * Sets default verificationStatus = UNVERIFIED, rating = 0.
   */
  async createProfile(userId: string, dto: CreateSellerProfileDto) {
    const existing = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException('Seller profile already exists');
    }

    const profile = await this.prisma.sellerProfile.create({
      data: {
        userId,
        companyName: dto.companyName,
        gstNumber: dto.gstNumber,
        panNumber: dto.panNumber,
        drugLicenseNumber: dto.drugLicenseNumber,
        drugLicenseUrl: dto.drugLicenseUrl,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        verificationStatus: 'UNVERIFIED',
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
    });

    if (!profile) {
      throw new NotFoundException('Seller profile not found');
    }

    return profile;
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
        ...(isFirstUpdate && { verificationStatus: 'PENDING' }),
      },
    });

    this.logger.log(`Seller profile updated for user ${userId}`);
    return profile;
  }

  /**
   * Get seller dashboard metrics.
   */
  async getDashboard(userId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

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
      this.prisma.orderItem.count({ where: { sellerId: seller.id } }),
      this.prisma.orderItem.count({
        where: {
          sellerId: seller.id,
          order: {
            orderStatus: { in: ['PLACED', 'ACCEPTED', 'SHIPPED', 'OUT_FOR_DELIVERY'] },
          },
        },
      }),
      this.prisma.orderItem.aggregate({
        where: {
          sellerId: seller.id,
          order: { orderStatus: 'DELIVERED' },
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

    const orders = await this.prisma.orderItem.findMany({
      where: { sellerId: seller.id },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        quantity: true,
        totalPrice: true,
        product: { select: { name: true } },
        order: {
          select: {
            id: true,
            orderStatus: true,
            paymentStatus: true,
            createdAt: true,
          },
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
      overview: {
        orders: orders.map((item) => ({
          id: item.order.id,
          productName: item.product.name,
          quantity: item.quantity,
          totalPrice: item.totalPrice,
          status: item.order.orderStatus,
          paymentStatus: item.order.paymentStatus,
          createdAt: item.order.createdAt,
        })),
        revenueTrend: [], // Empty for now, would aggregate by day in production
      },
    };
  }
}

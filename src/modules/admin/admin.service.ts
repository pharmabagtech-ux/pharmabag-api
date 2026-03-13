import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { UserStatus, OrderStatus, PaymentStatus, PaymentVerificationStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all users with PENDING status, including their profiles.
   */
  async getPendingUsers() {
    const users = await this.prisma.user.findMany({
      where: { status: UserStatus.PENDING },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        buyerProfile: true,
        sellerProfile: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return users;
  }

  /**
   * Approve a user by ID — sets status to APPROVED.
   * Also sets seller verificationStatus to VERIFIED if applicable.
   */
  async approveUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { sellerProfile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.APPROVED) {
      throw new BadRequestException('User is already approved');
    }

    // Update user status
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.APPROVED },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        buyerProfile: true,
        sellerProfile: true,
      },
    });

    // If seller, also mark their profile as VERIFIED
    if (user.sellerProfile) {
      await this.prisma.sellerProfile.update({
        where: { userId },
        data: { verificationStatus: 'VERIFIED' },
      });
    }

    this.logger.log(`User ${userId} approved by admin`);
    return updatedUser;
  }

  /**
   * Reject a user by ID — sets status to REJECTED.
   * Also sets seller verificationStatus to REJECTED if applicable.
   */
  async rejectUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { sellerProfile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.REJECTED) {
      throw new BadRequestException('User is already rejected');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.REJECTED },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        buyerProfile: true,
        sellerProfile: true,
      },
    });

    // If seller, also mark their profile as REJECTED
    if (user.sellerProfile) {
      await this.prisma.sellerProfile.update({
        where: { userId },
        data: { verificationStatus: 'REJECTED' },
      });
    }

    this.logger.log(`User ${userId} rejected by admin`);
    return updatedUser;
  }

  async getDashboard() {
    const [
      totalUsers,
      totalBuyers,
      totalSellers,
      totalOrders,
      revenueResult,
      pendingOrders,
      pendingPayments,
      pendingSettlements,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'BUYER' } }),
      this.prisma.user.count({ where: { role: 'SELLER' } }),
      this.prisma.order.count(),
      this.prisma.order.aggregate({ _sum: { totalAmount: true } }),
      this.prisma.order.count({ where: { orderStatus: OrderStatus.PLACED } }),
      this.prisma.payment.count({
        where: { verificationStatus: PaymentVerificationStatus.PENDING },
      }),
      this.prisma.sellerSettlement.count({
        where: { payoutStatus: 'PENDING' },
      }),
    ]);

    return {
      totalUsers,
      totalBuyers,
      totalSellers,
      totalOrders,
      totalRevenue: revenueResult._sum.totalAmount ?? 0,
      pendingOrders,
      pendingPayments,
      pendingSettlements,
    };
  }
}

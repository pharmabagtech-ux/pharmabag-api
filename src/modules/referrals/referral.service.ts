import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService) {}

  async generateReferralCode(dto: { code: string; buyerId?: string; description?: string }) {
    const existing = await (this.prisma as any).referralCode.findUnique({
      where: { code: dto.code.toUpperCase() },
    });

    if (existing) {
      throw new ConflictException('Referral code already exists');
    }

    return (this.prisma as any).referralCode.create({
      data: {
        code: dto.code.toUpperCase(),
        buyerId: dto.buyerId || null,
        description: dto.description,
      },
      include: {
        buyer: {
          select: {
            legalName: true,
          }
        }
      }
    });
  }

  async getAllReferralCodes() {
    const codes = await (this.prisma as any).referralCode.findMany({
      include: {
        buyer: {
          select: {
            id: true,
            legalName: true,
            user: { select: { phone: true } },
          },
        },
        orders: {
          select: { totalAmount: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    return codes.map(c => ({
      ...c,
      totalRevenue: c.orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0)
    }));
  }

  async deleteReferralCode(id: string) {
    return (this.prisma as any).referralCode.delete({ where: { id } });
  }

  async toggleActive(id: string, isActive: boolean) {
    return (this.prisma as any).referralCode.update({
      where: { id },
      data: { isActive },
    });
  }
}

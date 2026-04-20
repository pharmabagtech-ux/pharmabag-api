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
        // Layer 1: Directly tagged orders
        orders: {
          select: { id: true, totalAmount: true, orderStatus: true }
        },
        // Layer 2 & 3: Buyers linked by ID OR by String match
        referredBuyers: {
          select: {
            user: {
              select: {
                orders: {
                  where: { referralCodeId: null },
                  select: { totalAmount: true, orderStatus: true }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    // Layer 3 (Manual string match): Find buyers who have the string matching the code but no ID link
    const allCodes = await Promise.all(codes.map(async (c) => {
      const stringMatchedBuyers = await this.prisma.buyerProfile.findMany({
        where: { 
          inviteCode: c.code,
          referralCodeId: null // Only those not already linked
        },
        select: {
          user: {
            select: {
              orders: {
                select: { totalAmount: true, orderStatus: true }
              }
            }
          }
        }
      });

      // Aggregate all layers - ONLY COUNT DELIVERED ORDERS
      const directRev = (c.orders || [])
        .filter((o: any) => o.orderStatus === 'DELIVERED')
        .reduce((s: number, o: any) => s + (Number(o.totalAmount) || 0), 0);
      
      const acquisitionRev = (c.referredBuyers || []).reduce((s: number, b: any) => {
        const deliveredOrders = (b.user?.orders || []).filter((o: any) => o.orderStatus === 'DELIVERED');
        return s + deliveredOrders.reduce((os: number, o: any) => os + (Number(o.totalAmount) || 0), 0);
      }, 0);

      const stringMatchRev = stringMatchedBuyers.reduce((s: number, b: any) => {
        const deliveredOrders = (b.user?.orders || []).filter((o: any) => o.orderStatus === 'DELIVERED');
        return s + deliveredOrders.reduce((os: number, o: any) => os + (Number(o.totalAmount) || 0), 0);
      }, 0);

      const totalOrderCount = 
        (c.orders || []).filter((o: any) => o.orderStatus === 'DELIVERED').length + 
        (c.referredBuyers || []).reduce((a: number, b: any) => 
          a + (b.user?.orders || []).filter((o: any) => o.orderStatus === 'DELIVERED').length, 0) +
        stringMatchedBuyers.reduce((a: number, b: any) => 
          a + (b.user?.orders || []).filter((o: any) => o.orderStatus === 'DELIVERED').length, 0);

      return {
        ...c,
        totalRevenue: directRev + acquisitionRev + stringMatchRev,
        orderCount: totalOrderCount
      };
    }));

    return allCodes;
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

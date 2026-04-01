import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────
  // CHECKOUT  — Create Order from Cart
  // ──────────────────────────────────────────────

  async checkout(userId: string, dto: CreateOrderDto) {
    // 1. Fetch buyer cart with items + product + seller + batches
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              include: {
                seller: {
                  select: {
                    id: true,
                    verificationStatus: true,
                    companyName: true,
                  },
                },
                batches: {
                  where: { stock: { gt: 0 } },
                  orderBy: { expiryDate: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty. Add products before checkout.');
    }

    // 1b. Verify buyer profile is approved
    const buyerProfile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
      select: { verificationStatus: true, creditTier: true, legalName: true },
    });

    if (!buyerProfile || !buyerProfile.legalName) {
      throw new ForbiddenException(
        'Please complete your KYC onboarding before placing orders.',
      );
    }

    if (buyerProfile.verificationStatus === 'UNVERIFIED') {
      throw new ForbiddenException(
        'Please complete your KYC onboarding before placing orders.',
      );
    }

    if (buyerProfile.verificationStatus === 'PENDING') {
      throw new ForbiddenException(
        'Your profile is under review. Please wait for admin approval before placing orders.',
      );
    }

    if (buyerProfile.verificationStatus === 'REJECTED') {
      throw new ForbiddenException(
        'Your profile verification was rejected. Please contact support.',
      );
    }

    if (!buyerProfile.creditTier) {
      throw new ForbiddenException(
        'Your account is not yet fully approved. Please wait for admin to set your credit tier.',
      );
    }

    // 2. Validate every cart item
    for (const item of cart.items) {
      const { product } = item;

      if (!product.isActive || product.deletedAt) {
        throw new BadRequestException(
          `Product "${product.name}" is no longer available. Please remove it from your cart.`,
        );
      }

      if (product.seller.verificationStatus !== 'VERIFIED') {
        throw new BadRequestException(
          `Seller for "${product.name}" is not verified. Please remove it from your cart.`,
        );
      }

      const totalStock = product.batches.reduce((sum, b) => sum + b.stock, 0);
      if (item.quantity > totalStock) {
        throw new BadRequestException(
          `Insufficient stock for "${product.name}". Only ${totalStock} units available.`,
        );
      }
    }

    // 3. Calculate total amount
    const totalAmount = cart.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );

    // 4. Execute transactional checkout
    const order = await this.prisma.$transaction(async (tx) => {
      // 4a. Create Order
      const newOrder = await tx.order.create({
        data: {
          buyerId: userId,
          totalAmount,
          orderStatus: OrderStatus.PLACED,
        },
      });

      // 4b. Create OrderItems
      const orderItemsData = cart.items.map((item) => ({
        orderId: newOrder.id,
        productId: item.productId,
        sellerId: item.product.seller.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.quantity * item.unitPrice,
      }));

      await tx.orderItem.createMany({ data: orderItemsData });

      // 4c. Create OrderAddress snapshot
      await tx.orderAddress.create({
        data: {
          orderId: newOrder.id,
          name: dto.name,
          phone: dto.phone,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          pincode: dto.pincode,
        },
      });

      // 4d. Reduce ProductBatch stock (FIFO — earliest expiry first)
      for (const item of cart.items) {
        let remaining = item.quantity;

        for (const batch of item.product.batches) {
          if (remaining <= 0) break;

          const deduct = Math.min(remaining, batch.stock);
          await tx.productBatch.update({
            where: { id: batch.id },
            data: { stock: { decrement: deduct } },
          });
          remaining -= deduct;
        }
      }

      // 4e. Clear buyer cart
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return newOrder;
    });

    // 5. Fetch the created order with full details
    const fullOrder = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                manufacturer: true,
                mrp: true,
                images: { select: { url: true }, take: 1 },
              },
            },
            seller: {
              select: {
                id: true,
                companyName: true,
                city: true,
                state: true,
              },
            },
          },
        },
        address: true,
      },
    });

    this.logger.log(
      `Order ${order.id} placed by user ${userId} — total ₹${totalAmount}`,
    );

    return fullOrder;
  }

  // ──────────────────────────────────────────────
  // GET BUYER ORDERS
  // ──────────────────────────────────────────────

  async getBuyerOrders(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { buyerId: userId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                manufacturer: true,
                mrp: true,
                images: { select: { url: true }, take: 1 },
              },
            },
            seller: {
              select: { id: true, companyName: true },
            },
          },
        },
        address: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders;
  }

  // ──────────────────────────────────────────────
  // GET ORDER DETAIL (Buyer)
  // ──────────────────────────────────────────────

  async getOrderDetail(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                manufacturer: true,
                chemicalComposition: true,
                mrp: true,
                gstPercent: true,
                images: { select: { id: true, url: true }, take: 1 },
              },
            },
            seller: {
              select: {
                id: true,
                companyName: true,
                city: true,
                state: true,
                rating: true,
              },
            },
          },
        },
        address: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.buyerId !== userId) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  // ──────────────────────────────────────────────
  // GET SELLER ORDERS
  // ──────────────────────────────────────────────

  async getSellerOrders(userId: string) {
    // Find seller profile
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    // Fetch order items belonging to this seller, grouped by order
    const orderItems = await this.prisma.orderItem.findMany({
      where: { sellerId: seller.id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            mrp: true,
            images: { select: { url: true }, take: 1 },
          },
        },
        order: {
          select: {
            id: true,
            buyerId: true,
            orderStatus: true,
            paymentStatus: true,
            createdAt: true,
            address: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group items by orderId for a cleaner response
    const ordersMap = new Map<
      string,
      {
        orderId: string;
        orderStatus: string;
        paymentStatus: string;
        createdAt: Date;
        address: any;
        items: any[];
        sellerTotal: number;
      }
    >();

    for (const item of orderItems) {
      const key = item.order.id;
      if (!ordersMap.has(key)) {
        ordersMap.set(key, {
          orderId: item.order.id,
          orderStatus: item.order.orderStatus,
          paymentStatus: item.order.paymentStatus,
          createdAt: item.order.createdAt,
          address: item.order.address,
          items: [],
          sellerTotal: 0,
        });
      }
      const entry = ordersMap.get(key)!;
      entry.items.push({
        id: item.id,
        product: item.product,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      });
      entry.sellerTotal += item.totalPrice;
    }

    return Array.from(ordersMap.values());
  }

  // ──────────────────────────────────────────────
  // UPDATE ORDER STATUS (Seller)
  // ──────────────────────────────────────────────

  async updateOrderStatus(
    userId: string,
    orderId: string,
    dto: UpdateOrderStatusDto,
  ) {
    // 1. Find seller profile
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    // 2. Verify this seller has items in the order
    const sellerItems = await this.prisma.orderItem.findMany({
      where: { orderId, sellerId: seller.id },
    });

    if (sellerItems.length === 0) {
      throw new ForbiddenException(
        'You do not have any items in this order',
      );
    }

    // 3. Fetch current order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // 4. Validate status transition
    const validTransitions: Record<string, string[]> = {
      PLACED: ['ACCEPTED'],
      ACCEPTED: ['SHIPPED'],
      SHIPPED: ['OUT_FOR_DELIVERY'],
      OUT_FOR_DELIVERY: ['DELIVERED'],
    };

    const allowed = validTransitions[order.orderStatus] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${order.orderStatus} to ${dto.status}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    // 5. Update order status
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: dto.status as OrderStatus },
      include: {
        items: {
          where: { sellerId: seller.id },
          include: {
            product: {
              select: { id: true, name: true },
            },
          },
        },
        address: true,
      },
    });

    this.logger.log(
      `Order ${orderId} status updated to ${dto.status} by seller ${seller.id}`,
    );

    return updated;
  }
}

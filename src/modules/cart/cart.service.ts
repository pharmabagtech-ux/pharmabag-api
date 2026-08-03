import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ACTIVE_LISTING } from '../../common/products/active-listing';
import { calculateNetUnitPrice } from '../../common/pricing/ptr.util';
import {
  effectiveMinimumQuantity,
  lineValueWithGst,
  listingLotSize,
  meetsMinimumOrderValue,
  minimumOrderMessage,
} from '../../common/orders/minimum-order.util';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────
  // ADD TO CART
  // ──────────────────────────────────────────────

  async addToCart(userId: string, dto: AddToCartDto) {
    let { productId } = dto;
    const { quantity } = dto;

    // 1. Validate product exists, is active, and not soft-deleted
    let product = await this.prisma.product.findFirst({
      where: { id: productId, ...ACTIVE_LISTING },
      include: {
        seller: { select: { id: true, verificationStatus: true } },
        batches: { where: { stock: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
      },
    });

    if (!product) {
      // Check if it's a MasterProduct ID
      const masterProduct = await this.prisma.masterProduct.findFirst({
        // catalogue row, not a seller listing - no vacation condition here.
        // The vacation rule is applied to its `products` below, which is what
        // actually gets added to the bag.
        where: { id: productId, isActive: true, deletedAt: null },
        include: {
          products: {
            where: ACTIVE_LISTING,
            include: {
              seller: { select: { id: true, verificationStatus: true } },
              batches: { where: { stock: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
            },
            take: 1,
          }
        }
      });

      if (masterProduct && masterProduct.products.length > 0) {
        product = masterProduct.products[0] as any;
        productId = product!.id;
      } else {
        throw new NotFoundException('Product not found or is no longer available');
      }
    }

    if (!product) {
      throw new NotFoundException('Product not found or is no longer available');
    }

    // 2. Ensure seller is verified
    if (product.seller.verificationStatus !== 'VERIFIED') {
      throw new BadRequestException('This product\'s seller is not verified');
    }

    // 3. Snapshot the unit price the buyer actually pays.
    //    A retailer pays PTR less any scheme discount — not the printed MRP.
    //    GST is added later from the listing's own gstPercent, so this stays
    //    GST-exclusive. Falls back to MRP if the price cannot be derived.
    //
    //    Derived here rather than just before the write, because the Rs 20,000
    //    minimum below is a rule about VALUE and cannot be checked without it.
    const unitPrice =
      calculateNetUnitPrice(
        product.mrp,
        (product as any).gstPercent,
        (product as any).discountType,
        (product as any).discountMeta,
      ) ?? product.mrp;

    // 4. Validate minimum order quantity.
    //
    //    `product.minimumOrderQuantity` alone is not enough: it is the
    //    seller's stored figure, written when the listing was created and
    //    never recomputed, and around a hundred live listings carry a value
    //    below what the Rs 20,000 rule now requires. Taking the higher of the
    //    two enforces the platform floor without overriding a seller who
    //    legitimately demands more.
    const gstPercent = (product as any).gstPercent;
    const requiredQuantity = effectiveMinimumQuantity(
      unitPrice,
      gstPercent,
      product.minimumOrderQuantity,
      listingLotSize((product as any).discountType, (product as any).discountMeta),
    );

    if (quantity < requiredQuantity) {
      if (!meetsMinimumOrderValue(quantity, unitPrice, gstPercent)) {
        throw new BadRequestException(
          minimumOrderMessage(
            product.name,
            requiredQuantity,
            lineValueWithGst(quantity, unitPrice, gstPercent),
          ),
        );
      }
      throw new BadRequestException(
        `Minimum order quantity for this product is ${requiredQuantity}`,
      );
    }

    // 4. Validate maximum order quantity
    if (product.maximumOrderQuantity && quantity > product.maximumOrderQuantity) {
      throw new BadRequestException(
        `Maximum order quantity for this product is ${product.maximumOrderQuantity}`,
      );
    }

    // 5. Validate stock availability across all batches
    const totalStock = product.batches.reduce((sum, b) => sum + b.stock, 0);
    if (quantity > totalStock) {
      throw new BadRequestException(
        `Insufficient stock. Only ${totalStock} units available`,
      );
    }

    // 6. Get or create cart
    let cart = await this.prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { userId },
      });
      this.logger.log(`Cart created for user ${userId}`);
    }

    // 7. Check for duplicate product in cart
    const existingItem = await this.prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId } },
    });

    if (existingItem) {
      throw new BadRequestException(
        'Product already in cart. Use PATCH /api/cart/item/:id to update quantity.',
      );
    }

    // 9. Create cart item (unitPrice was snapshotted at step 3)
    const cartItem = await this.prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId,
        quantity,
        unitPrice,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            mrp: true,
            minimumOrderQuantity: true,
            maximumOrderQuantity: true,
          },
        },
      },
    });

    this.logger.log(`Item added to cart: product ${productId}, qty ${quantity}`);

    return {
      ...cartItem,
      totalPrice: cartItem.quantity * cartItem.unitPrice,
    };
  }

  // ──────────────────────────────────────────────
  // GET CART
  // ──────────────────────────────────────────────

  async getCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
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
                masterProductId: true,
                minimumOrderQuantity: true,
                maximumOrderQuantity: true,
                isActive: true,
                deletedAt: true,
                images: { select: { id: true, url: true }, take: 1 },
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
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      return {
        cartId: cart?.id ?? null,
        items: [],
        totalAmount: 0,
      };
    }

    const items = cart.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      product: item.product,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.quantity * item.unitPrice,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    const totalAmount = items.reduce((sum, item) => sum + item.totalPrice, 0);

    return {
      cartId: cart.id,
      items,
      totalAmount,
    };
  }

  // ──────────────────────────────────────────────
  // UPDATE CART ITEM QUANTITY
  // ──────────────────────────────────────────────

  async updateCartItem(userId: string, cartItemId: string, dto: UpdateCartItemDto) {
    const { quantity } = dto;

    // 1. Find the cart item and verify ownership
    const cartItem = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: {
        cart: { select: { userId: true } },
        product: {
          include: {
            batches: { where: { stock: { gt: 0 } } },
          },
        },
      },
    });

    if (!cartItem) {
      throw new NotFoundException('Cart item not found');
    }

    if (cartItem.cart.userId !== userId) {
      throw new NotFoundException('Cart item not found');
    }

    // 2. Validate product is still active
    if (!cartItem.product.isActive || cartItem.product.deletedAt) {
      throw new BadRequestException('This product is no longer available');
    }

    // 3. Validate minimum order quantity — Rs 20,000 floor or the seller's own
    //    stored minimum, whichever is higher. Measured against the price
    //    already snapshotted on the cart item, which is what this line will be
    //    billed at, rather than a freshly derived one.
    const gstPercent = (cartItem.product as any).gstPercent;
    const requiredQuantity = effectiveMinimumQuantity(
      cartItem.unitPrice,
      gstPercent,
      cartItem.product.minimumOrderQuantity,
      listingLotSize(
        (cartItem.product as any).discountType,
        (cartItem.product as any).discountMeta,
      ),
    );

    if (quantity < requiredQuantity) {
      if (!meetsMinimumOrderValue(quantity, cartItem.unitPrice, gstPercent)) {
        throw new BadRequestException(
          minimumOrderMessage(
            cartItem.product.name,
            requiredQuantity,
            lineValueWithGst(quantity, cartItem.unitPrice, gstPercent),
          ),
        );
      }
      throw new BadRequestException(
        `Minimum order quantity for this product is ${requiredQuantity}`,
      );
    }

    // 4. Validate maximum order quantity
    if (cartItem.product.maximumOrderQuantity && quantity > cartItem.product.maximumOrderQuantity) {
      throw new BadRequestException(
        `Maximum order quantity for this product is ${cartItem.product.maximumOrderQuantity}`,
      );
    }

    // 5. Validate stock
    const totalStock = cartItem.product.batches.reduce((sum, b) => sum + b.stock, 0);
    if (quantity > totalStock) {
      throw new BadRequestException(
        `Insufficient stock. Only ${totalStock} units available`,
      );
    }

    // 6. Update quantity
    const updated = await this.prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            mrp: true,
            minimumOrderQuantity: true,
            maximumOrderQuantity: true,
          },
        },
      },
    });

    this.logger.log(`Cart item ${cartItemId} quantity updated to ${quantity}`);

    return {
      ...updated,
      totalPrice: updated.quantity * updated.unitPrice,
    };
  }

  // ──────────────────────────────────────────────
  // REMOVE SINGLE ITEM
  // ──────────────────────────────────────────────

  async removeCartItem(userId: string, cartItemId: string) {
    // Verify ownership
    const cartItem = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { cart: { select: { userId: true } } },
    });

    if (!cartItem) {
      throw new NotFoundException('Cart item not found');
    }

    if (cartItem.cart.userId !== userId) {
      throw new NotFoundException('Cart item not found');
    }

    await this.prisma.cartItem.delete({
      where: { id: cartItemId },
    });

    this.logger.log(`Cart item ${cartItemId} removed`);
    return { message: 'Item removed from cart' };
  }

  // ──────────────────────────────────────────────
  // CLEAR ENTIRE CART
  // ──────────────────────────────────────────────

  async clearCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      return { message: 'Cart is already empty' };
    }

    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    this.logger.log(`Cart cleared for user ${userId}`);
    return { message: 'Cart cleared successfully' };
  }
}

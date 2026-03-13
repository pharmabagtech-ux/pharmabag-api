import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ──────────────────────────────────────────────
  // BUYER ENDPOINTS
  // ──────────────────────────────────────────────

  /**
   * POST /api/orders
   * Checkout — create an order from the buyer's cart.
   */
  @Post()
  @Roles(Role.BUYER)
  @HttpCode(HttpStatus.CREATED)
  async checkout(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrderDto,
  ) {
    const data = await this.ordersService.checkout(userId, dto);
    return { message: 'Order placed successfully', data };
  }

  /**
   * GET /api/orders
   * List all orders for the current buyer.
   */
  @Get()
  @Roles(Role.BUYER)
  @HttpCode(HttpStatus.OK)
  async getBuyerOrders(@CurrentUser('id') userId: string) {
    const data = await this.ordersService.getBuyerOrders(userId);
    return { message: 'Orders retrieved successfully', data };
  }

  /**
   * GET /api/orders/seller
   * List orders containing items sold by the current seller.
   * NOTE: This must be defined BEFORE :id so NestJS doesn't treat "seller" as a UUID.
   */
  @Get('seller')
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  async getSellerOrders(@CurrentUser('id') userId: string) {
    const data = await this.ordersService.getSellerOrders(userId);
    return { message: 'Seller orders retrieved successfully', data };
  }

  /**
   * GET /api/orders/:id
   * Get full order detail for the current buyer.
   */
  @Get(':id')
  @Roles(Role.BUYER)
  @HttpCode(HttpStatus.OK)
  async getOrderDetail(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orderId: string,
  ) {
    const data = await this.ordersService.getOrderDetail(userId, orderId);
    return { message: 'Order details retrieved successfully', data };
  }

  // ──────────────────────────────────────────────
  // SELLER ENDPOINTS
  // ──────────────────────────────────────────────

  /**
   * PATCH /api/orders/:id/status
   * Seller updates order status (ACCEPTED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED).
   */
  @Patch(':id/status')
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  async updateOrderStatus(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const data = await this.ordersService.updateOrderStatus(userId, orderId, dto);
    return { message: 'Order status updated successfully', data };
  }
}

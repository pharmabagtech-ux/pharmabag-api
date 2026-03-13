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
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UploadProofDto } from './dto/upload-proof.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ──────────────────────────────────────────────
  // BUYER: Record a payment attempt
  // ──────────────────────────────────────────────

  /**
   * POST /api/payments
   * Buyer records a manual payment (bank transfer, UPI, COD, etc.)
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @HttpCode(HttpStatus.CREATED)
  async createPayment(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    const data = await this.paymentsService.createPayment(userId, dto);
    return { message: 'Payment recorded', data };
  }

  // ──────────────────────────────────────────────
  // BUYER: Upload payment proof
  // ──────────────────────────────────────────────

  /**
   * POST /api/payments/:id/proof
   * Buyer uploads a screenshot / receipt URL as payment proof.
   */
  @Post(':id/proof')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @HttpCode(HttpStatus.OK)
  async uploadProof(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) paymentId: string,
    @Body() dto: UploadProofDto,
  ) {
    const data = await this.paymentsService.uploadProof(userId, paymentId, dto);
    return { message: 'Payment proof uploaded', data };
  }

  // ──────────────────────────────────────────────
  // BUYER: Get all payments for an order
  // ──────────────────────────────────────────────

  /**
   * GET /api/payments/order/:orderId
   * Returns full payment history + computed totals for an order.
   */
  @Get('order/:orderId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @HttpCode(HttpStatus.OK)
  async getOrderPayments(
    @CurrentUser('id') userId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const data = await this.paymentsService.getOrderPayments(userId, orderId);
    return { message: 'Payment history retrieved', data };
  }

  // ──────────────────────────────────────────────
  // ADMIN: Confirm a payment
  // ──────────────────────────────────────────────

  /**
   * PATCH /api/payments/:id/confirm
   * Admin verifies and confirms a payment record.
   */
  @Patch(':id/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async confirmPayment(@Param('id', ParseUUIDPipe) paymentId: string) {
    const data = await this.paymentsService.confirmPayment(paymentId);
    return { message: 'Payment confirmed', data };
  }

  // ──────────────────────────────────────────────
  // ADMIN: Reject a payment
  // ──────────────────────────────────────────────

  /**
   * PATCH /api/payments/:id/reject
   * Admin rejects a payment record.
   */
  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async rejectPayment(@Param('id', ParseUUIDPipe) paymentId: string) {
    const data = await this.paymentsService.rejectPayment(paymentId);
    return { message: 'Payment rejected', data };
  }
}

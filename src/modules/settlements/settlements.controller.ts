import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
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
import { SettlementsService } from './settlements.service';
import { MarkPaidDto } from './dto/mark-paid.dto';

@Controller()
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  // ─── SELLER ROUTES (/api/settlements/…) ───────────────

  @Get('settlements/seller')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  async getSellerSettlements(@CurrentUser('id') userId: string) {
    const data = await this.settlementsService.getSellerSettlements(userId);
    return { message: 'Settlements retrieved', data };
  }

  @Get('settlements/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  async getSellerSummary(@CurrentUser('id') userId: string) {
    const data = await this.settlementsService.getSellerSummary(userId);
    return { message: 'Settlement summary retrieved', data };
  }

  @Get('settlements/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  async getSellerHistory(@CurrentUser('id') userId: string) {
    const data = await this.settlementsService.getSellerHistory(userId);
    return { message: 'Payout history retrieved', data };
  }

  // ─── ADMIN ROUTES (/api/admin/settlements/…) ─────────

  @Get('admin/settlements')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getAllSettlements(@Query('status') status?: string) {
    const data = await this.settlementsService.getAllSettlements(status);
    return { message: 'All settlements retrieved', data };
  }

  @Patch('admin/settlements/:id/mark-paid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async markPaid(
    @Param('id', ParseUUIDPipe) settlementId: string,
    @Body() dto: MarkPaidDto,
  ) {
    const data = await this.settlementsService.markPaid(settlementId, dto);
    return { message: 'Settlement marked as paid', data };
  }
}

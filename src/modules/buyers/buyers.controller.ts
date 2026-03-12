import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BuyersService } from './buyers.service';
import { CreateBuyerProfileDto } from './dto/create-buyer-profile.dto';
import { UpdateBuyerProfileDto } from './dto/update-buyer-profile.dto';

@Controller('buyers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUYER)
export class BuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @Post('profile')
  @HttpCode(HttpStatus.CREATED)
  async createProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateBuyerProfileDto,
  ) {
    const data = await this.buyersService.createProfile(userId, dto);
    return { message: 'Buyer profile created successfully', data };
  }

  @Get('profile')
  @HttpCode(HttpStatus.OK)
  async getProfile(@CurrentUser('id') userId: string) {
    const data = await this.buyersService.getProfile(userId);
    return { message: 'Buyer profile retrieved successfully', data };
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateBuyerProfileDto,
  ) {
    const data = await this.buyersService.updateProfile(userId, dto);
    return { message: 'Buyer profile updated successfully', data };
  }
}

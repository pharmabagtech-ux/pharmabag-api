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
import { SellersService } from './sellers.service';
import { CreateSellerProfileDto } from './dto/create-seller-profile.dto';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';

@Controller('sellers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Post('profile')
  @HttpCode(HttpStatus.CREATED)
  async createProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSellerProfileDto,
  ) {
    const data = await this.sellersService.createProfile(userId, dto);
    return { message: 'Seller profile created successfully', data };
  }

  @Get('profile')
  @HttpCode(HttpStatus.OK)
  async getProfile(@CurrentUser('id') userId: string) {
    const data = await this.sellersService.getProfile(userId);
    return { message: 'Seller profile retrieved successfully', data };
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSellerProfileDto,
  ) {
    const data = await this.sellersService.updateProfile(userId, dto);
    return { message: 'Seller profile updated successfully', data };
  }
}

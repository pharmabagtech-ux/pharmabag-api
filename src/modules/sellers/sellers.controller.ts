import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SellersService } from './sellers.service';
import { CreateSellerProfileDto } from './dto/create-seller-profile.dto';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';

@ApiTags('Sellers')
@ApiBearerAuth('JWT-auth')
@Controller('sellers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Post('profile')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create seller KYC profile' })
  @ApiResponse({ status: 201, description: 'Seller profile created' })
  @ApiResponse({ status: 403, description: 'Forbidden — not a seller' })
  async createProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSellerProfileDto,
  ) {
    const data = await this.sellersService.createProfile(userId, dto);
    return { message: 'Seller profile created successfully', data };
  }

  @Get('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get seller profile' })
  @ApiResponse({ status: 200, description: 'Seller profile returned' })
  async getProfile(@CurrentUser('id') userId: string) {
    const data = await this.sellersService.getProfile(userId);
    return { message: 'Seller profile retrieved successfully', data };
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update seller profile' })
  @ApiResponse({ status: 200, description: 'Seller profile updated' })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSellerProfileDto,
  ) {
    const data = await this.sellersService.updateProfile(userId, dto);
    return { message: 'Seller profile updated successfully', data };
  }

  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get seller dashboard metrics' })
  @ApiResponse({ status: 200, description: 'Seller dashboard metrics returned' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'ISO date; start of the reporting window (inclusive)' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'ISO date; end of the reporting window (inclusive)' })
  async getDashboard(
    @CurrentUser('id') userId: string,
    // Taken as raw strings and parsed in the service rather than through a DTO:
    // the global validation pipe's implicit conversion has bitten this codebase
    // before, and an unparseable date here should degrade to all-time, not 400.
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const data = await this.sellersService.getDashboard(userId, { dateFrom, dateTo });
    return { message: 'Seller dashboard retrieved successfully', data };
  }
}

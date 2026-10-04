import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { ReorderBannersDto } from './dto/reorder-banners.dto';
import { UpdateBannerSettingsDto } from './dto/update-banner-settings.dto';

/**
 * Public read.
 *
 * Unauthenticated because the storefront renders the strip for logged-out
 * visitors, and cached for the same reason the public site-settings route is:
 * the storefront fetches it server-side from a single address, and the global
 * ThrottlerGuard keys its 100req/60s budget on req.ip. An uncached read here
 * would spend that budget and start 429-ing unrelated catalogue requests.
 */
@ApiTags('Banners')
@Controller('banners')
export class BannersPublicController {
  constructor(private readonly service: BannersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Active promo banners for a storefront placement' })
  @ApiQuery({ name: 'scope', enum: ['homepage', 'category'] })
  @ApiQuery({ name: 'categorySlug', required: false })
  @ApiResponse({ status: 200, description: 'Banners and the rotation interval' })
  async find(
    @Query('scope') scope: 'homepage' | 'category',
    @Query('categorySlug') categorySlug?: string,
  ) {
    const data = await this.service.findPublic({
      scope: scope === 'category' ? 'category' : 'homepage',
      categorySlug,
    });
    return { message: 'Banners retrieved successfully', data };
  }
}

@ApiTags('Admin / Banners')
@ApiBearerAuth('JWT-auth')
@Controller('admin/banners')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class BannersAdminController {
  constructor(private readonly service: BannersService) {}

  // The literal routes are declared BEFORE the ':id' ones. Nest matches in
  // declaration order, so with these below, PATCH /admin/banners/reorder would
  // bind id = "reorder" and 404 against a banner that does not exist.
  @Get('settings')
  @ApiOperation({ summary: 'Read banner rotation settings' })
  async getSettings() {
    const rotationSeconds = await this.service.getRotationSeconds();
    return {
      message: 'Banner settings retrieved successfully',
      data: { rotationSeconds },
    };
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update banner rotation settings' })
  async updateSettings(@Body() dto: UpdateBannerSettingsDto) {
    const rotationSeconds = await this.service.setRotationSeconds(dto.rotationSeconds);
    return { message: 'Banner settings updated successfully', data: { rotationSeconds } };
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Rewrite banner order from a complete id list' })
  async reorder(@Body() dto: ReorderBannersDto) {
    const data = await this.service.reorder(dto.ids);
    return { message: 'Banners reordered successfully', data };
  }

  @Get()
  @ApiOperation({ summary: 'List all banners, inactive included' })
  async findAll() {
    const data = await this.service.findAllForAdmin();
    return { message: 'Banners retrieved successfully', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a banner' })
  async create(@Body() dto: CreateBannerDto) {
    const data = await this.service.create(dto);
    return { message: 'Banner created successfully', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a banner' })
  async update(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    const data = await this.service.update(id, dto);
    return { message: 'Banner updated successfully', data };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a banner' })
  async remove(@Param('id') id: string) {
    const data = await this.service.remove(id);
    return { message: 'Banner deleted successfully', data };
  }
}

import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SiteSettingsService } from './site-settings.service';
import { UpdateSiteSettingsDto } from './dto/update-site-settings.dto';

/**
 * Public read: the buyer storefront fetches this server-side to render
 * verification metas, GA4 and Organization-schema fields at request time —
 * which is what lets an admin paste a token in the panel and go live without
 * a redeploy. The service whitelists on read, so nothing non-public can leak
 * through this endpoint no matter what ends up in the row.
 */
@ApiTags('Site Settings')
@Controller('site-settings')
export class SiteSettingsPublicController {
  constructor(private readonly service: SiteSettingsService) {}

  @Get('public')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  @ApiOperation({ summary: 'Public site-SEO settings (whitelisted shape)' })
  @ApiResponse({ status: 200, description: 'Settings returned' })
  async getPublic() {
    const data = await this.service.get();
    return { message: 'Site settings retrieved successfully', data };
  }
}

@ApiTags('Admin / Site Settings')
@ApiBearerAuth('JWT-auth')
@Controller('admin/site-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SiteSettingsAdminController {
  constructor(private readonly service: SiteSettingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read site-SEO settings (admin)' })
  async get() {
    const data = await this.service.get();
    return { message: 'Site settings retrieved successfully', data };
  }

  /**
   * PUT replaces the whole settings document — "clear a field" is expressed
   * by omitting it. One source of truth beats merge semantics for a surface
   * this small; the admin UI always sends the full current form.
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace site-SEO settings (admin)' })
  async update(@Body() dto: UpdateSiteSettingsDto) {
    const data = await this.service.update(dto);
    return { message: 'Site settings updated successfully', data };
  }
}

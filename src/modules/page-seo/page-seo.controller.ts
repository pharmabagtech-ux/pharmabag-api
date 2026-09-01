import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PageSeoService } from './page-seo.service';
import { UpsertPageSeoDto } from './dto/page-seo.dto';

@ApiTags('Page SEO')
@Controller('page-seo')
export class PageSeoPublicController {
  constructor(private readonly service: PageSeoService) {}

  /**
   * The whole override map, read by the storefront and cached there.
   *
   * `@SkipThrottle()` for the same reason the redirect map and the sitemap
   * endpoint carry it: every server-side render on the web box comes from ONE
   * IP, so the per-visitor throttle would eventually 429 this and the
   * storefront would silently fall back to generated metadata everywhere —
   * exactly the failure that once truncated the product sitemaps.
   */
  @Get('map')
  @SkipThrottle()
  @Header('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600')
  @ApiOperation({ summary: 'All per-page SEO overrides as a path map (public, read-only)' })
  @ApiResponse({ status: 200, description: 'Override map returned' })
  async map() {
    const data = await this.service.getMap();
    return { message: 'Page SEO map', data };
  }
}

@ApiTags('Page SEO (Admin)')
@ApiBearerAuth()
@Controller('admin/page-seo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PageSeoAdminController {
  constructor(private readonly service: PageSeoService) {}

  @Get()
  @ApiOperation({ summary: 'List pages that carry an SEO override' })
  async list(
    @Query('entityType') entityType?: string,
    @Query('search') search?: string,
    @Query('missing') missing?: 'title' | 'description' | 'aiSummary',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.list({
      entityType,
      search,
      missing,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { message: 'Page SEO list', data };
  }

  /**
   * Path travels as a QUERY parameter, not a route segment: a storefront path
   * contains slashes ("/categories/ayurvedic/syrup"), which cannot be carried
   * in a single Nest route param without double-encoding on every caller.
   */
  @Get('one')
  @ApiOperation({ summary: 'Get the override for one path' })
  async one(@Query('path') path: string) {
    const data = await this.service.getOne(path || '/');
    return { message: 'Page SEO', data };
  }

  @Put()
  @ApiOperation({ summary: 'Create or update the override for a path' })
  @ApiResponse({ status: 200, description: 'Override saved' })
  async upsert(
    @Query('path') path: string,
    @Body() dto: UpsertPageSeoDto,
    @CurrentUser() user?: { id?: string },
  ) {
    const data = await this.service.upsert(path || '/', dto, user?.id);
    return { message: 'Page SEO saved', data };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove the override, restoring the generated head' })
  async remove(@Query('path') path: string) {
    const data = await this.service.remove(path || '/');
    return { message: 'Page SEO override removed', data };
  }
}

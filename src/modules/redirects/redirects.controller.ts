import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { RedirectsService } from './redirects.service';
import {
  CreateRedirectDto,
  UpdateRedirectDto,
  Track404Dto,
  RecordHitDto,
} from './dto/redirects.dto';

@ApiTags('Redirects')
@Controller('redirects')
export class RedirectsPublicController {
  constructor(private readonly service: RedirectsService) {}

  /**
   * The storefront middleware polls this every ~60s from the web box's single
   * IP. `@SkipThrottle()` is required: if the per-visitor throttle ever 429'd
   * this read, the middleware would serve a stale (or empty) map — the same
   * failure mode that once broke the product sitemaps. Read-only, cached,
   * and it exposes nothing but redirect paths.
   */
  @SkipThrottle()
  @Get('map')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Full redirect map for the storefront middleware' })
  @ApiResponse({ status: 200, description: 'Array of {from,to,status}' })
  async getMap() {
    const data = await this.service.getMap();
    return { message: 'Redirect map retrieved successfully', data };
  }

  @Post('track-404')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Record a storefront 404 (fire-and-forget)' })
  async track404(@Body() dto: Track404Dto) {
    await this.service.track404(dto);
    return { message: 'Recorded' };
  }

  @Post('hit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Count a served redirect (fire-and-forget)' })
  async hit(@Body() dto: RecordHitDto) {
    await this.service.recordHit(dto.from);
    return { message: 'Recorded' };
  }
}

@ApiTags('Admin / Redirects')
@ApiBearerAuth('JWT-auth')
@Controller('admin/redirects')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class RedirectsAdminController {
  constructor(private readonly service: RedirectsService) {}

  // Literal routes BEFORE the :id params — same ordering rule that once left
  // /admin/blogs/authors and /admin/users/sellers unreachable.

  @Get('404s')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '404 log, most-hit first' })
  async list404s(@Query('all') all?: string) {
    const data = await this.service.list404s(all !== 'true');
    return { message: '404 log retrieved successfully', data };
  }

  @Delete('404s/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dismiss a 404 entry' })
  async dismiss404(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.dismiss404(id);
    return { message: '404 entry dismissed', data };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List redirects, most-used first' })
  async list() {
    const data = await this.service.list();
    return { message: 'Redirects retrieved successfully', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create (or replace) a redirect' })
  async create(@Body() dto: CreateRedirectDto) {
    const data = await this.service.create(dto);
    return { message: 'Redirect created successfully', data };
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change a redirect target' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRedirectDto,
  ) {
    const data = await this.service.update(id, dto);
    return { message: 'Redirect updated successfully', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a redirect' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.remove(id);
    return { message: 'Redirect deleted successfully', data };
  }
}

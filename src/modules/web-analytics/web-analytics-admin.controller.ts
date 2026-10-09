import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WebAnalyticsService } from './web-analytics.service';
import { WebAnalyticsReportsService, type TrafficRange } from './web-analytics-reports.service';
import { TrafficRangeDto } from './dto/traffic-range.dto';
import { ProductGeoRangeDto, ProductIdParamDto } from './dto/product-geo.dto';

@ApiTags('Admin — Web Analytics')
@ApiBearerAuth('JWT-auth')
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class WebAnalyticsAdminController {
  constructor(
    private readonly webAnalyticsService: WebAnalyticsService,
    private readonly webAnalyticsReportsService: WebAnalyticsReportsService,
  ) {}

  /**
   * Parses and validates the shared `from`/`to` query pair.
   *
   * `to` is an EXCLUSIVE upper bound in every report query (`startedAt < to`),
   * so a caller wanting to include a given day must pass the day after it.
   * Callers send plain `YYYY-MM-DD`, which parses as midnight UTC.
   */
  private parseRange(query: { from: string; to: string }): TrafficRange {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from and to must be valid dates');
    }
    if (to <= from) {
      throw new BadRequestException('to must be after from');
    }
    return { from, to };
  }

  @Get('realtime')
  @ApiOperation({ summary: 'Active visitors, pages being viewed, and recent events (last 5 minutes)' })
  @ApiResponse({ status: 200, description: 'Realtime snapshot returned' })
  async realtime() {
    const data = await this.webAnalyticsService.realtime();
    return { message: 'Realtime analytics retrieved successfully', data };
  }

  @Get('traffic')
  @ApiOperation({ summary: 'Daily visitor/session trend, acquisition channels, and top referrers for a date range' })
  @ApiResponse({ status: 200, description: 'Traffic report returned' })
  async traffic(@Query() query: TrafficRangeDto) {
    const data = await this.webAnalyticsReportsService.traffic(this.parseRange(query));
    return { message: 'Traffic report retrieved successfully', data };
  }

  @Get('audience')
  @ApiOperation({ summary: 'Device/OS/browser breakdown and traffic-quality summary for a date range' })
  @ApiResponse({ status: 200, description: 'Audience report returned' })
  async audience(@Query() query: TrafficRangeDto) {
    const data = await this.webAnalyticsReportsService.audience(this.parseRange(query));
    return { message: 'Audience report retrieved successfully', data };
  }

  @Get('geography')
  @ApiOperation({
    summary: 'Visitor country, Indian state and Indian city breakdown for a date range, with geo coverage',
  })
  @ApiResponse({ status: 200, description: 'Geography report returned' })
  async geography(@Query() query: TrafficRangeDto) {
    const data = await this.webAnalyticsReportsService.geography(this.parseRange(query));
    return { message: 'Geography report retrieved successfully', data };
  }

  @Get('products/:productId/geography')
  @ApiOperation({
    summary: 'Where the visitors who viewed one product came from — country, Indian state and city',
  })
  @ApiResponse({ status: 200, description: 'Product geography report returned' })
  async productGeography(@Param() params: ProductIdParamDto, @Query() query: ProductGeoRangeDto) {
    const data = await this.webAnalyticsReportsService.productGeography(
      { productId: params.productId, path: query.path },
      this.parseRange(query),
    );
    return { message: 'Product geography report retrieved successfully', data };
  }
}

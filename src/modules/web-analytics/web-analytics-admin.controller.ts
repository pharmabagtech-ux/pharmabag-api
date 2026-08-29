import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WebAnalyticsService } from './web-analytics.service';
import { WebAnalyticsReportsService } from './web-analytics-reports.service';
import { TrafficRangeDto } from './dto/traffic-range.dto';

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
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to <= from) {
      throw new BadRequestException('to must be after from');
    }
    const data = await this.webAnalyticsReportsService.traffic({ from, to });
    return { message: 'Traffic report retrieved successfully', data };
  }

  @Get('audience')
  @ApiOperation({ summary: 'Device/OS/browser breakdown and traffic-quality summary for a date range' })
  @ApiResponse({ status: 200, description: 'Audience report returned' })
  async audience(@Query() query: TrafficRangeDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to <= from) {
      throw new BadRequestException('to must be after from');
    }
    const data = await this.webAnalyticsReportsService.audience({ from, to });
    return { message: 'Audience report retrieved successfully', data };
  }
}

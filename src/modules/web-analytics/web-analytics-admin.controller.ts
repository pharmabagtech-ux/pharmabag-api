import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WebAnalyticsService } from './web-analytics.service';

@ApiTags('Admin — Web Analytics')
@ApiBearerAuth('JWT-auth')
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class WebAnalyticsAdminController {
  constructor(private readonly webAnalyticsService: WebAnalyticsService) {}

  @Get('realtime')
  @ApiOperation({ summary: 'Active visitors, pages being viewed, and recent events (last 5 minutes)' })
  @ApiResponse({ status: 200, description: 'Realtime snapshot returned' })
  async realtime() {
    const data = await this.webAnalyticsService.realtime();
    return { message: 'Realtime analytics retrieved successfully', data };
  }
}

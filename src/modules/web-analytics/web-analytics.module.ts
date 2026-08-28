import { Module } from '@nestjs/common';
import { WebAnalyticsController } from './web-analytics.controller';
import { WebAnalyticsAdminController } from './web-analytics-admin.controller';
import { WebAnalyticsService } from './web-analytics.service';
import { WebAnalyticsReportsService } from './web-analytics-reports.service';

@Module({
  controllers: [WebAnalyticsController, WebAnalyticsAdminController],
  providers: [WebAnalyticsService, WebAnalyticsReportsService],
  exports: [WebAnalyticsService],
})
export class WebAnalyticsModule {}

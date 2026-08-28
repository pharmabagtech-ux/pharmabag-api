import { Module } from '@nestjs/common';
import { WebAnalyticsController } from './web-analytics.controller';
import { WebAnalyticsAdminController } from './web-analytics-admin.controller';
import { WebAnalyticsService } from './web-analytics.service';

@Module({
  controllers: [WebAnalyticsController, WebAnalyticsAdminController],
  providers: [WebAnalyticsService],
  exports: [WebAnalyticsService],
})
export class WebAnalyticsModule {}

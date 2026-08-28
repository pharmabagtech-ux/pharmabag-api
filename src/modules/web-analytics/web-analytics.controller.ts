import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CollectBatchDto } from './dto/collect-batch.dto';
import { WebAnalyticsService } from './web-analytics.service';

@ApiTags('Web Analytics')
@Controller('analytics')
export class WebAnalyticsController {
  private readonly logger = new Logger(WebAnalyticsController.name);

  constructor(private readonly webAnalyticsService: WebAnalyticsService) {}

  @Post('collect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  @ApiOperation({ summary: 'Ingest a batch of first-party analytics events (public, anonymous)' })
  @ApiResponse({ status: 204, description: 'Batch accepted' })
  async collect(@Body() batch: CollectBatchDto): Promise<void> {
    try {
      await this.webAnalyticsService.ingest(batch);
    } catch (err) {
      this.logger.error('web-analytics ingest failed, batch dropped', err);
    }
  }
}

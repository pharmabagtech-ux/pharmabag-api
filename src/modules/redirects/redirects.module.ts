import { Module } from '@nestjs/common';
import { RedirectsService } from './redirects.service';
import {
  RedirectsPublicController,
  RedirectsAdminController,
} from './redirects.controller';

@Module({
  controllers: [RedirectsPublicController, RedirectsAdminController],
  providers: [RedirectsService],
  // Exported for the master-products bulk service, which auto-creates
  // PRODUCT_RENAME redirects whenever an upload rewrites slugs.
  exports: [RedirectsService],
})
export class RedirectsModule {}

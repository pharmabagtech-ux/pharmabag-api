import { Module } from '@nestjs/common';
import { PageSeoService } from './page-seo.service';
import {
  PageSeoPublicController,
  PageSeoAdminController,
} from './page-seo.controller';

@Module({
  controllers: [PageSeoPublicController, PageSeoAdminController],
  providers: [PageSeoService],
  exports: [PageSeoService],
})
export class PageSeoModule {}

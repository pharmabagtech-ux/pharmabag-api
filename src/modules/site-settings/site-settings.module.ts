import { Module } from '@nestjs/common';
import { SiteSettingsService } from './site-settings.service';
import {
  SiteSettingsPublicController,
  SiteSettingsAdminController,
} from './site-settings.controller';

@Module({
  controllers: [SiteSettingsPublicController, SiteSettingsAdminController],
  providers: [SiteSettingsService],
})
export class SiteSettingsModule {}

import { Module } from '@nestjs/common';
import { BannersService } from './banners.service';
import { BannersAdminController, BannersPublicController } from './banners.controller';

// DatabaseModule is @Global(), so it is not imported here — matching
// site-settings.module.ts and every other feature module in this codebase.
@Module({
  controllers: [BannersPublicController, BannersAdminController],
  providers: [BannersService],
  exports: [BannersService],
})
export class BannersModule {}

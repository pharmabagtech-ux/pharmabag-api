import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { RedirectsModule } from '../redirects/redirects.module';

@Module({
  // RedirectsModule: renaming a category rewrites its slug, so the old URL
  // needs a 301 or a page that ranks starts 404ing.
  imports: [RedirectsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}

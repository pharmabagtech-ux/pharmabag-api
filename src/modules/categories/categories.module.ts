import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { RedirectsModule } from '../redirects/redirects.module';
import { PageSeoModule } from '../page-seo/page-seo.module';

@Module({
  // RedirectsModule: renaming a category rewrites its slug, so the old URL
  // needs a 301 or a page that ranks starts 404ing.
  // PageSeoModule: and the page's admin-written content has to move with it,
  // or the renamed page silently reverts to generated copy.
  imports: [RedirectsModule, PageSeoModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}

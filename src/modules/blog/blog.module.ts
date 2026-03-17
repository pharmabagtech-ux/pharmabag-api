import { Module } from '@nestjs/common';
import { BlogService } from './blog.service';
import { BlogAdminController } from './blog-admin.controller';
import { BlogPublicController, SitemapController } from './blog-public.controller';

@Module({
  controllers: [BlogAdminController, BlogPublicController, SitemapController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}

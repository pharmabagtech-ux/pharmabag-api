import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  Inject,
} from '@nestjs/common';
import { BlogStatus, Prisma } from '@prisma/client';
import Redis from 'ioredis';
import slugify from 'slugify';
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '../../database/prisma.service';
import { REDIS_CLIENT } from '../../config/redis.config';
import {
  CreateBlogPostDto,
  UpdateBlogPostDto,
  UpdateBlogStatusDto,
  QueryBlogDto,
  CreateBlogAuthorDto,
  UpdateBlogAuthorDto,
  CreateBlogCategoryDto,
  UpdateBlogCategoryDto,
} from './dto';

const BLOG_CACHE_TTL = 300; // 5 minutes
const BLOG_LIST_CACHE_TTL = 120; // 2 minutes

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ──────────────────────────────────────────────
  // BLOG POST — ADMIN OPERATIONS
  // ──────────────────────────────────────────────

  async createPost(dto: CreateBlogPostDto) {
    const slug = dto.slug
      ? slugify(dto.slug, { lower: true, strict: true })
      : slugify(dto.title, { lower: true, strict: true });

    await this.ensureUniqueSlug(slug);
    await this.validateRelations(dto.authorId, dto.categoryId);

    const sanitizedContent = this.sanitizeContent(dto.content);
    const readingTime = this.calculateReadingTime(sanitizedContent);

    const post = await this.prisma.blogPost.create({
      data: {
        title: dto.title,
        slug,
        excerpt: dto.excerpt,
        content: sanitizedContent,
        featuredImage: dto.featuredImage,
        images: dto.images ?? [],
        authorId: dto.authorId,
        categoryId: dto.categoryId,
        tags: dto.tags ?? [],
        status: dto.status ?? BlogStatus.DRAFT,
        metaTitle: dto.metaTitle ?? dto.title,
        metaDescription: dto.metaDescription ?? dto.excerpt,
        metaKeywords: dto.metaKeywords ?? [],
        canonicalUrl: dto.canonicalUrl,
        ogImage: dto.ogImage ?? dto.featuredImage,
        readingTime,
        publishedAt:
          dto.status === BlogStatus.PUBLISHED ? new Date() : null,
      },
      include: { author: true, category: true },
    });

    await this.invalidateListCaches();
    return post;
  }

  async updatePost(id: string, dto: UpdateBlogPostDto) {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Blog post not found');

    if (dto.slug && dto.slug !== existing.slug) {
      const newSlug = slugify(dto.slug, { lower: true, strict: true });
      await this.ensureUniqueSlug(newSlug, id);
      dto.slug = newSlug;
    }

    if (dto.authorId) {
      await this.validateRelations(dto.authorId, dto.categoryId);
    } else if (dto.categoryId) {
      await this.validateRelations(undefined, dto.categoryId);
    }

    const data: any = { ...dto };

    if (dto.content) {
      data.content = this.sanitizeContent(dto.content);
      data.readingTime = this.calculateReadingTime(data.content);
    }

    // Set publishedAt if publishing for the first time
    if (
      dto.status === BlogStatus.PUBLISHED &&
      existing.status === BlogStatus.DRAFT
    ) {
      data.publishedAt = new Date();
    }

    const post = await this.prisma.blogPost.update({
      where: { id },
      data,
      include: { author: true, category: true },
    });

    await this.invalidatePostCache(existing.slug);
    if (dto.slug && dto.slug !== existing.slug) {
      await this.invalidatePostCache(dto.slug);
    }
    await this.invalidateListCaches();
    return post;
  }

  async deletePost(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Blog post not found');

    await this.prisma.blogPost.delete({ where: { id } });
    await this.invalidatePostCache(post.slug);
    await this.invalidateListCaches();
    return { deleted: true };
  }

  async updatePostStatus(id: string, dto: UpdateBlogStatusDto) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Blog post not found');

    const data: Prisma.BlogPostUpdateInput = { status: dto.status };
    if (dto.status === BlogStatus.PUBLISHED && !post.publishedAt) {
      data.publishedAt = new Date();
    }

    const updated = await this.prisma.blogPost.update({
      where: { id },
      data,
      include: { author: true, category: true },
    });

    await this.invalidatePostCache(post.slug);
    await this.invalidateListCaches();
    return updated;
  }

  async adminGetAllPosts(query: QueryBlogDto) {
    const { page = 1, limit = 10, search, category, status, tag } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.BlogPostWhereInput = {};

    if (status) where.status = status;
    if (category) {
      where.category = { slug: category };
    }
    if (tag) {
      where.tags = { has: tag };
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { excerpt: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        include: { author: true, category: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async adminGetPostById(id: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { id },
      include: { author: true, category: true },
    });
    if (!post) throw new NotFoundException('Blog post not found');
    return post;
  }

  // ──────────────────────────────────────────────
  // BLOG POST — PUBLIC OPERATIONS
  // ──────────────────────────────────────────────

  async getPublishedPosts(query: QueryBlogDto) {
    const { page = 1, limit = 10, search, category, tag } = query;
    const cacheKey = `blog:list:${page}:${limit}:${category || ''}:${tag || ''}:${search || ''}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const skip = (page - 1) * limit;

    const where: Prisma.BlogPostWhereInput = {
      status: BlogStatus.PUBLISHED,
    };

    if (category) {
      where.category = { slug: category };
    }
    if (tag) {
      where.tags = { has: tag };
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { excerpt: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          featuredImage: true,
          tags: true,
          readingTime: true,
          views: true,
          publishedAt: true,
          author: { select: { id: true, name: true, avatar: true } },
          category: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    const result = {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    await this.redis.setex(cacheKey, BLOG_LIST_CACHE_TTL, JSON.stringify(result));
    return result;
  }

  async getPostBySlug(slug: string) {
    const cacheKey = `blog:post:${slug}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const post = await this.prisma.blogPost.findUnique({
      where: { slug, status: BlogStatus.PUBLISHED },
      include: { author: true, category: true },
    });
    if (!post) throw new NotFoundException('Blog post not found');

    // Build JSON-LD structured data
    const jsonLd = this.buildJsonLd(post);
    const result = { ...post, jsonLd };

    await this.redis.setex(cacheKey, BLOG_CACHE_TTL, JSON.stringify(result));
    return result;
  }

  async getTrendingPosts(limit: number = 10) {
    const cacheKey = `blog:trending:${limit}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const posts = await this.prisma.blogPost.findMany({
      where: { status: BlogStatus.PUBLISHED },
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        featuredImage: true,
        tags: true,
        readingTime: true,
        views: true,
        publishedAt: true,
        author: { select: { id: true, name: true, avatar: true } },
        category: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ views: 'desc' }, { publishedAt: 'desc' }],
      take: limit,
    });

    await this.redis.setex(cacheKey, BLOG_LIST_CACHE_TTL, JSON.stringify(posts));
    return posts;
  }

  async getPostsByTag(tag: string, query: QueryBlogDto) {
    const { page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.BlogPostWhereInput = {
      status: BlogStatus.PUBLISHED,
      tags: { has: tag },
    };

    const [data, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          featuredImage: true,
          tags: true,
          readingTime: true,
          views: true,
          publishedAt: true,
          author: { select: { id: true, name: true, avatar: true } },
          category: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async incrementViews(slug: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!post) throw new NotFoundException('Blog post not found');

    await this.prisma.blogPost.update({
      where: { id: post.id },
      data: { views: { increment: 1 } },
    });

    // Invalidate the cached post so views update
    await this.invalidatePostCache(slug);
    return { success: true };
  }

  // ──────────────────────────────────────────────
  // SITEMAP
  // ──────────────────────────────────────────────

  async getSitemapData() {
    return this.prisma.blogPost.findMany({
      where: { status: BlogStatus.PUBLISHED },
      select: {
        slug: true,
        updatedAt: true,
        publishedAt: true,
      },
      orderBy: { publishedAt: 'desc' },
    });
  }

  // ──────────────────────────────────────────────
  // BLOG AUTHOR — ADMIN OPERATIONS
  // ──────────────────────────────────────────────

  async createAuthor(dto: CreateBlogAuthorDto) {
    return this.prisma.blogAuthor.create({ data: dto });
  }

  async updateAuthor(id: string, dto: UpdateBlogAuthorDto) {
    const author = await this.prisma.blogAuthor.findUnique({ where: { id } });
    if (!author) throw new NotFoundException('Author not found');
    return this.prisma.blogAuthor.update({ where: { id }, data: dto });
  }

  async deleteAuthor(id: string) {
    const author = await this.prisma.blogAuthor.findUnique({
      where: { id },
      include: { _count: { select: { posts: true } } },
    });
    if (!author) throw new NotFoundException('Author not found');
    if (author._count.posts > 0) {
      throw new ConflictException(
        'Cannot delete author with existing posts. Reassign or delete their posts first.',
      );
    }
    await this.prisma.blogAuthor.delete({ where: { id } });
    return { deleted: true };
  }

  async getAllAuthors() {
    return this.prisma.blogAuthor.findMany({
      include: { _count: { select: { posts: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async getAuthorById(id: string) {
    const author = await this.prisma.blogAuthor.findUnique({
      where: { id },
      include: { _count: { select: { posts: true } } },
    });
    if (!author) throw new NotFoundException('Author not found');
    return author;
  }

  // ──────────────────────────────────────────────
  // BLOG CATEGORY — ADMIN OPERATIONS
  // ──────────────────────────────────────────────

  async createCategory(dto: CreateBlogCategoryDto) {
    const slug = dto.slug
      ? slugify(dto.slug, { lower: true, strict: true })
      : slugify(dto.name, { lower: true, strict: true });

    const existing = await this.prisma.blogCategory.findUnique({
      where: { slug },
    });
    if (existing) throw new ConflictException('Category with this slug already exists');

    return this.prisma.blogCategory.create({
      data: { name: dto.name, slug },
    });
  }

  async updateCategory(id: string, dto: UpdateBlogCategoryDto) {
    const category = await this.prisma.blogCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException('Category not found');

    const data: any = { ...dto };
    if (dto.slug) {
      data.slug = slugify(dto.slug, { lower: true, strict: true });
    } else if (dto.name) {
      data.slug = slugify(dto.name, { lower: true, strict: true });
    }

    return this.prisma.blogCategory.update({ where: { id }, data });
  }

  async deleteCategory(id: string) {
    const category = await this.prisma.blogCategory.findUnique({
      where: { id },
      include: { _count: { select: { posts: true } } },
    });
    if (!category) throw new NotFoundException('Category not found');
    if (category._count.posts > 0) {
      throw new ConflictException(
        'Cannot delete category with existing posts. Reassign or delete posts first.',
      );
    }
    await this.prisma.blogCategory.delete({ where: { id } });
    return { deleted: true };
  }

  async getAllCategories() {
    return this.prisma.blogCategory.findMany({
      include: { _count: { select: { posts: true } } },
      orderBy: { name: 'asc' },
    });
  }

  // ──────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────

  private async ensureUniqueSlug(slug: string, excludeId?: string) {
    const where: Prisma.BlogPostWhereInput = { slug };
    if (excludeId) {
      where.id = { not: excludeId };
    }
    const existing = await this.prisma.blogPost.findFirst({ where });
    if (existing) throw new ConflictException(`Slug "${slug}" is already in use`);
  }

  private async validateRelations(authorId?: string, categoryId?: string) {
    if (authorId) {
      const author = await this.prisma.blogAuthor.findUnique({
        where: { id: authorId },
      });
      if (!author) throw new NotFoundException('Author not found');
    }
    if (categoryId) {
      const category = await this.prisma.blogCategory.findUnique({
        where: { id: categoryId },
      });
      if (!category) throw new NotFoundException('Blog category not found');
    }
  }

  private sanitizeContent(content: any): any {
    if (typeof content === 'string') {
      return sanitizeHtml(content, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
          'img',
          'h1',
          'h2',
          'h3',
          'figure',
          'figcaption',
          'iframe',
        ]),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
          a: ['href', 'name', 'target', 'rel'],
          iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen'],
        },
        allowedIframeHostnames: ['www.youtube.com', 'player.vimeo.com'],
      });
    }

    // For Editor.js JSON format, sanitize text fields within blocks
    if (content && typeof content === 'object' && Array.isArray(content.blocks)) {
      content.blocks = content.blocks.map((block: any) => {
        if (block.data && typeof block.data.text === 'string') {
          block.data.text = sanitizeHtml(block.data.text);
        }
        return block;
      });
    }

    return content;
  }

  private calculateReadingTime(content: any): number {
    let text = '';
    if (typeof content === 'string') {
      text = content.replace(/<[^>]*>/g, '');
    } else if (
      content &&
      typeof content === 'object' &&
      Array.isArray(content.blocks)
    ) {
      text = content.blocks
        .map((block: any) => block.data?.text || '')
        .join(' ')
        .replace(/<[^>]*>/g, '');
    }
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }

  private buildJsonLd(post: any) {
    return {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.metaTitle || post.title,
      description: post.metaDescription || post.excerpt,
      image: post.ogImage || post.featuredImage,
      author: {
        '@type': 'Person',
        name: post.author?.name,
      },
      publisher: {
        '@type': 'Organization',
        name: 'Pharmabag',
      },
      datePublished: post.publishedAt?.toISOString(),
      dateModified: post.updatedAt?.toISOString(),
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': post.canonicalUrl || `https://pharmabag.com/blog/${post.slug}`,
      },
      keywords: post.metaKeywords?.join(', '),
      wordCount: undefined as number | undefined,
      timeRequired: `PT${post.readingTime}M`,
    };
  }

  private async invalidatePostCache(slug: string) {
    await this.redis.del(`blog:post:${slug}`);
  }

  private async invalidateListCaches() {
    const keys = await this.redis.keys('blog:list:*');
    const trendingKeys = await this.redis.keys('blog:trending:*');
    const allKeys = [...keys, ...trendingKeys];
    if (allKeys.length > 0) {
      await this.redis.del(...allKeys);
    }
  }
}

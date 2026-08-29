import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsUUID,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BlogStatus } from '@prisma/client';

export class CreateBlogPostDto {
  @ApiProperty({ example: 'Best Medicines for Cold in India' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'best-medicines-for-cold-india' })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  slug?: string;

  @ApiPropertyOptional({ example: 'Discover effective medicines for cold...' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @ApiProperty({ description: 'Editor.js JSON or rich text content' })
  content: any;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsOptional()
  @IsString()
  featuredImage?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiProperty({ example: 'uuid-of-author' })
  @IsUUID()
  authorId: string;

  /**
   * Optional on purpose: `BlogPost.categoryId` is nullable in the schema and
   * uncategorised posts are legitimate — requiring it here was what stopped
   * the admin UI from ever creating one.
   */
  @ApiPropertyOptional({ example: 'uuid-of-category' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: ['cold', 'medicine', 'india'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: BlogStatus, default: BlogStatus.DRAFT })
  @IsOptional()
  @IsEnum(BlogStatus)
  status?: BlogStatus;

  // SEO Fields
  @ApiPropertyOptional({ example: 'Best Cold Medicines in India | Pharmabag' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  metaTitle?: string;

  @ApiPropertyOptional({ example: 'Top medicines for cold relief...' })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  metaDescription?: string;

  @ApiPropertyOptional({ example: ['cold medicine india', 'flu tablets'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  metaKeywords?: string[];

  @ApiPropertyOptional({ example: 'https://pharmabag.com/blog/cold-medicine' })
  @IsOptional()
  @IsString()
  canonicalUrl?: string;

  @ApiPropertyOptional({ example: 'https://example.com/og-image.jpg' })
  @IsOptional()
  @IsString()
  ogImage?: string;
}

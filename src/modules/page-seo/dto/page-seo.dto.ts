import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Every field is optional and every field may be an EMPTY STRING.
 *
 * Empty string is meaningful here: it means "clear this override and go back
 * to the storefront's generated value". The service therefore distinguishes
 * `undefined` (leave alone) from `''` (clear to null) — the same contract the
 * product SEO overrides already use.
 */
export class UpsertPageSeoDto {
  @ApiPropertyOptional({ example: 'PRODUCT' })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  entityType?: string;

  @ApiPropertyOptional({ example: 'uuid-of-the-master-product' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  entityId?: string;

  @ApiPropertyOptional({ example: 'Ayurvedic Medicines Wholesale Supplier' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(400)
  description?: string;

  @ApiPropertyOptional({ example: 'https://pharmabag.in/categories/ayurvedic' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  canonicalUrl?: string;

  /** 'index,follow' | 'noindex,follow' | 'index,nofollow' | 'noindex,nofollow' */
  @ApiPropertyOptional({ example: 'index,follow' })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  robots?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  ogTitle?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(400)
  ogDescription?: string;

  @ApiPropertyOptional({ example: 'https://…/share.jpg' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  ogImage?: string;

  @ApiPropertyOptional({ example: 'summary_large_image' })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  twitterCard?: string;

  @ApiPropertyOptional({ example: 'ayurvedic medicine wholesale' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  focusKeyword?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  secondaryKeywords?: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  entityDescription?: string;

  /** Plain, factual summary written for AI answer engines. */
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  aiSummary?: string;

  /** `[{ question, answer }]` — rendered AND emitted as FAQPage JSON-LD. */
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @IsArray()
  @IsOptional()
  faq?: { question: string; answer: string }[];

  /** Merged OVER the generated JSON-LD for the page. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsObject()
  @IsOptional()
  structuredData?: Record<string, unknown>;

  /** `{ "<image url>": "alt text" }` */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsObject()
  @IsOptional()
  imageAlts?: Record<string, string>;
}

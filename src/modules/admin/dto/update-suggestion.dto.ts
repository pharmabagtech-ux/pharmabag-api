import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean, IsUUID, MaxLength } from 'class-validator';

export class UpdateSuggestionDto {
  @ApiPropertyOptional({ example: 'Baconil 2mg' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Manufacturer Name' })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'Nicotine 2mg' })
  @IsString()
  @IsOptional()
  chemicalComposition?: string;

  @ApiPropertyOptional({ example: 'Detailed description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 100.5 })
  @IsNumber()
  @IsOptional()
  mrp?: number;

  @ApiPropertyOptional({ example: 12.0 })
  @IsNumber()
  @IsOptional()
  gstPercent?: number;

  @ApiPropertyOptional({ example: 'uuid-category-id' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'uuid-subcategory-id' })
  @IsUUID()
  @IsOptional()
  subCategoryId?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ─── SEO head overrides (null/absent = generated defaults) ───
  // Empty string is MEANINGFUL here: it clears an override back to the
  // generated head, so these use explicit undefined-checks in the service.

  @ApiPropertyOptional({ example: 'Dolo 650 Wholesale Price — Micro Labs' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  metaTitle?: string;

  @ApiPropertyOptional({ example: 'Buy Dolo 650 in bulk at wholesale rates…' })
  @IsString()
  @IsOptional()
  @MaxLength(320)
  metaDescription?: string;

  @ApiPropertyOptional({ example: 'https://pharmabag03.s3.ap-south-1.amazonaws.com/blog-images/og.png' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  ogImage?: string;

  // --- Product image SEO (applies to the product's first image) ---

  /** Empty string clears the override back to "<name> - PharmaBag". */
  @ApiPropertyOptional({ example: 'Dolo 650 Tablet - PharmaBag' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  imageAltText?: string;

  /**
   * New file name (extension not needed). Renames the S3 object by copy and
   * repoints the image row; the old object stays live for caches.
   */
  @ApiPropertyOptional({ example: 'dolo-650-tablet-pharmabag' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  imageFileName?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class BannerPlacementDto {
  @ApiProperty({ enum: ['HOMEPAGE', 'ALL_CATEGORIES', 'CATEGORY'] })
  @IsEnum(['HOMEPAGE', 'ALL_CATEGORIES', 'CATEGORY'])
  scope!: 'HOMEPAGE' | 'ALL_CATEGORIES' | 'CATEGORY';

  @ApiPropertyOptional({
    description: 'Required when scope is CATEGORY; discarded otherwise.',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class CreateBannerDto {
  @ApiProperty({
    description: 'Internal label shown in the admin list only; never rendered.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ description: 'Desktop artwork URL, from POST /storage/banner-image' })
  @IsString()
  @MaxLength(2048)
  imageUrl!: string;

  @ApiPropertyOptional({
    description: 'Optional mobile crop. Falls back to imageUrl when absent.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mobileImageUrl?: string;

  @ApiProperty({
    description:
      'Required. The banner text is baked into the artwork, so this is the only textual representation that exists — for screen readers and for anything reading the page without images.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  altText!: string;

  @ApiPropertyOptional({
    description: 'Click-through target. Omit to make the banner non-clickable.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  linkUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /**
   * Where the banner is shown. At least one, ALWAYS.
   *
   * This was optional, and that is how a banner goes missing. An unplaced
   * banner saves without complaint, appears in the admin list as Active, and
   * then matches no storefront query ever — `findPublic` filters on
   * `placements: { some }`, so zero placements means zero pages. Nothing
   * downstream reports it either: `fetchBanners` in the buyer app returns an
   * empty list on any failure and the strip renders null on empty, so the
   * whole path fails silently by design. The only signal was a "Shown
   * nowhere" badge in the admin list that nobody had reason to look at.
   *
   * ArrayMinSize(1) applies to updates too, because UpdateBannerDto derives
   * from this class with PartialType: an absent `placements` still means
   * "leave them alone", but an explicit empty array is now refused. Stripping
   * a banner to invisibility is what `active: false` is for, and that stays
   * reversible.
   *
   * Note for the admin UI: it must not send `placements: []` when toggling
   * Active on a banner that predates this rule, or the toggle 400s. Omit the
   * key instead.
   */
  @ApiProperty({ type: [BannerPlacementDto] })
  @IsArray()
  @ArrayMinSize(1, {
    message:
      'A banner must be shown somewhere: choose the homepage, all categories, or at least one category.',
  })
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BannerPlacementDto)
  placements!: BannerPlacementDto[];
}

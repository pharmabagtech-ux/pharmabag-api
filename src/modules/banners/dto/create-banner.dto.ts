import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

  @ApiPropertyOptional({ type: [BannerPlacementDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BannerPlacementDto)
  placements?: BannerPlacementDto[];
}

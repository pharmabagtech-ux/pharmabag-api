import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The whole admin-editable site-SEO surface. Every field optional — an empty
 * object is a valid "use the code defaults" state. The global ValidationPipe
 * runs with whitelist:true, so unknown keys are stripped before they reach
 * the service; nothing off this shape can ever be stored.
 */
export class UpdateSiteSettingsDto {
  /** Google Search Console "HTML tag" verification token (the content= value). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  gscVerification?: string;

  /** Bing Webmaster msvalidate.01 token. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bingVerification?: string;

  /** GA4 measurement id, e.g. G-ABC123XYZ0. */
  @ApiPropertyOptional({ example: 'G-ABC123XYZ0' })
  @IsOptional()
  @Matches(/^G-[A-Z0-9]{4,16}$/, {
    message: 'ga4MeasurementId must look like G-XXXXXXXXXX',
  })
  ga4MeasurementId?: string;

  /** Official brand profiles — feeds the Organization sameAs entity links. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUrl({ require_protocol: true }, { each: true })
  socialProfiles?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @ApiPropertyOptional({ example: 'Kolkata' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressLocality?: string;

  @ApiPropertyOptional({ example: 'West Bengal' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressRegion?: string;

  /** 1200x630 image URL used when a page has no share image of its own. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  defaultOgImage?: string;
}

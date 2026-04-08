import {
  IsString,
  IsOptional,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSellerProfileDto {
  @ApiPropertyOptional({ example: 'PharmaCorp Distributors' })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ example: '27AABCU9603R1ZM' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/, {
    message: 'gstNumber must be a valid 15-character GSTIN',
  })
  gstNumber?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}\d{4}[A-Z]{1}$/, {
    message: 'panNumber must be a valid 10-character PAN',
  })
  panNumber?: string;

  @ApiPropertyOptional({ example: 'DL-MH-2024-005678' })
  @IsOptional()
  @IsString()
  drugLicenseNumber?: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/pharmabag-images/drug-license.pdf' })
  @IsOptional()
  @IsString()
  drugLicenseUrl?: string;

  @ApiPropertyOptional({ example: '456 Industrial Area' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Delhi' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Delhi' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '600001' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pincode must be a valid 6-digit code' })
  pincode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  gstPanResponse?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  businessName?: string;
}

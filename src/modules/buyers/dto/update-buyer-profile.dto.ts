import {
  IsString,
  IsOptional,
  IsNumber,
  Matches,
} from 'class-validator';

export class UpdateBuyerProfileDto {
  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/, {
    message: 'gstNumber must be a valid 15-character GSTIN',
  })
  gstNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}\d{4}[A-Z]{1}$/, {
    message: 'panNumber must be a valid 10-character PAN',
  })
  panNumber?: string;

  @IsOptional()
  @IsString()
  drugLicenseNumber?: string;

  @IsOptional()
  @IsString()
  drugLicenseUrl?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pincode must be a valid 6-digit code' })
  pincode?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;
}

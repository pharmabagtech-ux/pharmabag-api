import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Matches,
} from 'class-validator';

export class CreateBuyerProfileDto {
  @IsString()
  @IsNotEmpty()
  legalName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/, {
    message: 'gstNumber must be a valid 15-character GSTIN',
  })
  gstNumber: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{5}\d{4}[A-Z]{1}$/, {
    message: 'panNumber must be a valid 10-character PAN',
  })
  panNumber: string;

  @IsString()
  @IsNotEmpty()
  drugLicenseNumber: string;

  @IsString()
  @IsNotEmpty()
  drugLicenseUrl: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'pincode must be a valid 6-digit code' })
  pincode: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;
}

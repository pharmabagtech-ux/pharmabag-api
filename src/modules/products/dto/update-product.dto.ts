import {
  IsString,
  IsNumber,
  IsOptional,
  IsInt,
  IsBoolean,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';

export class UpdateProductDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  subCategoryId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  manufacturer?: string;

  @IsString()
  @IsOptional()
  chemicalComposition?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  mrp?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  gstPercent?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  minimumOrderQuantity?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maximumOrderQuantity?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // Phase-1: Update default batch stock & expiry
  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;
}

import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsInt,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  subCategoryId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  manufacturer: string;

  @IsString()
  @IsNotEmpty()
  chemicalComposition: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  mrp: number;

  @IsNumber()
  @Min(0)
  gstPercent: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  minimumOrderQuantity?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maximumOrderQuantity?: number;

  // Phase-1: Flat stock & expiry → backend creates a default ProductBatch
  @IsInt()
  @Min(0)
  stock: number;

  @IsDateString()
  expiryDate: string;
}

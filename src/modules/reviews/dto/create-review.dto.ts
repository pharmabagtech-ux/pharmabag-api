import {
  IsNotEmpty,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateReviewDto {
  @IsUUID('4', { message: 'productId must be a valid UUID' })
  @IsNotEmpty({ message: 'productId is required' })
  productId: string;

  @IsInt({ message: 'Rating must be an integer' })
  @Min(1, { message: 'Rating must be at least 1' })
  @Max(5, { message: 'Rating must be at most 5' })
  @IsNotEmpty({ message: 'Rating is required' })
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Comment must not exceed 1000 characters' })
  comment?: string;
}

import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QuerySellersDto {
  @ApiPropertyOptional({ example: 'jaiswal', description: 'Search by company name, GST, PAN, phone, or email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 'VERIFIED',
    description: 'Filter by seller verification status',
  })
  @IsOptional()
  @IsIn(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'])
  status?: string;

  @ApiPropertyOptional({ example: 'true', description: 'Filter to sellers on vacation (true/false)' })
  @IsOptional()
  @IsIn(['true', 'false'])
  isVacation?: string;

  @ApiPropertyOptional({ example: 1, default: 1, description: 'Page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, description: 'Items per page (max 500)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 20;
}

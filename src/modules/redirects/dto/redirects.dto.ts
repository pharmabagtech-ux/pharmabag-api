import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRedirectDto {
  @ApiProperty({ example: '/products/old-slug-pb123' })
  @IsString()
  @MaxLength(500)
  from: string;

  @ApiProperty({ example: '/products/new-slug-pb123' })
  @IsString()
  @MaxLength(1000)
  to: string;
}

export class UpdateRedirectDto {
  @ApiProperty({ example: '/products/new-slug-pb123' })
  @IsString()
  @MaxLength(1000)
  to: string;
}

export class Track404Dto {
  @ApiProperty({ example: '/some/dead/path' })
  @IsString()
  @MaxLength(600)
  path: string;

  @ApiPropertyOptional({ example: 'https://www.google.com/' })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  referrer?: string;
}

export class RecordHitDto {
  @ApiProperty({ example: '/products/old-slug-pb123' })
  @IsString()
  @MaxLength(500)
  from: string;
}

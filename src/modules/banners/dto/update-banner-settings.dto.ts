import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_ROTATION_SECONDS, MIN_ROTATION_SECONDS } from '../rotation.util';

export class UpdateBannerSettingsDto {
  @ApiProperty({
    minimum: MIN_ROTATION_SECONDS,
    maximum: MAX_ROTATION_SECONDS,
    example: 5,
    description: 'How long each slide is shown before the slideshow advances.',
  })
  @IsInt()
  @Min(MIN_ROTATION_SECONDS)
  @Max(MAX_ROTATION_SECONDS)
  rotationSeconds!: number;
}
